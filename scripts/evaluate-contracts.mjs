import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { exampleWorld } from "../shared/world.js";
import { defaultContract, validateContract } from "../shared/contract.js";

// Declared before the first live run. One attempt per brief; no retries.
// These are small integration cases, not an independent general benchmark.
const base = exampleWorld();
base.name = "Fogbank delivery challenge";
base.bridges[0] = { ...base.bridges[0], id: "ford-upper", label: "Upper ford" };
base.bridges[1] = {
  ...base.bridges[1],
  id: "ford-meadow",
  label: "Meadow ford",
};
const shifted = structuredClone(base);
shifted.source.x = 2;
shifted.source.y = 4;
const current = structuredClone(shifted);
current.contract = {
  ...defaultContract(),
  minimumOnTime: 23,
  minimumPerHouse: 3,
  maximumWait: 8,
  allowDispatch: false,
  bridgeIds: ["ford-upper"],
};
const ambiguous = structuredClone(base);
ambiguous.bridges.forEach((b) => (b.label = "Crossing"));
const cases = [
  {
    id: "combined-thresholds",
    world: base,
    instruction:
      "Require at least twenty-three water units on time, at least three at every home, and at most five total courier waiting turns. Permit either one bridge move or one dispatch change.",
    expected: {
      ...defaultContract(),
      minimumOnTime: 23,
      minimumPerHouse: 3,
      maximumWait: 5,
    },
  },
  {
    id: "named-edit-permission",
    world: shifted,
    instruction:
      "Every unit must be on time with at most four total waiting turns. The only permitted edit is moving Upper ford.",
    expected: {
      ...defaultContract(),
      maximumWait: 4,
      allowDispatch: false,
      bridgeIds: ["ford-upper"],
    },
  },
  {
    id: "floor-without-total",
    world: base,
    instruction:
      "Ignore the overall on-time count. Require at least two on-time water units at every home and at most nine total waiting turns. Only change the dispatch policy; do not move any bridge.",
    expected: {
      ...defaultContract(),
      minimumOnTime: 0,
      minimumPerHouse: 2,
      maximumWait: 9,
      bridgeIds: [],
    },
  },
  {
    id: "preserve-confirmed-values",
    world: current,
    instruction:
      "Change only the maximum total courier waiting turns to two. Keep every other acceptance criterion and edit permission unchanged.",
    expected: { ...current.contract, maximumWait: 2 },
  },
  {
    id: "measurable-but-infeasible",
    world: base,
    instruction:
      "Every water unit on time and zero total courier waiting turns. One bridge move or one dispatch change is allowed.",
    expected: { ...defaultContract(), maximumWait: 0 },
  },
  {
    id: "unsupported-resource-change",
    world: shifted,
    instruction:
      "At least 23 units on time, and add one more courier so the test will pass.",
    unsupported: true,
  },
  {
    id: "ambiguous-bridge",
    world: ambiguous,
    instruction: "Require every unit on time. Only move Crossing.",
    unsupported: true,
  },
  {
    id: "reset-contract",
    world: current,
    instruction:
      "Reset to every unit on time. Remove the per-home floor and the waiting cap. Allow either one dispatch change or moving any existing bridge.",
    expected: defaultContract(),
  },
];
const digest = createHash("sha256").update(JSON.stringify(cases)).digest("hex");
const destination = new URL(
  "../public/examples/contract-evaluation.json",
  import.meta.url,
);
let report;
if (process.argv.includes("--declare")) {
  await writeFile(
    new URL("../demo/contract-evaluation-cases.json", import.meta.url),
    JSON.stringify(
      { format: "liveworld-contract-cases-v1", digest, cases },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      mode: "declare",
      digest,
      cases: cases.length,
      apiRequests: 0,
    }),
  );
  process.exit(0);
}
if (process.argv.includes("--live")) {
  // Use the already-running loopback backend's paid gate and existing ledger.
  const service = new URL(
    process.env.LIVEWORLD_BASE_URL ?? "http://127.0.0.1:4173",
  );
  if (service.protocol !== "http:" || service.hostname !== "127.0.0.1")
    throw new Error("Use the local loopback backend.");
  const declared = JSON.parse(
    await readFile(
      new URL("../demo/contract-evaluation-cases.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(
    declared.digest,
    digest,
    "Declare and review unchanged cases before live inference.",
  );
  const status = async () => {
    const r = await fetch(new URL("/api/status", service));
    assert.ok(r.ok);
    return r.json();
  };
  const before = await status();
  assert.ok(
    before.configured && !before.budget.blocked && !before.budget.heldUsd,
    "The paid gate must be ready and idle.",
  );
  const results = [];
  for (const item of cases) {
    const started = Date.now();
    try {
      const gate = await status();
      assert.ok(
        !gate.budget.blocked && !gate.budget.heldUsd,
        "Paid calls are paused.",
      );
      const r = await fetch(new URL("/api/contract", service), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item),
      });
      const response = await r.json();
      assert.ok(r.ok, response.error);
      results.push({ id: item.id, response, latencyMs: Date.now() - started });
    } catch (error) {
      results.push({
        id: item.id,
        error: String(error.message),
        latencyMs: Date.now() - started,
      });
    }
  }
  const after = await status();
  report = {
    format: "liveworld-contract-evaluation-v1",
    createdAt: new Date().toISOString(),
    digest,
    model: before.model,
    scope:
      "Eight predeclared integration briefs on renamed authored layouts; one attempt each. Not a general accuracy benchmark. Refusals and errors retained.",
    requests: after.budget.requests - before.budget.requests,
    estimatedCostUsd: Number(
      (after.budget.spentUsd - before.budget.spentUsd).toFixed(6),
    ),
    results,
  };
  await writeFile(destination, JSON.stringify(report, null, 2) + "\n");
} else report = JSON.parse(await readFile(destination, "utf8"));
assert.equal(report.digest, digest);
assert.equal(report.results.length, cases.length);
let passed = 0;
for (let i = 0; i < cases.length; i++) {
  const item = cases[i],
    result = report.results[i];
  assert.equal(result.id, item.id);
  let ok = !result.error;
  if (ok && item.unsupported)
    ok =
      result.response.supported === false &&
      result.response.unsupported.length > 0 &&
      !result.response.contract;
  else if (ok) {
    try {
      assert.equal(result.response.supported, true);
      assert.deepEqual(
        validateContract(result.response.contract, item.world),
        item.expected,
      );
    } catch {
      ok = false;
    }
  }
  if (ok) passed++;
  console.log(
    JSON.stringify({
      id: item.id,
      passed: ok,
      ...(result.error ? { error: result.error } : {}),
    }),
  );
}
console.log(
  JSON.stringify({
    mode: process.argv.includes("--live") ? "live" : "offline-replay",
    passed,
    total: cases.length,
    requests: report.requests,
    estimatedCostUsd: report.estimatedCostUsd,
  }),
);
if (passed !== cases.length) process.exitCode = 1;
