import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { applyPatch } from "../shared/world.js";
import { applyRuleChange } from "../shared/rules.js";
import { simulate, evidence } from "../shared/engine.js";
import { normalizeProject } from "../shared/project.js";
import { experimentReport } from "../public/report.js";
const root = new URL("../public/examples/", import.meta.url);
const read = async (name) =>
  JSON.parse(await fs.readFile(new URL(name, root), "utf8"));
const design = await read("closed-crossing-design.json");
const run = await read("closed-crossing-playtest.json");
const a = simulate(design.startingWorld);
const changed = applyRuleChange(design.startingWorld, design.proposal).world;
const b = simulate(changed);
assert.deepEqual(evidence(b), design.evidence);
assert.deepEqual(changed, run.startingWorld);
assert.deepEqual(evidence(b), run.baseline);
for (const t of run.experiments) {
  const w = applyPatch(run.startingWorld, t.patch).world;
  const result = simulate(w);
  assert.deepEqual(result.metrics, t.evidence.metrics);
  assert.deepEqual(
    w.events,
    run.startingWorld.events,
    "the playtester must retain the designer's schedule",
  );
}
assert.equal(a.metrics.onTime, 20);
assert.equal(b.metrics.onTime, 16);
assert.equal(run.best.evidence.metrics.onTime, 22);
assert.equal(run.verification.goalMet, false);
assert.equal(run.verdict, "improved");
const designProject = normalizeProject(
  await read("closed-crossing-project.json"),
  { imported: true },
);
const repairProject = normalizeProject(
  await read("closed-crossing-repairs-project.json"),
  { imported: true },
);
assert.equal(
  designProject.trials.find((t) => t.id === designProject.selectedTrialId)
    .evidence.metrics.onTime,
  16,
);
assert.equal(
  repairProject.trials.find((t) => t.id === repairProject.selectedTrialId)
    .evidence.metrics.onTime,
  22,
);
const report = experimentReport(repairProject);
assert.ok(report.includes("Playable schedule") && report.includes("25–50"));
const hashes = {};
for (const name of [
  "closed-crossing-design.json",
  "closed-crossing-playtest.json",
  "closed-crossing-project.json",
  "closed-crossing-repairs-project.json",
])
  hashes[name] = createHash("sha256")
    .update(await fs.readFile(new URL(name, root)))
    .digest("hex");
const result = {
  format: "liveworld-mechanics-check-v1",
  source: "Recorded Meta calls; outcomes independently recomputed",
  model: design.model,
  designId: design.designId,
  runId: run.runId,
  schedule: changed.events,
  originalOnTime: a.metrics.onTime,
  scheduledOnTime: b.metrics.onTime,
  bestRepairOnTime: run.best.evidence.metrics.onTime,
  demand: b.metrics.demand,
  trials: run.experiments.length,
  goalMet: false,
  hashes,
  scope:
    "One authored scheduled-mechanic study. This is not a general success-rate or camera benchmark.",
};
await fs.writeFile(
  new URL("closed-crossing-check.json", root),
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result, null, 2));
