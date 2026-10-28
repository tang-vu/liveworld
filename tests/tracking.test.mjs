import test from "node:test";
import assert from "node:assert/strict";
import { exampleWorld } from "../shared/world.js";
import { stabilizeObservation } from "../shared/tracking.js";

const world = exampleWorld();
test("stationary cup does not jump cells when the detected box drifts across a boundary", () => {
  const r = stabilizeObservation({
    world,
    role: "source",
    nx: 0.186,
    ny: 0.444,
    previousObservation: { nx: 0.165, ny: 0.444 },
    previousEntity: { x: 2, y: 5 },
  });
  assert.equal(r.x, 2);
  assert.equal(r.y, 5);
  assert.equal(r.stabilized, true);
  assert.equal(r.anchorNx, 0.165);
});
test("stationary house retains its placement under the observed rescan jitter", () => {
  const r = stabilizeObservation({
    world,
    role: "house",
    nx: 0.8096,
    ny: 0.447,
    previousObservation: { nx: 0.8369, ny: 0.447 },
    previousEntity: { x: 15, y: 5 },
  });
  assert.equal(r.x, 15);
  assert.equal(r.stabilized, true);
});
test("deliberately moved bridge changes rows", () => {
  const r = stabilizeObservation({
    world,
    role: "bridge",
    nx: 0.5,
    ny: 0.575,
    previousObservation: { nx: 0.497, ny: 0.763 },
    previousEntity: { x: 8, y: 9 },
  });
  assert.equal(r.x, 8);
  assert.equal(r.y, 6);
  assert.equal(r.stabilized, false);
});
test("gradual movement accumulates against a fixed anchor", () => {
  const start = { nx: 0.165, ny: 0.444 };
  const first = stabilizeObservation({
    world,
    role: "source",
    nx: 0.19,
    ny: 0.444,
    previousObservation: start,
    previousEntity: { x: 2, y: 5 },
  });
  const second = stabilizeObservation({
    world,
    role: "source",
    nx: 0.22,
    ny: 0.444,
    previousObservation: { nx: first.anchorNx, ny: first.anchorNy },
    previousEntity: { x: first.x, y: first.y },
  });
  assert.equal(first.stabilized, true);
  assert.equal(second.stabilized, false);
  assert.equal(second.x, 3);
});
test("new objects are placed normally and malformed coordinates are refused", () => {
  assert.equal(
    stabilizeObservation({ world, role: "house", nx: 0.7, ny: 0.2 }).x,
    12,
  );
  assert.throws(() =>
    stabilizeObservation({ world, role: "house", nx: NaN, ny: 0.2 }),
  );
});
