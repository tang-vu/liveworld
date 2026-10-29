import test from "node:test";
import assert from "node:assert/strict";
import { exampleWorld, applyPatch, validateWorld } from "../shared/world.js";
import { simulate, compareRuns } from "../shared/engine.js";
import { defaultContract, evaluateContract } from "../shared/contract.js";
import { readFile } from "node:fs/promises";
import { nudgeProposalBridge, searchLocal } from "../shared/experiments.js";
import { deliveryReceipts, householdComparison } from "../shared/receipts.js";
import { sensitivitySweep } from "../shared/sensitivity.js";
import {
  normalizeProject,
  makeCheckpoint,
  PROJECT_FORMAT,
} from "../shared/project.js";
import { runPlaytest } from "../src/agent.mjs";
import { compileContract } from "../src/contracts.mjs";

const brief = () => ({
  ...defaultContract(),
  minimumOnTime: 23,
  minimumPerHouse: 3,
  maximumWait: 5,
});
test("a creator's confirmed conditions change the chosen repair without changing resources", () => {
  const original = exampleWorld();
  const legacy = searchLocal(original);
  assert.equal(legacy.trials[0].evidence.metrics.onTime, 24);
  const world = { ...original, contract: brief() };
  const result = searchLocal(world);
  assert.equal(result.complete, true);
  assert.equal(result.checked, 22);
  assert.deepEqual(result.trials[0].patch, {
    bridgeMoves: [{ id: "bridge-north", y: 3 }],
  });
  assert.equal(result.trials[0].comparison.goalMet, true);
  assert.equal(result.trials[0].evidence.metrics.onTime, 23);
  assert.equal(result.trials[0].evidence.metrics.waitTicks, 2);
  assert.ok(result.trials[0].evidence.contract.checks.every((c) => c.passed));
  assert.deepEqual(result.trials[0].world.rules, original.rules);
  world.contract.minimumOnTime = 24;
  const strict = searchLocal(world);
  assert.equal(
    strict.trials.some((t) => t.comparison.goalMet),
    false,
  );
  assert.equal(strict.complete, true);
});
test("edit permissions and schema are enforced outside the model", () => {
  const world = {
    ...exampleWorld(),
    contract: { ...brief(), allowDispatch: false, bridgeIds: ["bridge-north"] },
  };
  assert.throws(() => applyPatch(world, { dispatch: "balanced" }), /locks/);
  assert.throws(
    () => applyPatch(world, { bridgeMoves: [{ id: "bridge-south", y: 6 }] }),
    /locks/,
  );
  assert.equal(searchLocal(world).checked, 10);
  for (const patch of [
    { version: 2 },
    { maximumWait: -1 },
    { bridgeIds: ["missing"] },
    { minimumOnTime: 25 },
    { minimumPerHouse: 5 },
    { cheat: true },
  ])
    assert.throws(() =>
      validateWorld({ ...world, contract: { ...brief(), ...patch } }),
    );
});
test("contract and checkpoint survive import; fabricated pass flags are discarded", () => {
  const world = { ...exampleWorld(), contract: brief() };
  const project = normalizeProject({
    format: PROJECT_FORMAT,
    world,
    briefInstruction:
      "At least 23 on time, every home at least 3, waiting at most 5.",
    checkpoints: [makeCheckpoint(world, null, "Confirmed brief", "cp")],
    trials: [
      {
        id: "t",
        kind: "agent",
        patch: { bridgeMoves: [{ id: "bridge-south", y: 6 }] },
        comparison: { goalMet: true },
      },
    ],
  });
  const opened = normalizeProject(JSON.parse(JSON.stringify(project)), {
    imported: true,
  });
  assert.deepEqual(opened.world.contract, brief());
  assert.equal(opened.briefInstruction, project.briefInstruction);
  assert.deepEqual(opened.checkpoints[0].world.contract, brief());
  assert.equal(opened.trials[0].comparison.goalMet, false);
  assert.equal(
    opened.trials[0].comparison.contract.checks.find((c) => c.id === "waiting")
      .passed,
    false,
  );
});
test("delivery receipts reconcile with engine events, frames and household totals", () => {
  for (const kind of ["bottleneck", "impossible", "disconnected"]) {
    const run = simulate(exampleWorld(kind)),
      receipts = deliveryReceipts(run);
    assert.equal(receipts.length, run.metrics.delivered);
    assert.equal(receipts.filter((r) => r.onTime).length, run.metrics.onTime);
    assert.equal(new Set(receipts.map((r) => r.id)).size, receipts.length);
    for (const r of receipts) {
      const events = r.evidenceRefs.map(
        (ref) => run.events[Number(ref.slice(6)) - 1],
      );
      assert.equal(events[0].type, "dispatch");
      assert.equal(events[1].tick, r.deliveredAt);
      assert.equal(r.slack, r.deadline - r.deliveredAt);
      assert.equal(r.outboundWaitingTurns, r.waitingAt.length);
      assert.ok(
        r.waitingAt.every(
          (t) => run.frames[t].agents.find((a) => a.id === r.agentId).waiting,
        ),
      );
    }
  }
  const a = simulate(exampleWorld());
  const b = simulate(
    applyPatch(a.world, { bridgeMoves: [{ id: "bridge-south", y: 6 }] }).world,
  );
  const rows = householdComparison(a, b);
  assert.equal(rows.find((r) => r.id === "h4").delta, 2);
  assert.equal(rows.find((r) => r.id === "h5").completedAfter, 66);
});
test("sensitivity compares the same perturbation on A/B and exposes a zero-margin repair", () => {
  const a = exampleWorld(),
    b = applyPatch(a, { bridgeMoves: [{ id: "bridge-south", y: 6 }] }).world;
  const saved = JSON.stringify([a, b]);
  const sweep = sensitivitySweep(a, b);
  assert.equal(sweep.validCases, 7);
  assert.equal(sweep.cases.find((c) => c.offset === 0).b.completionSlack, 0);
  assert.equal(sweep.cases.find((c) => c.offset === -1).b.metrics.onTime, 23);
  assert.equal(
    sweep.cases.find((c) => c.offset === -1).b.contract.passed,
    false,
  );
  assert.equal(JSON.stringify([a, b]), saved);
  assert.throws(() => sensitivitySweep(a, b, { axis: "seed" }));
});
test("agent selection uses confirmed contract even if model recommends nominal 24/24", async () => {
  let turn = 0;
  const world = { ...exampleWorld(), contract: brief() };
  const result = await runPlaytest(
    {
      chat: async () => ({
        message: turn++
          ? { content: "Choose 24/24 regardless of waiting." }
          : {
              tool_calls: [
                {
                  id: "s",
                  type: "function",
                  function: {
                    name: "search_one_edit",
                    arguments: '{"scope":"all"}',
                  },
                },
              ],
            },
      }),
    },
    { world, goal: "Find the best confirmed design." },
  );
  assert.equal(result.best.evidence.metrics.onTime, 23);
  assert.equal(result.verification.goalMet, true);
});
test("compiler refusal is atomic and returned contracts are validated", async () => {
  const input = {
    world: exampleWorld(),
    instruction: "At least 23 units and add a dragon.",
  };
  const client = (value) => ({
    chat: async () => ({ message: { content: JSON.stringify(value) } }),
  });
  const refused = await compileContract(
    client({
      explanation: "Unsupported dragon",
      unsupported: ["dragon"],
      contract: brief(),
    }),
    input,
  );
  assert.equal(refused.supported, false);
  assert.equal(refused.contract, undefined);
  await assert.rejects(() =>
    compileContract(
      client({
        explanation: "Cheat",
        unsupported: [],
        contract: { ...brief(), maximumWait: -1 },
      }),
      input,
    ),
  );
  const compiled = await compileContract(
    client({
      explanation: "A measurable brief",
      unsupported: [],
      contract: brief(),
    }),
    input,
  );
  assert.deepEqual(compiled.contract, brief());
});

