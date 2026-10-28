import { validateWorld } from "../shared/world.js";
import { applyRuleChange } from "../shared/rules.js";
import { simulate, evidence, compareRuns } from "../shared/engine.js";

const nullableInteger = { type: ["integer", "null"] };
const object = (properties) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const household = object({
  demand: nullableInteger,
  deadline: nullableInteger,
});
const schema = object({
  explanation: { type: "string" },
  unsupported: { type: "array", items: { type: "string" } },
  rules: object({
    dispatch: {
      type: ["string", "null"],
      enum: ["nearest", "balanced", "deadline", null],
    },
    couriers: nullableInteger,
    bridgeCapacity: nullableInteger,
    productionInterval: nullableInteger,
    horizon: nullableInteger,
  }),
  allHouseholds: household,
  households: {
    type: "array",
    items: object({
      id: { type: "string" },
      demand: nullableInteger,
      deadline: nullableInteger,
    }),
  },
});

export async function compileRuleChange(client, input) {
  const world = validateWorld(input.world);
  if (
    typeof input.instruction !== "string" ||
    !input.instruction.trim() ||
    input.instruction.length > 2000
  )
    throw new Error("Describe a rule change in 1–2000 characters.");
  const response = await client.chat(
    [
      {
        role: "system",
        content: `Translate the game designer's instruction into a constrained rule proposal. Do not execute code or modify layout. Supported fields: dispatch (nearest/balanced/deadline), couriers (1–12), bridgeCapacity (1–3 couriers on each bridge), productionInterval (1–12 turns per water unit), horizon (10–240 turns), household demand (1–12 water units), and household deadline (1–240 turns). A smaller productionInterval means faster production. Use null for unchanged fields and an empty households array unless specific homes need changes. allHouseholds applies before per-household overrides. Resolve home names to exact IDs from the world. If the instruction requests an unsupported mechanic, ambiguous household, additional resource, negative quantity, or changing positions, list the unsupported request and do not invent an approximation. Keep the explanation brief and user-facing. Never claim a simulated outcome. WORLD: ${JSON.stringify(world)}`,
      },
      { role: "user", content: input.instruction },
    ],
    {
      maxOutput: 2048,
      format: {
        response_format: {
          type: "json_schema",
          json_schema: { name: "liveworld_rule_change", strict: true, schema },
        },
      },
    },
  );
  let proposal;
  try {
    proposal = JSON.parse(response.message.content);
  } catch {
    throw new Error("Meta returned an invalid rule proposal.");
  }
  if (
    !Array.isArray(proposal.unsupported) ||
    proposal.unsupported.some((item) => typeof item !== "string")
  )
    throw new Error("The rule proposal is malformed.");
  if (proposal.unsupported.length)
    return {
      supported: false,
      explanation: String(proposal.explanation).slice(0, 1000),
      unsupported: proposal.unsupported
        .slice(0, 12)
        .map((s) => s.slice(0, 200)),
    };
  const change = {
    rules: proposal.rules,
    allHouseholds: proposal.allHouseholds,
    households: proposal.households,
  };
  const applied = applyRuleChange(world, change);
  const baseline = simulate(world);
  const candidate = simulate(applied.world);
  return {
    supported: true,
    explanation: String(proposal.explanation).slice(0, 1000),
    instruction: input.instruction,
    proposal: change,
    world: applied.world,
    changes: applied.changes,
    evidence: evidence(candidate),
    comparison: compareRuns(baseline, candidate),
    model: client.config.model,
  };
}
