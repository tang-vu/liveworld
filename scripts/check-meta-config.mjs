import { readConfig } from "../src/config.mjs";
import { BudgetLedger } from "../src/budget.mjs";
import { fileURLToPath } from "node:url";

// Never print a key or make a network request.
try {
  const config = readConfig();
  const ledger = new BudgetLedger(
    fileURLToPath(new URL("../.liveworld/", import.meta.url)),
    config,
  );
  console.log(
    JSON.stringify(
      {
        keyConfigured: Boolean(config.key),
        model: config.model,
        budget: await ledger.summary(),
        networkRequestsMadeByThisCheck: 0,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
