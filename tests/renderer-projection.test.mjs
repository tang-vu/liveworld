import test from "node:test";
import assert from "node:assert/strict";
import { OrthographicCamera, Vector3 } from "three";
import {
  worldGeometry,
  projectPoint,
  boardCameraFrame,
  unprojectPoint,
} from "../shared/projection.js";
import { exampleWorld } from "../shared/world.js";

test("3D camera, 2D evidence labels and object picking agree across viewport sizes and zoom", () => {
  const world = exampleWorld();
  for (const [width, height, zoom] of [
    [1400, 600, 1],
    [700, 480, 1],
    [360, 370, 1.7],
    [880, 634, 1],
    [360, 370, 2],
  ]) {
    const g = worldGeometry(width, height, world, zoom),
      frame = boardCameraFrame(g, world);
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 150);
    Object.assign(camera, frame.frustum);
    camera.position.fromArray(frame.eye);
    camera.lookAt(new Vector3(...frame.target));
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    for (const [x, y, z] of [
      [0, 0, 0],
      [18, 12, 0],
      [9, 9.5, 0],
      [3.5, 5.5, 0],
      [16.5, 9.5, 1.2],
    ]) {
      const point = new Vector3(x, z * frame.heightScale, y).project(camera);
      const actual = {
          x: ((point.x + 1) * width) / 2,
          y: ((1 - point.y) * height) / 2,
        },
        expected = projectPoint(g, x, y, z);
      assert.ok(Math.abs(actual.x - expected.x) < 1e-8);
      assert.ok(Math.abs(actual.y - expected.y) < 1e-8);
      if (z === 0) {
        const ground = unprojectPoint(g, actual.x, actual.y);
        assert.ok(
          Math.abs(ground.x - x) < 1e-8 && Math.abs(ground.y - y) < 1e-8,
        );
      }
    }
  }
});
