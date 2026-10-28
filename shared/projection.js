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
