import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { request } from "node:http";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";

async function freePort() {
  const socket = createServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return port;
}
async function boot(t, { ledger = true } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "liveworld-http-"));
  if (ledger)
    await writeFile(
      join(directory, "usage.json"),
      JSON.stringify({ version: 1, entries: [], blocked: null }),
    );
  const port = await freePort();
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      MODEL_API_KEY: "test-only-not-a-real-api-key",
      LIVEWORLD_PUBLIC_ORIGIN: "https://liveworld.test",
      LIVEWORLD_DEMO_ACCESS_CODE: "test-only-long-demo-access-code",
      LIVEWORLD_DATA_DIR: directory,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (data) => {
    output += data.toString();
  });
  child.stderr.on("data", (data) => {
    output += data.toString();
  });
  const stopped = once(child, "exit");
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await stopped;
    const target = resolve(directory);
    assert.ok(target.startsWith(resolve(tmpdir()) + sep + "liveworld-http-"));
    await rm(target, { recursive: true, force: true });
  });
  if (!ledger) {
    await stopped;
    return { child, output };
  }
  await Promise.race([
    new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Test server did not become ready.")),
        8000,
      );
      child.stdout.on("data", () => {
        if (output.includes("LiveWorld is ready")) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.once("exit", () => {
        clearTimeout(timer);
        reject(new Error(output));
      });
    }),
    stopped.then(() => {
      throw new Error(output);
    }),
  ]);
  return { port, directory, child };
}
function call(port, path, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: { Host: "liveworld.test", ...headers },
      },
      (res) => {
        const chunks = [];
        res.on("data", (data) => chunks.push(data));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            text: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.on("error", reject);
    req.setTimeout(5000, () => req.destroy(new Error("HTTP check timed out.")));
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

test("public HTTP flow protects paid calls, revokes access and retains accounting without inference", async (t) => {
  const { port, directory } = await boot(t);
  assert.equal((await call(port, "/")).status, 200);
  assert.equal((await call(port, "/demo/")).status, 200);
  const video = await call(port, "/demo/liveworld-demo.mp4", {
    headers: { Range: "bytes=0-31" },
  });
  assert.equal(video.status, 206);
  assert.equal(video.headers["content-type"], "video/mp4");
  assert.equal(video.headers["content-length"], "32");
  assert.match(video.text, /ftyp/);
  assert.equal(
    (
      await call(port, "/demo/liveworld-demo.mp4", {
        headers: { Range: "bytes=999999999-" },
      })
    ).status,
    416,
  );
  let status = JSON.parse((await call(port, "/api/status")).text);
  assert.equal(status.accessRequired, true);
  assert.equal(status.authorized, false);
  for (const path of ["/api/scan", "/api/rules", "/api/playtest"])
    assert.equal(
      (await call(port, path, { method: "POST", body: {} })).status,
      403,
    );
  assert.equal((await call(port, "/.env.local")).status, 404);
  assert.equal((await call(port, "/.liveworld/usage.json")).status, 404);
  assert.equal(
    (
      await call(port, "/api/access", {
        method: "POST",
        headers: { Origin: "https://attacker.test" },
        body: { code: "test-only-long-demo-access-code" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call(port, "/api/access", {
        method: "POST",
        body: { code: "wrong" },
      })
    ).status,
    401,
  );
  const unlock = await call(port, "/api/access", {
    method: "POST",
    body: { code: "test-only-long-demo-access-code" },
  });
  assert.equal(unlock.status, 200);
  const cookie = unlock.headers["set-cookie"][0].split(";")[0];
  assert.equal(
    JSON.parse(
      (await call(port, "/api/status", { headers: { Cookie: cookie } })).text,
    ).authorized,
    true,
  );
  // An empty body is rejected by world validation before any model call.
  assert.equal(
    (
      await call(port, "/api/rules", {
        method: "POST",
        headers: { Cookie: cookie },
        body: {},
      })
    ).status,
    400,
  );
  await call(port, "/api/logout", {
    method: "POST",
    headers: { Cookie: cookie },
  });
  assert.equal(
    (
      await call(port, "/api/scan", {
        method: "POST",
        headers: { Cookie: cookie },
        body: {},
      })
    ).status,
    403,
  );
  status = JSON.parse((await call(port, "/api/status")).text);
  assert.equal(status.budget.requests, 0);
  assert.equal(
    JSON.parse(await readFile(join(directory, "usage.json"), "utf8")).entries
      .length,
    0,
  );
});

test("public Meta startup refuses a missing persistent ledger", async (t) => {
  const result = await boot(t, { ledger: false });
  assert.notEqual(result.child.exitCode, 0);
  assert.match(result.output, /Restore the verified usage ledger/);
});
