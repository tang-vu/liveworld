import test from "node:test";
import assert from "node:assert/strict";
import { contrastRatio, judgeKept } from "../shared/kept.js";

function fill(width, height, paint) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y);
      const index = (y * width + x) * 4;
      data[index] = r;
      data[index + 1] = g;
      data[index + 2] = b;
      data[index + 3] = 255;
    }
  }
  return { data, width, height };
}

const control = { x: 2, y: 2, width: 4, height: 2 };
const surface = { x: 0, y: 0, width: 8, height: 6 };
const reference = [20, 90, 70];

test("a dark control on a light surface passes both kept checks", () => {
  const image = fill(8, 6, (x, y) =>
    x >= 2 && x < 6 && y >= 2 && y < 4 ? reference : [236, 230, 214],
  );
  const verdict = judgeKept(image, { control, surface, reference });
  assert.equal(verdict.passed, true);
  assert.ok(
    verdict.checks.find((check) => check.id === "contrast").actual > 4.5,
  );
});

test("a control painted into the background fails without mutating the image", () => {
  const image = fill(8, 6, () => [236, 230, 214]);
  const saved = image.data.slice();
  const verdict = judgeKept(image, { control, surface, reference });
  assert.equal(verdict.passed, false);
  assert.equal(
    verdict.checks.find((check) => check.id === "present").passed,
    false,
  );
  assert.deepEqual(image.data, saved);
});

test("contrast alone fails when the control blends into the card", () => {
  const image = fill(8, 6, () => [236, 230, 214]);
  const verdict = judgeKept(image, { control, surface });
  assert.equal(verdict.checks.length, 1);
  assert.equal(verdict.passed, false);
});
test("black on white meets the readability ratio and white on white does not", () => {
  assert.ok(contrastRatio([0, 0, 0], [255, 255, 255]) > 20);
  assert.ok(contrastRatio([236, 230, 214], [236, 230, 214]) < 1.01);
});
