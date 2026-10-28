// The scene and pointer controls share the same angled coordinate system.
export function worldGeometry(width, height, world, zoom = 1) {
  const cell =
    zoom *
    Math.max(
      2,
      Math.min(
        (width - 72) / (world.width + world.height),
        (height - 108) / ((world.width + world.height) * 0.44),
      ),
    );
  return {
    width,
    height,
    cell,
    zoom,
    left: width / 2 - ((world.width - world.height) * cell) / 2,
    top: (height - (world.width + world.height) * cell * 0.44) / 2 - 5,
  };
}

export function projectPoint(g, x, y, z = 0) {
  return {
    x: g.left + (x - y) * g.cell,
    y: g.top + (x + y) * g.cell * 0.44 - z * g.cell,
  };
}

export function unprojectPoint(g, x, y) {
  const dx = (x - g.left) / g.cell;
  const dy = (y - g.top) / (g.cell * 0.44);
  return { x: (dx + dy) / 2, y: (dy - dx) / 2 };
}

// Camera parameters for the 3D scene, in the same screen space as picking and
// evidence labels. x/z are grid coordinates; y is the rendered elevation.
export function boardCameraFrame(g, world) {
  const unit = Math.SQRT2 * g.cell;
  return {
    heightScale: 1 / (Math.SQRT2 * Math.sqrt(1 - 0.44 ** 2)),
    eye: [
      world.width / 2 + 30,
      Math.SQRT2 * 30 * Math.tan(Math.asin(0.44)),
      world.height / 2 + 30,
    ],
    target: [world.width / 2, 0, world.height / 2],
    frustum: {
      left: -g.width / 2 / unit,
      right: g.width / 2 / unit,
      top: (g.height / 2 - 5) / unit,
      bottom: (-g.height / 2 - 5) / unit,
    },
  };
}
