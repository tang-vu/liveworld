import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { simulate, evidence, compareRuns } from "../shared/engine.js";
import { validateWorld, applyPatch } from "../shared/world.js";
import { defaultContract, evaluateContract } from "../shared/contract.js";
import {
  normalizeProject,
  PROJECT_FORMAT,
  makeCheckpoint,
} from "../shared/project.js";
import { experimentReport } from "../public/report.js";

const read = async (name) =>
  JSON.parse(
    await readFile(
      new URL(`../public/examples/${name}`, import.meta.url),
      "utf8",
    ),
  );
const a = await read("generated-capture-a.json"),
  b = await read("generated-capture-b.json");
const instruction =
  "At least 20 water units on time, at least 3 on-time water units at EVERY home, and at most 10 total courier waiting turns. Permit either one existing bridge move or one dispatch policy change. Keep workers, demand, deadlines, production and schedule unchanged.";
const expected = {
  ...defaultContract(),
  minimumOnTime: 20,
  minimumPerHouse: 3,
  maximumWait: 10,
};
const file = new URL(
  "../public/examples/creator-brief-study.json",
  import.meta.url,
);
let record;
if (process.argv.includes("--live")) {
  const base = new URL(
    process.env.LIVEWORLD_BASE_URL ?? "http://127.0.0.1:4173",
  );
  if (base.hostname !== "127.0.0.1" || base.protocol !== "http:")
    throw new Error("Use the local backend.");
  const status = async () => {
    const r = await fetch(new URL("/api/status", base));
    assert.ok(r.ok);
    return r.json();
  };
  const before = await status();
  assert.ok(
    before.configured && !before.budget.blocked && !before.budget.heldUsd,
  );
  const response = await fetch(new URL("/api/contract", base), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ world: a.world, instruction }),
  });
  const translation = await response.json();
  assert.ok(response.ok, translation.error);
  assert.equal(translation.supported, true);
  assert.deepEqual(translation.contract, expected);
  const world = validateWorld({ ...a.world, contract: translation.contract });
  const agent = await fetch(new URL("/api/playtest", base), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      world,
      goal: "Investigate a one-edit design under the confirmed test brief. Inspect which homes meet their floor and the waiting tradeoff. Use tools to verify a recommendation; report any remaining late units honestly.",
    }),
  });
  if (!agent.ok) throw new Error((await agent.json()).error);
  let result = null;
  for (const block of (await agent.text()).split("\n\n")) {
    const line = block.split("\n").find((x) => x.startsWith("data: "));
    if (!line) continue;
    const event = JSON.parse(line.slice(6));
    if (event.type === "error") throw new Error(event.message);
    if (event.type === "complete") result = event.result;
  }
  assert.ok(result, "A completed run is required.");
  const after = await status();
  record = {
    format: "liveworld-creator-study-v1",
    createdAt: new Date().toISOString(),
    scope:
      "Authored showcase on previously observed synthetic inputs, not a held-out benchmark or a physical-camera test. Contract chosen to demonstrate household fairness; inference waits omitted in the film.",
    instruction,
    translation,
    result,
    requests: after.budget.requests - before.budget.requests,
    estimatedCostUsd: Number(
      (after.budget.spentUsd - before.budget.spentUsd).toFixed(6),
    ),
  };
  await writeFile(file, JSON.stringify(record, null, 2) + "\n");
} else record = await read("creator-brief-study.json");
assert.equal(record.instruction, instruction);
assert.deepEqual(record.translation.contract, expected);
const world = validateWorld({ ...a.world, contract: expected }),
  baseline = simulate(world);
assert.deepEqual(record.result.startingWorld, world);
const experiments = record.result.experiments;
for (const trial of experiments) {
  const run = simulate(applyPatch(world, trial.patch).world);
  assert.deepEqual(trial.evidence, evidence(run));
  assert.deepEqual(trial.comparison, compareRuns(baseline, run));
}
assert.ok(record.result.best);
const best = simulate(applyPatch(world, record.result.best.patch).world);
assert.equal(evaluateContract(best).passed, true);
assert.equal(best.metrics.onTime, 20);
assert.equal(best.metrics.waitTicks, 7);
assert.ok(best.houses.every((h) => h.onTime >= 3));
const moved = validateWorld({ ...b.world, contract: expected });
assert.equal(evaluateContract(simulate(moved)).passed, false);
const project = normalizeProject({
  format: PROJECT_FORMAT,
  name: "A fair delivery brief",
  briefInstruction: instruction,
  world,
  photo: "/examples/generated-tabletop-a.png",
  checkpoints: [
    makeCheckpoint(
      world,
      "/examples/generated-tabletop-a.png",
      "Confirmed fairness brief",
      "creator-baseline",
      record.createdAt,
    ),
  ],
  trials: [
    {
      id: "rescan-counterexample",
      kind: "capture",
      source: "recorded-meta-capture",
      label: "A moved stick: less waiting, one home loses out",
      world: moved,
      photo: "/examples/generated-tabletop-b.png",
    },
    ...experiments.map((t) => ({
      ...t,
      kind: "agent",
      source: "recorded-meta-run",
    })),
  ],
  selectedTrialId: record.result.best.id,
  tick: best.metrics.completedAt,
  runSummary: {
    source: "recorded-meta-run",
    model: record.result.model,
    goal: instruction,
    summary: record.result.summary,
  },
});
if (process.argv.includes("--live") || process.argv.includes("--package")) {
  await writeFile(
    new URL("../public/examples/creator-brief-project.json", import.meta.url),
    JSON.stringify(project, null, 2) + "\n",
  );
  const report = experimentReport(project),
    style = report.match(/<style>([\s\S]*?)<\/style>/);
  assert.ok(style);
  await writeFile(
    new URL("../demo/creator-brief-report.html", import.meta.url),
    report,
  );
  await writeFile(
    new URL("../public/examples/creator-brief-report.css", import.meta.url),
    style[1],
  );
  await writeFile(
    new URL("../public/examples/creator-brief-report.html", import.meta.url),
    report.replace(
      style[0],
      '<link rel="stylesheet" href="/examples/creator-brief-report.css">',
    ),
  );
} else {
  assert.ok(
    isDeepStrictEqual(
      normalizeProject(await read("creator-brief-project.json")),
      project,
    ),
    "The packaged project must retain the verified study.",
  );
}
console.log(
  JSON.stringify({
    mode: process.argv.includes("--live") ? "live" : "offline-replay",
    trials: experiments.length,
    onTime: best.metrics.onTime,
    wait: best.metrics.waitTicks,
    minimumHomeOnTime: Math.min(...best.houses.map((h) => h.onTime)),
    briefPass: true,
    requests: record.requests,
    estimatedCostUsd: record.estimatedCostUsd,
  }),
);
