import test from "node:test";
import assert from "node:assert/strict";
import { runPlaytest } from "../src/agent.mjs";
import { exampleWorld } from "../shared/world.js";

test("agent cannot self-certify a fix without a successful simulation", async () => {
  const client = {
    chat: async () => ({
      message: { content: "I fixed everything. All deadlines met." },
    }),
  };
  const result = await runPlaytest(client, {
    world: exampleWorld(),
    goal: "Fix deadlines.",
  });
  assert.equal(result.verdict, "no_improvement");
  assert.equal(result.verification.goalMet, false);
  assert.equal(result.experiments.length, 0);
});
test("real tool results distinguish failed proposals from a verified fix", async () => {
  let turn = 0;
  const replies = [
    {
      tool_calls: [
        {
          id: "c1",
          type: "function",
          function: {
            name: "test_change",
            arguments: JSON.stringify({
              label: "Balance deliveries",
              dispatch: "balanced",
              bridge_id: null,
              bridge_row: null,
            }),
          },
        },
      ],
    },
    {
      tool_calls: [
        {
          id: "c2",
          type: "function",
          function: {
            name: "test_change",
            arguments: JSON.stringify({
              label: "Move south crossing",
              dispatch: null,
              bridge_id: "bridge-south",
              bridge_row: 6,
            }),
          },
        },
      ],
    },
    { content: "The second trial meets every deadline." },
  ];
  const result = await runPlaytest(
    { chat: async () => ({ message: replies[turn++] }) },
    { world: exampleWorld(), goal: "Fix deadlines." },
  );
  assert.equal(result.experiments[0].comparison.goalMet, false);
  assert.equal(result.experiments[1].comparison.goalMet, true);
  assert.equal(result.verdict, "goal_met");
  assert.equal(result.verification.goalMet, true);
  assert.equal(
    result.best.world.rules.couriers,
    result.experiments[0].world.rules.couriers,
  );
});
test("combined edits are refused by code even if requested by the model", async () => {
  let turn = 0;
  const result = await runPlaytest(
    {
      chat: async () => ({
        message: turn++
          ? { content: "Done." }
          : {
              tool_calls: [
                {
                  id: "c",
                  type: "function",
                  function: {
                    name: "test_change",
                    arguments: JSON.stringify({
                      label: "Cheat",
                      dispatch: "balanced",
                      bridge_id: "bridge-south",
                      bridge_row: 6,
                    }),
                  },
                },
              ],
            },
      }),
    },
    { world: exampleWorld(), goal: "Fix it." },
  );
  assert.equal(result.experiments.length, 0);
  assert.equal(result.verdict, "no_improvement");
  assert.ok(result.trace.some((e) => e.type === "rejected"));
});
test("bounded search returns a verified candidate rather than trusting the model conclusion", async () => {
  let turn = 0;
  const result = await runPlaytest(
    {
      chat: async () => ({
        message: turn++
          ? { content: "Search completed." }
          : {
              tool_calls: [
                {
                  id: "search-1",
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
    { world: exampleWorld(), goal: "Find a fix." },
  );
  assert.equal(result.verdict, "goal_met");
  assert.equal(result.best.evidence.metrics.onTime, 24);
  assert.ok(result.experiments.length <= 32);
  for (const trial of result.experiments)
    assert.equal(
      trial.world.rules.couriers,
      result.startingWorld.rules.couriers,
    );
});
