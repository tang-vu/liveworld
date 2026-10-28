import test from "node:test";
import assert from "node:assert/strict";
import {
  worldGeometry,
  projectPoint,
  unprojectPoint,
} from "../shared/projection.js";

test("detail zoom preserves pointer coordinates and keeps the example's functional objects visible on a phone", () => {
  const g = worldGeometry(364, 350, { width: 18, height: 12 }, 1.7);
  for (const [x, y] of [
    [3, 5],
    [5, 2],
    [4, 9],
    [12, 2],
    [14, 5],
    [12, 9],
    [16, 9],
    [8, 2],
    [8, 9],
  ]) {
    const p = projectPoint(g, x + 0.5, y + 0.5);
    assert.ok(p.x > 0 && p.x < 364 && p.y > 0 && p.y < 350);
    const hit = unprojectPoint(g, p.x, p.y);
    assert.equal(Math.floor(hit.x), x);
    assert.equal(Math.floor(hit.y), y);
  }
});

test("fit view keeps every cell selectable in solo, comparison, and narrow viewports", () => {
  const world = { width: 18, height: 12 };
  for (const [width, height] of [
    [1200, 560],
    [550, 560],
    [330, 360],
  ]) {
    const g = worldGeometry(width, height, world);
    for (let x = 0; x < world.width; x++)
      for (let y = 0; y < world.height; y++) {
        const screen = projectPoint(g, x + 0.5, y + 0.5);
        assert.ok(
          screen.x > 0 && screen.x < width && screen.y > 0 && screen.y < height,
        );
        const hit = unprojectPoint(g, screen.x, screen.y);
        assert.equal(Math.floor(hit.x), x);
        assert.equal(Math.floor(hit.y), y);
      }
  }
});

test("height changes only the rendered elevation, not the ground anchor", () => {
  const g = worldGeometry(1100, 600, { width: 18, height: 12 });
  const ground = projectPoint(g, 4.5, 7.5);
  const roof = projectPoint(g, 4.5, 7.5, 1);
  assert.equal(roof.x, ground.x);
  assert.ok(roof.y < ground.y);
  const outside = unprojectPoint(g, g.left, g.top - 100);
  assert.ok(outside.x < 0 && outside.y < 0);
});
