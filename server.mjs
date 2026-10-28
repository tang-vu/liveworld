import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, resolve, sep } from "node:path";
import { readConfig } from "./src/config.mjs";
import { BudgetLedger } from "./src/budget.mjs";
import { MetaClient, scanTabletop } from "./src/meta.mjs";
import { runPlaytest } from "./src/agent.mjs";
import { compileRuleChange } from "./src/rules.mjs";
import { validateWorld } from "./shared/world.js";
import { simulate } from "./shared/engine.js";
import { readRuntimeConfig, DemoAccess } from "./src/access.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const config = readConfig();
const runtime = readRuntimeConfig();
const dataDirectory = process.env.LIVEWORLD_DATA_DIR
  ? resolve(process.env.LIVEWORLD_DATA_DIR)
  : join(root, ".liveworld");
const ledger = new BudgetLedger(dataDirectory, config);
const client = new MetaClient(config, ledger);
const port = runtime.port;
const access = new DemoAccess(runtime);
let paidBusy = false;
if (runtime.publicOrigin && config.key) {
  // Public restarts must never reset accounting by silently using an empty mount.
  try {
    await readFile(join(dataDirectory, "usage.json"));
    await ledger.summary();
  } catch {
    throw new Error(
      "Restore the verified usage ledger into LIVEWORLD_DATA_DIR before enabling public Meta calls.",
    );
  }
}

function json(res, status, value) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(value));
}
async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 3_200_000) throw new Error("Request is too large.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".mp4": "video/mp4",
  ".vtt": "text/vtt; charset=utf-8",
};

const server = createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
  if (!access.trusted(req))
    return json(res, 403, { error: "This origin or host is not allowed." });
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  try {
    if (req.method === "GET" && url.pathname === "/healthz")
      return json(res, 200, { ok: true });
    if (req.method === "POST" && url.pathname === "/api/access") {
      const body = await readBody(req);
      const result = access.unlock(body.code);
      if (result.cookie) res.setHeader("Set-Cookie", result.cookie);
      return json(
        res,
        result.status,
        result.status === 200
          ? { authorized: true }
          : {
              error:
                result.status === 429
                  ? "Too many incorrect codes. Check the code with the builder."
                  : "The demo access code is incorrect.",
            },
      );
    }
    if (req.method === "POST" && url.pathname === "/api/logout") {
      res.setHeader("Set-Cookie", access.logout(req));
      return json(res, 200, { authorized: false });
    }
    if (req.method === "GET" && url.pathname === "/api/status")
      return json(res, 200, {
        configured: Boolean(config.key),
        model: config.model,
        accessRequired: access.required(),
        authorized: access.authorized(req),
        budget: await ledger.summary(),
      });
    if (req.method === "POST" && url.pathname === "/api/simulate") {
      const body = await readBody(req);
      return json(res, 200, simulate(validateWorld(body.world)));
    }
    if (
      req.method === "POST" &&
      ["/api/playtest", "/api/scan", "/api/rules"].includes(url.pathname)
    ) {
      if (!access.authorized(req))
        return json(res, 403, {
          error: "Enter the demo access code to use live Meta calls.",
          code: "LIVE_ACCESS_REQUIRED",
        });
      if (paidBusy)
        return json(res, 409, {
          error: "Another Meta operation is running. Wait for it to finish.",
        });
      paidBusy = true;
      try {
        const body = await readBody(req);
        if (url.pathname === "/api/scan")
          return json(res, 200, await scanTabletop(client, body));
        if (url.pathname === "/api/rules") {
          const result = {
            ...(await compileRuleChange(client, body)),
            designId: randomUUID(),
            createdAt: new Date().toISOString(),
            startingWorld: validateWorld(body.world),
          };
          await mkdir(join(dataDirectory, "designs"), { recursive: true });
          await writeFile(
            join(dataDirectory, "designs", `${result.designId}.json`),
            JSON.stringify(result, null, 2),
            { mode: 0o600 },
          );
          return json(res, 200, result);
        }
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-store",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        const send = (event) => {
          if (!res.destroyed) res.write(`data: ${JSON.stringify(event)}\n\n`);
        };
        const result = await runPlaytest(client, body, send);
        await mkdir(join(dataDirectory, "runs"), { recursive: true });
        await writeFile(
          join(dataDirectory, "runs", `${result.runId}.json`),
          JSON.stringify(result, null, 2),
          { mode: 0o600 },
        );
        send({ type: "complete", result, budget: await ledger.summary() });
        res.end();
      } finally {
        paidBusy = false;
      }
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD")
      return json(res, 405, { error: "Method not allowed." });
    const shared = url.pathname.startsWith("/shared/");
    const directory = join(root, shared ? "shared" : "public");
    const relative =
      url.pathname === "/" || url.pathname === "/demo/"
        ? url.pathname === "/"
          ? "index.html"
          : "demo/index.html"
        : decodeURIComponent(url.pathname).replace(
            shared ? /^\/shared\// : /^\//,
            "",
          );
    const file = resolve(directory, relative);
    if (!file.startsWith(directory + sep) || !mime[extname(file)])
      return json(res, 404, { error: "Not found." });
    const content = await readFile(file);
    if (extname(file) === ".mp4" && req.headers.range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      let start;
      let end;
      if (match && (match[1] || match[2])) {
        if (!match[1]) {
          start = Math.max(0, content.length - Number(match[2]));
          end = content.length - 1;
        } else {
          start = Number(match[1]);
          end = match[2]
            ? Math.min(Number(match[2]), content.length - 1)
            : content.length - 1;
        }
      }
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 0 ||
        start >= content.length ||
        end < start ||
        (match && !match[1] && Number(match[2]) === 0)
      ) {
        res.setHeader("Content-Range", `bytes */${content.length}`);
        return json(res, 416, {
          error: "Requested video range is unavailable.",
        });
      }
      res.writeHead(206, {
        "Content-Type": mime[".mp4"],
        "Content-Length": end - start + 1,
        "Content-Range": `bytes ${start}-${end}/${content.length}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-cache",
      });
      res.end(
        req.method === "HEAD" ? undefined : content.subarray(start, end + 1),
      );
      return;
    }
    res.writeHead(200, {
      "Content-Type": mime[extname(file)],
      "Content-Length": content.length,
      ...(extname(file) === ".mp4" ? { "Accept-Ranges": "bytes" } : {}),
      "Cache-Control": "no-cache",
    });
    res.end(req.method === "HEAD" ? undefined : content);
  } catch (error) {
    const message =
      error.code === "ENOENT"
        ? "Not found."
        : String(error.message).replaceAll(
            config.key || "__NO_SECRET__",
            "[redacted]",
          );
    if (res.headersSent) {
      if (!res.destroyed) {
        res.write(`data: ${JSON.stringify({ type: "error", message })}\n\n`);
        res.end();
      }
    } else json(res, error.code === "ENOENT" ? 404 : 400, { error: message });
  }
});

server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
server.listen(port, runtime.host, () =>
  console.log(
    `LiveWorld is ready at ${runtime.publicOrigin ?? `http://127.0.0.1:${port}`}`,
  ),
);
