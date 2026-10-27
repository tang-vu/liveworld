import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BudgetLedger } from "../src/budget.mjs";

async function ledger(t, policy = { total: 150, phase: 10, reserve: 50 }) {
  const dir = await mkdtemp(join(tmpdir(), "liveworld-budget-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return new BudgetLedger(dir, policy);
}
test("reserves before spending and refuses requests that exceed the phase cap", async (t) => {
  const b = await ledger(t);
  const id = await b.reserve("spark", 6);
  await assert.rejects(b.reserve("spark", 5));
  await b.settle(id, 0.01, { input: 1000, output: 100 });
  assert.equal((await b.summary()).spentUsd, 0.01);
  assert.equal((await b.summary()).heldUsd, 0);
});
test("an uncertain charge is accounted conservatively and stops subsequent paid calls", async (t) => {
  const b = await ledger(t);
  const id = await b.reserve("spark", 1.4);
  await b.settle(id, null);
  assert.equal((await b.summary()).spentUsd, 1.4);
  await assert.rejects(b.reserve("spark", 0.01));
});
test("pending reservations survive a restart and cannot be spent twice", async (t) => {
  const b = await ledger(t);
  await b.reserve("spark", 9);
  const afterRestart = new BudgetLedger(b.directory, b.policy);
  await assert.rejects(afterRestart.reserve("spark", 2));
});
test("corrupted records fail closed instead of resetting the budget", async (t) => {
  const b = await ledger(t);
  await writeFile(b.path, "{broken");
  await assert.rejects(b.reserve("spark", 0.01));
});
test("concurrent reservations cannot oversubscribe the budget", async (t) => {
  const b = await ledger(t, { total: 150, phase: 1, reserve: 50 });
  const results = await Promise.allSettled(
    Array.from({ length: 8 }, () => b.reserve("spark", 0.6)),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal((await b.summary()).heldUsd, 0.6);
});
