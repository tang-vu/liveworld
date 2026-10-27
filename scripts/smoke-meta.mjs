import { readConfig } from "../src/config.mjs";
import { BudgetLedger } from "../src/budget.mjs";
import { MetaClient } from "../src/meta.mjs";
import { fileURLToPath } from "node:url";

// Explicitly paid smoke check: one small call, budgeted, with no automatic retry.
const config = readConfig();
const ledger = new BudgetLedger(
  fileURLToPath(new URL("../.liveworld/", import.meta.url)),
  config,
);
const client = new MetaClient(config, ledger);
try {
  const response = await client.chat(
    [
      {
        role: "user",
        content: "Reply with exactly READY. This is an API connectivity check.",
      },
    ],
    { maxOutput: 128 },
  );
  console.log(
    JSON.stringify(
      {
        connected: true,
        model: config.model,
        reply: response.message.content,
        usage: response.usage,
        estimatedCostUsd: response.costUsd,
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
