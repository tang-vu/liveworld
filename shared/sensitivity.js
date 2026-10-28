import { simulate } from "./engine.js";
import { validateWorld } from "./world.js";
import { evaluateContract } from "./contract.js";

// Finite, declared design perturbations. Not independent random samples and
// never a statistical reliability estimate. A/B receive identical conditions.
export function sensitivitySweep(
  original,
  proposed,
  { axis = "deadlines", bridgeId = null } = {},
) {
  const a = validateWorld(original),
    b = validateWorld(proposed);
  if (!["deadlines", "bridge-position"].includes(axis))
    throw new Error("Unknown sensitivity axis.");
  if (
    axis === "bridge-position" &&
    (!a.bridges.some((x) => x.id === bridgeId) ||
      !b.bridges.some((x) => x.id === bridgeId))
  )
    throw new Error("Choose a bridge present in both worlds.");
  const offsets = axis === "deadlines" ? [-3, -2, -1, 0, 1, 2, 3] : [-1, 0, 1];
  const cases = offsets.map((offset) => {
    const worlds = [a, b].map((world) => {
      const changed = structuredClone(world);
      if (axis === "deadlines")
        changed.houses.forEach((h) => {
          h.deadline += offset;
        });
      else changed.bridges.find((x) => x.id === bridgeId).y += offset;
      return changed;
    });
    try {
      worlds.forEach(validateWorld);
    } catch (error) {
      return { offset, valid: false, reason: error.message };
    }
    const runs = worlds.map(simulate);
    const results = runs.map((r) => ({
      metrics: r.metrics,
      contract: evaluateContract(r, a.contract),
      completionSlack: r.houses.every((h) => h.completedAt !== null)
        ? Math.min(...r.houses.map((h) => h.deadline - h.completedAt))
        : null,
    }));
    return { offset, valid: true, a: results[0], b: results[1] };
  });
  return {
    version: 1,
    axis,
    bridgeId,
    offsets,
    cases,
    validCases: cases.filter((c) => c.valid).length,
    passedA: cases.filter((c) => c.valid && c.a.contract.passed).length,
    passedB: cases.filter((c) => c.valid && c.b.contract.passed).length,
    scope:
      "Selected deterministic design conditions only; not a probability or proof beyond this set. Each condition is applied to A and B before a new comparison. No API usage.",
  };
}
