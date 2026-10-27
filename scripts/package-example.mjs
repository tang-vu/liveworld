import { readFile, readdir, writeFile, mkdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { exampleWorld, applyPatch } from "../shared/world.js";
import { simulate, evidence, compareRuns } from "../shared/engine.js";

const directory = new URL("../.liveworld/runs/", import.meta.url);
const candidates = [];
for (const file of await readdir(directory)) {
  const location = new URL(file, directory);
  const data = JSON.parse(await readFile(location, "utf8"));
  if (data.model === "muse-spark-1.3" && data.verdict === "goal_met")
    candidates.push({ data, modified: (await stat(location)).mtime });
}
candidates.sort((a, b) => b.modified - a.modified);
if (!candidates.length)
  throw new Error("No successful real Meta run is available.");
const { data, modified } = candidates[0];
const startingWorld = data.startingWorld ?? exampleWorld();
const hash = createHash("sha256")
  .update(JSON.stringify(startingWorld))
  .digest("hex")
  .slice(0, 16);
if (hash !== data.worldHash)
  throw new Error("The starting world does not match the recorded run.");
const baseline = simulate(startingWorld);
const experiments = data.experiments.map((trial) => {
  const world = applyPatch(startingWorld, trial.patch).world;
  const run = simulate(world);
  if (JSON.stringify(run.metrics) !== JSON.stringify(trial.evidence.metrics))
    throw new Error("Recorded measurements could not be reproduced.");
  return {
    ...trial,
    world,
    evidence: evidence(run),
    comparison: compareRuns(baseline, run),
  };
});
const artifact = {
  source: "recorded-meta-run",
  recordedAt: modified.toISOString(),
  runId: data.runId,
  model: data.model,
  worldHash: hash,
  startingWorld,
  goal: data.goal,
  verdict: data.verdict,
  summary: data.summary,
  baseline: evidence(baseline),
  experiments,
  best: { id: data.best.id },
  verification: data.verification,
  note: "An actual Meta-powered agent run on the authored example. No real-world performance claim. All metrics are reproducible with the included simulator.",
};
await mkdir(new URL("../public/examples/", import.meta.url), {
  recursive: true,
});
await writeFile(
  new URL("../public/examples/valley-playtest.json", import.meta.url),
  JSON.stringify(artifact, null, 2),
);
console.log(
  JSON.stringify({
    model: artifact.model,
    trials: experiments.length,
    goalMet: artifact.verification.goalMet,
    reproduced: true,
  }),
);
