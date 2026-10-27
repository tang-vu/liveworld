import { readConfig } from "../src/config.mjs";
import { BudgetLedger } from "../src/budget.mjs";
import { MetaClient, scanTabletop } from "../src/meta.mjs";
import { makeTestScene } from "./make-test-scene.mjs";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";

// Explicitly paid integration check on a synthetic scene, not a physical-table evaluation.
const config = readConfig();
const directory = fileURLToPath(new URL("../.liveworld/", import.meta.url));
const ledger = new BudgetLedger(directory, config);
const client = new MetaClient(config, ledger);
const image = makeTestScene();
try {
  const result = await scanTabletop(client, {
    width: image.width,
    height: image.height,
    dataUrl: `data:image/png;base64,${image.bytes.toString("base64")}`,
  });
  await writeFile(
    new URL("../.liveworld/synthetic-scan.json", import.meta.url),
    JSON.stringify(result, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        fixture: "synthetic",
        objects: result.objects.map((o) => ({
          label: o.label,
          role: o.role,
          segmented: o.segmented,
        })),
        masksReturned: result.objects.filter((o) => o.segmented).length,
        budget: await ledger.summary(),
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
