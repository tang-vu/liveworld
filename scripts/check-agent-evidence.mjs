import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { applyPatch } from "../shared/world.js";
import { simulate, evidence, compareRuns } from "../shared/engine.js";
const data = JSON.parse(
  await fs.readFile(
    new URL("../public/examples/agent-id-check.json", import.meta.url),
    "utf8",
  ),
);
const { result } = data;
assert.ok(result.startingWorld.bridges.some((b) => b.id === "crossing-meadow"));
const baseline = simulate(result.startingWorld);
assert.deepEqual(evidence(baseline), result.baseline);
for (const t of result.experiments) {
  const candidate = simulate(applyPatch(result.startingWorld, t.patch).world);
  assert.deepEqual(evidence(candidate), t.evidence);
  assert.deepEqual(compareRuns(baseline, candidate), t.comparison);
}
assert.ok(result.best);
const best = simulate(
  applyPatch(result.startingWorld, result.best.patch).world,
);
assert.equal(best.metrics.allOnTime, result.verification.goalMet);
assert.equal(result.experiments.length, data.verified.testsRun);
console.log(
  JSON.stringify({
    mode: "offline-replay",
    runId: result.runId,
    trials: result.experiments.length,
    onTime: best.metrics.onTime,
    goalMet: best.metrics.allOnTime,
    metaRequests: 0,
  }),
);
