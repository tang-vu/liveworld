import { exampleWorld, applyPatch } from "../shared/world.js";
import { simulate, compareRuns } from "../shared/engine.js";

for (const kind of ["bottleneck", "disconnected", "impossible"]) {
  const world = exampleWorld(kind);
  const baseline = simulate(world);
  console.log(
    JSON.stringify({
      scenario: kind,
      dispatch: "nearest",
      ...baseline.metrics,
    }),
  );
  for (const dispatch of ["balanced", "deadline"]) {
    const candidate = simulate(applyPatch(world, { dispatch }).world);
    console.log(
      JSON.stringify({
        scenario: kind,
        dispatch,
        ...candidate.metrics,
        comparison: compareRuns(baseline, candidate),
      }),
    );
  }
}
