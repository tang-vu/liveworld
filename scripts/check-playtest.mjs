import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { exampleWorld, applyPatch } from "../shared/world.js";
import { simulate, compareRuns } from "../shared/engine.js";

// Explicitly paid end-to-end check. Run against an already-started local backend.
const base = process.env.LIVEWORLD_BASE_URL ?? "http://127.0.0.1:4173";
const status = await (await fetch(base + "/api/status")).json();
if (
  !status.configured ||
  status.budget.blocked ||
  (status.accessRequired && !status.authorized)
)
  throw new Error(
    "Start an enabled local backend before this paid integration check.",
  );
const world = exampleWorld();
if (process.argv.includes("--renamed")) {
  Object.assign(world.bridges[0], {
    id: "crossing-upper",
    label: "Upper crossing",
  });
  Object.assign(world.bridges[1], {
    id: "crossing-meadow",
    label: "Meadowbridge",
  });
}
const baseline = simulate(world);
const response = await fetch(base + "/api/playtest", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    world,
    goal: "Find a one-edit change that gets every home its water by its deadline. Keep the same workers, demand, deadlines and resources. Inspect the measured outcome and use the available simulation tools to verify the best change.",
  }),
});
if (!response.ok)
  throw new Error((await response.json()).error ?? "Playtest request failed.");
const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = "";
let result = null;
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  let end;
  while ((end = buffer.indexOf("\n\n")) !== -1) {
    const block = buffer.slice(0, end);
    buffer = buffer.slice(end + 2);
    const data = block.split("\n").find((line) => line.startsWith("data: "));
    if (!data) continue;
    const event = JSON.parse(data.slice(6));
    if (event.type === "error") throw new Error(event.message);
    if (event.type === "complete") result = event.result;
  }
}
assert.ok(result, "The backend must return a completed result.");
assert.ok(result.experiments.length > 0 && result.experiments.length <= 32);
for (const trial of result.experiments) {
  const patched = applyPatch(world, trial.patch);
  assert.ok(patched.edits <= 1);
  const run = simulate(patched.world);
  assert.deepEqual(trial.evidence.metrics, run.metrics);
  assert.deepEqual(trial.comparison, compareRuns(baseline, run));
}
if (result.best) {
  const run = simulate(applyPatch(world, result.best.patch).world);
  assert.equal(result.verification.goalMet, run.metrics.allOnTime);
}
const after = await (await fetch(base + "/api/status")).json();
const verified = {
  runId: result.runId,
  testsRun: result.experiments.length,
  goalMet: result.verification.goalMet,
  verdict: result.verdict,
  onTime: result.best?.evidence.metrics.onTime ?? baseline.metrics.onTime,
  metaRequests: after.budget.requests - status.budget.requests,
  estimatedRunUsd: after.budget.spentUsd - status.budget.spentUsd,
  spentUsd: after.budget.spentUsd,
  heldUsd: after.budget.heldUsd,
};
await writeFile(
  new URL("../.liveworld/last-http-playtest-check.json", import.meta.url),
  JSON.stringify({ verified, result }, null, 2),
);
console.log(JSON.stringify(verified, null, 2));
