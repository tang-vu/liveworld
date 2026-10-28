import test from "node:test";
import assert from "node:assert/strict";
import { compileRuleChange } from "../src/rules.mjs";
import { exampleWorld } from "../shared/world.js";

function client(proposal) {
  return {
    config: { model: "test-meta" },
    async chat(messages, options) {
      assert.equal(options.format.response_format.json_schema.strict, true);
      assert.ok(options.maxOutput <= 2048);
      assert.equal(messages[1].role, "user");
      return { message: { content: JSON.stringify(proposal) } };
    },
  };
}
const proposal = () => ({
  explanation: "Use eight couriers.",
  unsupported: [],
  rules: { couriers: 8 },
  allHouseholds: {},
  households: [],
});

test("rule compiler returns measured outcomes independently of model prose", async () => {
  const input = exampleWorld();
  const answer = proposal();
  answer.explanation = "All 1000 deliveries succeeded.";
  const result = await compileRuleChange(client(answer), {
    world: input,
    instruction: "Use eight couriers.",
  });
  assert.equal(input.rules.couriers, 6);
  assert.equal(result.world.rules.couriers, 8);
  assert.equal(result.evidence.metrics.demand, 24);
  assert.equal(result.evidence.metrics.onTime, 24);
  assert.equal(result.comparison.sameSeed, true);
  assert.deepEqual(result.world.bridges, input.bridges);
});

test("unsupported rule requests do not silently apply partial changes", async () => {
  const answer = proposal();
  answer.unsupported = ["Flying couriers are not supported."];
  const result = await compileRuleChange(client(answer), {
    world: exampleWorld(),
    instruction: "Add flying couriers.",
  });
  assert.equal(result.supported, false);
  assert.equal(result.world, undefined);
});

test("rule compiler rejects invalid instructions, out-of-range values and injected fields", async () => {
  let called = false;
  await assert.rejects(
    compileRuleChange(
      {
        chat() {
          called = true;
        },
      },
      { world: exampleWorld(), instruction: "" },
    ),
  );
  assert.equal(called, false);
  for (const rules of [{ couriers: 100 }, { execute: "anything" }]) {
    const answer = proposal();
    answer.rules = rules;
    await assert.rejects(
      compileRuleChange(client(answer), {
        world: exampleWorld(),
        instruction: "Change rules.",
      }),
    );
  }
});
