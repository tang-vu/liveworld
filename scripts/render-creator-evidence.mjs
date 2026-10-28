// Generate labelled evidence diagrams, not simulated application screenshots.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { normalizeProject } from "../shared/project.js";
import { simulate } from "../shared/engine.js";
import { deliveryReceipts, householdComparison } from "../shared/receipts.js";
import { sensitivitySweep } from "../shared/sensitivity.js";
const project = normalizeProject(
  JSON.parse(
    await readFile(
      new URL("../public/examples/creator-brief-project.json", import.meta.url),
      "utf8",
    ),
  ),
);
const a = simulate(project.world),
  b = simulate(
    project.trials.find((t) => t.id === project.selectedTrialId).world,
  ),
  moved = simulate(
    project.trials.find((t) => t.id === "rescan-counterexample").world,
  );
const exportedBytes = await readFile(
  new URL("../demo/creator-example-project.json", import.meta.url),
);
const exported = normalizeProject(JSON.parse(exportedBytes), {
  imported: true,
});
const selected = exported.trials.find((t) => t.id === exported.selectedTrialId);
if (!selected?.comparison.goalMet)
  throw new Error("The actual UI export must recompute to a passing brief.");
const facts = {
  format: "liveworld-film-evidence-v1",
  scope:
    "Recomputed engine evidence diagrams, not application screenshots or new Meta calls.",
  receipts: {
    a: deliveryReceipts(a, "photo-6-mvrnpfil"),
    b: deliveryReceipts(b, "photo-6-mvrnpfil"),
  },
  households: householdComparison(a, moved),
  sensitivity: sensitivitySweep(a.world, b.world, {
    axis: "bridge-position",
    bridgeId: "photo-9-mvrnpfil",
  }),
  export: {
    sha256: createHash("sha256").update(exportedBytes).digest("hex"),
    contract: exported.world.contract,
    checkpoints: exported.checkpoints.length,
    trials: exported.trials.length,
    onTime: selected.evidence.metrics.onTime,
    wait: selected.evidence.metrics.waitTicks,
    passed: selected.comparison.goalMet,
  },
};
const folder = new URL("../.liveworld/creator-film/", import.meta.url);
await mkdir(folder, { recursive: true });
const destination = new URL("evidence-facts.json", folder);
await writeFile(destination, JSON.stringify(facts, null, 2));
const result = spawnSync(
  "python",
  [
    fileURLToPath(new URL("render-creator-evidence.py", import.meta.url)),
    fileURLToPath(destination),
  ],
  { encoding: "utf8" },
);
if (result.status !== 0)
  throw new Error(result.stderr || result.error?.message);
console.log(result.stdout.trim());
