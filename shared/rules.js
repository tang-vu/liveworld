import { validateWorld } from "./world.js";

const ruleFields = [
  "dispatch",
  "couriers",
  "bridgeCapacity",
  "productionInterval",
  "horizon",
];
const householdFields = ["demand", "deadline"];
function object(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object.`);
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error(`${label} contains an unsupported field.`);
}

export function applyRuleChange(input, proposal) {
  const world = validateWorld(input);
  object(
    proposal,
    ["rules", "allHouseholds", "households", "events"],
    "Rule change",
  );
  const changes = [];
  const update = (target, field, value, label, id) => {
    if (value === undefined || value === null || target[field] === value)
      return;
    changes.push({ id, field, before: target[field], after: value, label });
    target[field] = value;
  };
  if (proposal.rules != null) {
    object(proposal.rules, ruleFields, "Simulation rules");
    for (const field of ruleFields)
      update(world.rules, field, proposal.rules[field], field, "rules");
  }
  if (proposal.allHouseholds != null) {
    object(proposal.allHouseholds, householdFields, "Household defaults");
    for (const house of world.houses)
      for (const field of householdFields)
        update(
          house,
          field,
          proposal.allHouseholds[field],
          house.label ?? house.id,
          house.id,
        );
  }
  if (proposal.households != null) {
    if (!Array.isArray(proposal.households) || proposal.households.length > 12)
      throw new Error("Change at most 12 households.");
    const seen = new Set();
    for (const change of proposal.households) {
      object(change, ["id", ...householdFields], "Household change");
      if (seen.has(change.id))
        throw new Error("A household may only appear once.");
      seen.add(change.id);
      const house = world.houses.find((h) => h.id === change.id);
      if (!house) throw new Error("The requested household does not exist.");
      for (const field of householdFields)
        update(house, field, change[field], house.label ?? house.id, house.id);
    }
  }
  if (
    proposal.events != null &&
    JSON.stringify(proposal.events) !== JSON.stringify(world.events ?? [])
  ) {
    changes.push({
      id: "events",
      field: "events",
      before: world.events ?? [],
      after: proposal.events,
      label: "Scheduled mechanics",
    });
    world.events = proposal.events;
  }
  if (!changes.length)
    throw new Error("This proposal does not change any rules.");
  return { world: validateWorld(world), changes };
}

export function ruleChangeFromForm(values) {
  return {
    rules: Object.fromEntries(
      ruleFields.map((field) => [
        field,
        field === "dispatch" ? values[field] : Number(values[field]),
      ]),
    ),
  };
}