test("nudging the selected proposal keeps the original world and rescores the brief", async () => {
  const project = JSON.parse(
    await readFile(
      new URL("../public/examples/creator-brief-project.json", import.meta.url),
      "utf8",
    ),
  );
  const original = project.world;
  const proposal = project.trials.find(
    (trial) => trial.patch?.dispatch === "balanced",
  ).world;
  const saved = JSON.stringify([original, proposal]);
  const bridge = proposal.bridges.reduce((lower, item) =>
    item.y > lower.y ? item : lower,
  );
  const nudged = nudgeProposalBridge(proposal, bridge.id, bridge.y - 1);
  assert.equal(JSON.stringify([original, proposal]), saved);
  assert.equal(nudged.rules.dispatch, "balanced");
  assert.equal(
    nudged.bridges.find((item) => item.id === bridge.id).y,
    bridge.y - 1,
  );
  assert.equal(
    evaluateContract(simulate(proposal), original.contract).passed,
    true,
  );
  assert.equal(
    evaluateContract(simulate(nudged), original.contract).passed,
    false,
  );
  assert.throws(() => nudgeProposalBridge(proposal, "missing", 1));
});
test("bridge sensitivity retains invalid conditions rather than hiding them from the denominator", () => {
  const a = exampleWorld();
  a.bridges[0].y = 0;
  const b = applyPatch(a, {
    bridgeMoves: [{ id: "bridge-south", y: 6 }],
  }).world;
  const sweep = sensitivitySweep(a, b, {
    axis: "bridge-position",
    bridgeId: "bridge-north",
  });
  assert.equal(sweep.cases.length, 3);
  assert.equal(sweep.cases.find((c) => c.offset === -1).valid, false);
  assert.equal(sweep.validCases, 2);
  assert.match(sweep.cases[0].reason, /Object y/);
});

test("a creator comparison cannot improve its score by replacing the original acceptance criteria", () => {
  const world = { ...exampleWorld(), contract: brief() },
    a = simulate(world);
  const altered = applyPatch(world, { dispatch: "balanced" }).world;
  altered.contract = { ...defaultContract(), minimumOnTime: 0 };
  const comparison = compareRuns(a, simulate(altered));
  assert.equal(comparison.goalMet, false);
  assert.equal(comparison.improved, false);
});
