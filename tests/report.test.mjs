import test from "node:test";
import assert from "node:assert/strict";
import { experimentReport } from "../public/report.js";
import { PROJECT_FORMAT, describeWorldChanges } from "../shared/project.js";
import { exampleWorld } from "../shared/world.js";

test("report recalculates measurements and escapes imported labels and names", () => {
  const world = exampleWorld();
  world.houses[0].label = "<script>alert(1)</script>";
  const report = experimentReport({
    format: PROJECT_FORMAT,
    name: "<img src=x onerror=alert(1)>",
    world,
    trials: [
      {
        id: "t1",
        kind: "agent",
        patch: { dispatch: "balanced" },
        label: "<script>fake</script>",
        comparison: { goalMet: true },
        evidence: { metrics: { onTime: 1000 } },
      },
    ],
    selectedTrialId: "t1",
  });
  assert.equal(report.includes("<script>"), false);
  assert.equal(report.includes("<img src=x"), false);
  assert.match(report, /&lt;script&gt;/);
  assert.match(report, /<td>On-time water<\/td><td>20<\/td><td>14<\/td>/);
  assert.match(report, /same|constrained/);
});

test("creator comparisons expose changed seeds and world dimensions", () => {
  const a = exampleWorld();
  const b = structuredClone(a);
  b.seed = 42;
  b.width = 19;
  const changes = describeWorldChanges(a, b);
  assert.ok(changes.includes("seed: 271026 → 42"));
  assert.ok(changes.includes("width: 18 → 19"));
});
