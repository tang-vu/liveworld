import assert from "node:assert/strict";
import { get, request } from "node:http";
import { exampleWorld } from "../shared/world.js";

const base = process.env.LIVEWORLD_BASE_URL ?? "http://127.0.0.1:4173";
const page = await fetch(base, { headers: { "Sec-Fetch-Site": "cross-site" } });
assert.equal(page.status, 200);
assert.match(await page.text(), /LiveWorld/);
for (const variant of ["a", "b"]) {
  const image = await fetch(
    `${base}/examples/generated-tabletop-${variant}.png`,
  );
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/png");
  const bytes = new Uint8Array(await image.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
}
for (const path of [
  "/.env.local",
  "/.liveworld/usage.json",
  "/src/config.mjs",
  "/package.json",
]) {
  const response = await fetch(base + path);
  assert.equal(response.status, 404, `${path} must not be served`);
}
const rejected = await fetch(base + "/api/playtest", {
  method: "POST",
  headers: {
    Origin: "https://untrusted.example",
    "Content-Type": "application/json",
  },
  body: "{}",
});
assert.equal(rejected.status, 403);
const wrongHostStatus = await new Promise((resolve, reject) => {
  get(
    base + "/api/status",
    { headers: { Host: "untrusted.example" } },
    (response) => {
      response.resume();
      resolve(response.statusCode);
    },
  ).on("error", reject);
});
assert.equal(wrongHostStatus, 403);
const simulation = await fetch(base + "/api/simulate", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ world: exampleWorld() }),
});
assert.equal(simulation.status, 200);
assert.equal((await simulation.json()).metrics.onTime, 20);
// Hold an incomplete body open: the paid-operation gate must be acquired before
// parsing it. Both bodies are invalid, so this check cannot call a model.
const before = await (await fetch(base + "/api/status")).json();
let finishSlow;
const slowResult = new Promise((resolve, reject) => {
  const slow = request(
    base + "/api/scan",
    { method: "POST", headers: { "Content-Type": "application/json" } },
    (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    },
  );
  slow.on("error", reject);
  finishSlow = () => slow.end("invalid");
  slow.write("{");
});
let concurrentStatus;
try {
  // The first socket has a head start; retry only the invalid local body if the
  // second socket is scheduled first. Neither request can reach inference.
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(base + "/api/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    concurrentStatus = response.status;
    await response.arrayBuffer();
    if (concurrentStatus === 409) break;
  }
} finally {
  finishSlow();
}
assert.equal(await slowResult, 400);
assert.equal(
  concurrentStatus,
  409,
  "An incomplete paid request must block another paid operation.",
);
const after = await (await fetch(base + "/api/status")).json();
assert.equal(after.budget.requests, before.budget.requests);
console.log(
  "Local HTTP checks passed: static page, private-file isolation, origin/host checks, simulation, paid-operation gate. No paid API calls.",
);
