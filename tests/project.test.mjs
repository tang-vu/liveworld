import test from "node:test";
import assert from "node:assert/strict";
import { exampleWorld, applyPatch } from "../shared/world.js";
import {
  normalizeProject,
  makeCheckpoint,
  PROJECT_FORMAT,
  safePhoto,
  describeWorldChanges,
} from "../shared/project.js";
import { applyRuleChange } from "../shared/rules.js";

test("project roundtrip restores layouts, photos, checkpoints, selection, and verified trials", () => {
  const world = exampleWorld();
  const patch = { bridgeMoves: [{ id: "bridge-south", y: 6 }] };
  const project = normalizeProject({
    format: PROJECT_FORMAT,
    name: "Bridge study",
    world,
    photo: "/examples/generated-tabletop-a.png",
    checkpoints: [makeCheckpoint(world, null, "Original", "cp-1")],
    trials: [{ id: "t1", label: "Move crossing", kind: "agent", patch }],
    selectedTrialId: "t1",
    tick: 94,
  });
  const restored = normalizeProject(JSON.parse(JSON.stringify(project)), {
    imported: true,
  });
  assert.equal(restored.photo, project.photo);
  assert.equal(restored.tick, 94);
  assert.equal(restored.selectedTrialId, "t1");
  assert.equal(restored.checkpoints.length, 1);
  assert.equal(restored.trials[0].comparison.goalMet, true);
  assert.equal(restored.trials[0].source, "imported");
});
test("legacy experiment imports retain the selected designer comparison and extended horizon", () => {
  const world = exampleWorld();
  const changed = applyRuleChange(world, { rules: { horizon: 180 } }).world;
  const project = normalizeProject(
    {
      format: "liveworld-experiment-v1",
      world,
      selectedTrial: { id: "designer", kind: "rules", world: changed },
      tick: 160,
    },
    { imported: true },
  );
  assert.equal(project.trials.length, 1);
  assert.equal(project.selectedTrialId, "designer");
  assert.equal(project.tick, 160);
});

test("import recomputes fabricated success metrics and rejects an agent patch that adds workers", () => {
  const world = exampleWorld();
  const restored = normalizeProject({
    format: PROJECT_FORMAT,
    world,
    trials: [
      {
        id: "fake",
        kind: "agent",
        patch: { dispatch: "balanced" },
        evidence: { metrics: { onTime: 24 } },
        comparison: { goalMet: true },
      },
    ],
  });
  assert.equal(restored.trials[0].comparison.goalMet, false);
  assert.throws(() =>
    normalizeProject({
      format: PROJECT_FORMAT,
      world,
      trials: [{ kind: "agent", patch: { couriers: 12 } }],
    }),
  );
});
test("project files cannot load remote trackers or executable image sources", () => {
  for (const url of [
    "https://tracking.example/image.png",
    "javascript:alert(1)",
    "data:image/svg+xml,<svg/>",
    "/.env.local",
  ])
    assert.throws(() => safePhoto(url));
  assert.throws(() =>
    normalizeProject({
      format: PROJECT_FORMAT,
      world: exampleWorld(),
      checkpoints: [
        makeCheckpoint(exampleWorld(), null, "One", "same"),
        makeCheckpoint(exampleWorld(), null, "Two", "same"),
      ],
    }),
  );
});

test("unrecognized world fields are refused rather than saved into a public project", () => {
  const world = exampleWorld();
  world.credentials = "private";
  assert.throws(() => normalizeProject({ format: PROJECT_FORMAT, world }));
  delete world.credentials;
  world.source.remoteUrl = "https://example.test/";
  assert.throws(() => normalizeProject({ format: PROJECT_FORMAT, world }));
});
test("layout comparison identifies one bridge edit without changing the baseline", () => {
  const before = exampleWorld();
  const after = applyPatch(before, {
    bridgeMoves: [{ id: "bridge-south", y: 6 }],
  }).world;
  const changes = describeWorldChanges(before, after);
  assert.equal(changes.length, 1);
  assert.match(changes[0], /10 → 9, 7/);
  assert.equal(before.bridges[1].y, 9);
});
test("designer rule changes preserve the layout and reject unsupported or out-of-range mechanics", () => {
  const world = exampleWorld();
  const result = applyRuleChange(world, {
    rules: { couriers: 8 },
    allHouseholds: { demand: 3 },
    households: [{ id: "h6", deadline: 100 }],
  });
  assert.equal(result.world.rules.couriers, 8);
  assert.equal(result.world.houses[0].demand, 3);
  assert.equal(result.world.houses[5].deadline, 100);
  assert.deepEqual(result.world.bridges, world.bridges);
  assert.throws(() => applyRuleChange(world, { rules: { couriers: 100 } }));
  assert.throws(() =>
    applyRuleChange(world, { rules: { infiniteWater: true } }),
  );
  assert.throws(() =>
    applyRuleChange(world, { households: [{ id: "missing", demand: 3 }] }),
  );
});
