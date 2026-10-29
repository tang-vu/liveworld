import { applyPatch, POLICIES, validateWorld } from "./world.js";
import { simulate, compareRuns, evidence } from "./engine.js";
import { rankRuns } from "./contract.js";

export function candidatePatches(world, scope = "all") {
  const patches = [];
  if (scope !== "bridges")
    for (const dispatch of POLICIES)
      if (
        dispatch !== world.rules.dispatch &&
        world.contract?.allowDispatch !== false
      )
        patches.push({
          patch: { dispatch },
          label: `Use ${dispatch} dispatch`,
        });
  if (scope !== "dispatch")
    for (let y = 0; y < world.height; y++)
      for (const bridge of world.bridges)
        if (
          y !== bridge.y &&
          (world.contract?.bridgeIds == null ||
            world.contract.bridgeIds.includes(bridge.id))
        )
          patches.push({
            patch: { bridgeMoves: [{ id: bridge.id, y }] },
            label: `Move ${bridge.label ?? bridge.id} to row ${y + 1}`,
          });
  return patches;
}

export function nudgeProposalBridge(proposal, bridgeId, y) {
  const world = validateWorld(structuredClone(proposal));
  const bridge = world.bridges.find((item) => item.id === bridgeId);
  if (!bridge) throw new Error("That bridge does not exist.");
  if (!Number.isInteger(y) || y < 0 || y >= world.height)
    throw new Error("Drop the bridge on a row inside the map.");
  bridge.y = y;
  return validateWorld(world);
}

export function searchLocal(world, limit = 32) {
  const baseline = simulate(world),
    valid = [];
  for (const item of candidatePatches(world)) {
    let changed;
    try {
      changed = applyPatch(world, item.patch);
    } catch {
      continue;
    }
    valid.push({ ...item, world: changed.world });
  }
  const trials = valid.slice(0, limit).map((item, i) => {
    const run = simulate(item.world);
    return {
      ...item,
      id: `local-${i + 1}`,
      kind: "local",
      source: "local-sweep",
      comparison: compareRuns(baseline, run),
      evidence: evidence(run),
    };
  });
  trials.sort((a, b) =>
    rankRuns(
      {
        world: a.world,
        metrics: a.evidence.metrics,
        houses: a.evidence.households,
      },
      {
        world: b.world,
        metrics: b.evidence.metrics,
        houses: b.evidence.households,
      },
    ),
  );
  return {
    trials,
    checked: trials.length,
    validCandidates: valid.length,
    complete: trials.length === valid.length,
  };
}
