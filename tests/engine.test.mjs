import test from "node:test";
import assert from "node:assert/strict";
import { exampleWorld, applyPatch, validateWorld } from "../shared/world.js";
import { simulate, findPath, bridgeAt, compareRuns } from "../shared/engine.js";

test("same world produces exactly the same replay without mutating input", () => {
  const world = exampleWorld();
  const before = JSON.stringify(world);
  assert.deepEqual(simulate(world), simulate(world));
  assert.equal(JSON.stringify(world), before);
});
test("water is conserved in every replay frame", () => {
  const run = simulate(exampleWorld());
  for (const frame of run.frames) {
    const carrying = frame.agents.filter((a) => a.state === "outbound").length;
    assert.equal(frame.produced, frame.stock + frame.delivered + carrying);
    for (const h of frame.houses)
      assert.ok(
        h.delivered <= run.world.houses.find((o) => o.id === h.id).demand,
      );
  }
});
test("bridge capacity is respected and agents never cross unbridged river cells", () => {
  const run = simulate(exampleWorld());
  for (const f of run.frames) {
    for (const a of f.agents) {
      if (
        a.x >= run.world.river.x &&
        a.x < run.world.river.x + run.world.river.width
      )
        assert.ok(bridgeAt(run.world, a));
    }
    for (const b of run.world.bridges)
      assert.ok(
        f.agents.filter((a) => bridgeAt(run.world, a)?.id === b.id).length <=
          run.world.rules.bridgeCapacity,
      );
  }
});
test("disconnected households receive no imaginary deliveries", () => {
  const world = exampleWorld("disconnected");
  const run = simulate(world);
  for (const house of world.houses.filter((h) => h.x > world.river.x)) {
    assert.equal(findPath(world, world.source, house), null);
    assert.equal(run.houses.find((h) => h.id === house.id).delivered, 0);
    assert.ok(run.metrics.unreachable.includes(house.id));
  }
});
test("impossible deadlines are reported as failure", () => {
  const run = simulate(exampleWorld("impossible"));
  assert.equal(run.metrics.allOnTime, false);
  assert.ok(run.metrics.lateUnits > 0);
});
test("the example has a reproducible fix and a plausible failed proposal", () => {
  const world = exampleWorld();
  const baseline = simulate(world);
  const balanced = simulate(applyPatch(world, { dispatch: "balanced" }).world);
  const moved = simulate(
    applyPatch(world, { bridgeMoves: [{ id: "bridge-south", y: 6 }] }).world,
  );
  assert.equal(baseline.metrics.allOnTime, false);
  assert.equal(balanced.metrics.allOnTime, false);
  assert.ok(balanced.metrics.lateUnits > baseline.metrics.lateUnits);
  assert.equal(moved.metrics.allOnTime, true);
  assert.equal(moved.metrics.onTime, moved.metrics.demand);
});
test("a proposal cannot add workers, resources, or more than one edit", () => {
  const world = exampleWorld();
  assert.throws(() => applyPatch(world, { couriers: 12 }));
  assert.throws(() =>
    applyPatch(world, {
      dispatch: "balanced",
      bridgeMoves: [{ id: world.bridges[0].id, y: 4 }],
    }),
  );
  const { world: next } = applyPatch(world, { dispatch: "balanced" });
  assert.equal(next.seed, world.seed);
  assert.equal(next.rules.couriers, world.rules.couriers);
  assert.equal(compareRuns(simulate(world), simulate(next)).sameSeed, true);
});
test("malformed coordinates and overlapping objects are rejected", () => {
  const world = exampleWorld();
  world.houses[0].x = world.source.x;
  world.houses[0].y = world.source.y;
  assert.throws(() => validateWorld(world));
});
