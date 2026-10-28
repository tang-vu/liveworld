import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { validateWorld } from "../shared/world.js";
import { simulate } from "../shared/engine.js";

// Compare actual UI exports after each generated image has gone through Meta.
// This verifies grid-level correspondence, not pixel equality or camera accuracy.
const a = JSON.parse(
  await readFile(
    process.argv[2] ??
      new URL("../public/examples/generated-capture-a.json", import.meta.url),
    "utf8",
  ),
);
const b = JSON.parse(
  await readFile(
    process.argv[3] ??
      new URL("../public/examples/generated-capture-b.json", import.meta.url),
    "utf8",
  ),
);
assert.equal(a.world.provenance?.type, "synthetic");
assert.equal(a.world.provenance?.fixture, "a");
assert.equal(b.world.provenance?.type, "synthetic");
assert.equal(b.world.provenance?.fixture, "b");
const aw = validateWorld(a.world);
const bw = validateWorld(b.world);
const entities = (w) => [
  { ...w.source, role: "source" },
  ...w.houses.map((o) => ({ ...o, role: "house" })),
  ...w.bridges.map((o) => ({ ...o, role: "bridge" })),
  ...w.obstacles.map((o) => ({ ...o, role: "obstacle" })),
];
const original = new Map(entities(aw).map((o) => [o.id, o]));
const rescanned = new Map(entities(bw).map((o) => [o.id, o]));
const added = [...rescanned.keys()].filter((id) => !original.has(id));
const removed = [...original.keys()].filter((id) => !rescanned.has(id));
const moved = [...rescanned.values()]
  .filter(
    (o) =>
      original.has(o.id) &&
      (o.x !== original.get(o.id).x || o.y !== original.get(o.id).y),
  )
  .map((o) => ({
    id: o.id,
    label: o.label,
    role: o.role,
    from: { x: original.get(o.id).x, y: original.get(o.id).y },
    to: { x: o.x, y: o.y },
  }));
const ar = simulate(aw);
const br = simulate(bw);
assert.deepEqual(ar.metrics, a.baseline.metrics);
assert.deepEqual(br.metrics, b.baseline.metrics);
const report = {
  format: "liveworld-generated-capture-check-v1",
  inputSource: "AI-generated images; not real camera captures",
  runtimeModels: ["muse-spark-1.3", "sam-3.1"],
  originalObjects: original.size,
  rescannedObjects: rescanned.size,
  matchedIdentities: [...original.keys()].filter((id) => rescanned.has(id))
    .length,
  added,
  removed,
  moved,
  unchangedGridPositions: [...rescanned.values()].filter(
    (o) =>
      original.has(o.id) &&
      o.x === original.get(o.id).x &&
      o.y === original.get(o.id).y,
  ).length,
  sameRules: JSON.stringify(aw.rules) === JSON.stringify(bw.rules),
  singleBridgeMoveDetected:
    added.length === 0 &&
    removed.length === 0 &&
    moved.length === 1 &&
    moved[0].role === "bridge",
  measurements: { a: ar.metrics, b: br.metrics },
  limitation:
    "This result covers this generated pair only. It does not establish physical camera reliability, general tracking accuracy, or pixel-identical preservation outside the edit.",
};
const reportPath = new URL(
  "../public/examples/generated-capture-check.json",
  import.meta.url,
);
let previousReport;
try {
  previousReport = JSON.parse(await readFile(reportPath, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (JSON.stringify(previousReport) !== JSON.stringify(report))
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
if (!report.singleBridgeMoveDetected || !report.sameRules) process.exitCode = 1;
