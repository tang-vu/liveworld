// Pixel checks for a control that an image model is not allowed to erase.
// The model does not score these checks.

export const KEPT_MINIMUM_CONTRAST = 4.5;
export const KEPT_MINIMUM_COVERAGE = 0.6;

const channel = (value) => {
  const s = value / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

export function relativeLuminance(rgb) {
  return (
    0.2126 * channel(rgb[0]) +
    0.7152 * channel(rgb[1]) +
    0.0722 * channel(rgb[2])
  );
}

export function contrastRatio(foreground, background) {
  const lighter = Math.max(
    relativeLuminance(foreground),
    relativeLuminance(background),
  );
  const darker = Math.min(
    relativeLuminance(foreground),
    relativeLuminance(background),
  );
  return (lighter + 0.05) / (darker + 0.05);
}

function assertBox(box, width, height) {
  if (
    !box ||
    !Number.isInteger(box.x) ||
    !Number.isInteger(box.y) ||
    !Number.isInteger(box.width) ||
    !Number.isInteger(box.height) ||
    box.width < 1 ||
    box.height < 1 ||
    box.x < 0 ||
    box.y < 0 ||
    box.x + box.width > width ||
    box.y + box.height > height
  )
    throw new Error("The protected control is outside the image.");
}

function pixelsIn(data, width, box, skip) {
  const found = [];
  for (let y = box.y; y < box.y + box.height; y++) {
    for (let x = box.x; x < box.x + box.width; x++) {
      if (skip && skip(x, y)) continue;
      const index = (y * width + x) * 4;
      found.push([data[index], data[index + 1], data[index + 2]]);
    }
  }
  return found;
}

function average(pixels) {
  if (!pixels.length) throw new Error("The measured region is empty.");
  const sum = pixels.reduce(
    (total, rgb) => [total[0] + rgb[0], total[1] + rgb[1], total[2] + rgb[2]],
    [0, 0, 0],
  );
  return sum.map((value) => Math.round(value / pixels.length));
}

function near(rgb, reference, tolerance) {
  return rgb.every(
    (value, index) => Math.abs(value - reference[index]) <= tolerance,
  );
}

export function judgeKept(image, spec) {
  const { data, width, height } = image;
  if (!data || data.length !== width * height * 4)
    throw new Error("Image pixels do not match the declared size.");
  assertBox(spec.control, width, height);
  assertBox(spec.surface, width, height);
  const controlPixels = pixelsIn(data, width, spec.control);
  const surfacePixels = pixelsIn(data, width, spec.surface, (x, y) => {
    const box = spec.control;
    return (
      x >= box.x &&
      x < box.x + box.width &&
      y >= box.y &&
      y < box.y + box.height
    );
  });
  const foreground = average(controlPixels);
  const background = average(surfacePixels);
  const contrast = contrastRatio(foreground, background);
  const minimumContrast = spec.minimumContrast ?? KEPT_MINIMUM_CONTRAST;
  const checks = [
    {
      id: "contrast",
      label: "The control stays visually distinct",
      actual: Number(contrast.toFixed(2)),
      required: minimumContrast,
      passed: contrast >= minimumContrast,
    },
  ];
  if (spec.reference) {
    const minimumCoverage = spec.minimumCoverage ?? KEPT_MINIMUM_COVERAGE;
    const coverage =
      controlPixels.filter((rgb) =>
        near(rgb, spec.reference, spec.tolerance ?? 36),
      ).length / controlPixels.length;
    checks.unshift({
      id: "present",
      label: "The protected control is still there",
      actual: Number(coverage.toFixed(3)),
      required: minimumCoverage,
      passed: coverage >= minimumCoverage,
    });
  }
  return {
    passed: checks.every((check) => check.passed),
    checks,
    foreground,
    background,
  };
}
