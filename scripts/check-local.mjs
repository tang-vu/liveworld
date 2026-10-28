import assert from "node:assert/strict";
import { get } from "node:http";
import { exampleWorld } from "../shared/world.js";

const base = "http://127.0.0.1:4173";
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
console.log(
  "Local HTTP checks passed: static page, private-file isolation, origin/host checks, simulation. No paid API calls.",
);
