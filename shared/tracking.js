// Keep a confirmed grid placement stable under small detection-box jitter.
// The anchor stays at the last committed observation, so gradual real movement
// accumulates and eventually crosses the threshold instead of being erased.
export function stabilizeObservation({
  world,
  role,
  nx,
  ny,
  previousObservation,
  previousEntity,
}) {
  if (![nx, ny].every((n) => Number.isFinite(n) && n >= 0 && n <= 1))
    throw new Error("Object centers must fall within the image.");
  const threshold = 0.8 / Math.max(world.width, world.height);
  const stable = Boolean(
    previousObservation &&
    previousEntity &&
    Math.hypot(nx - previousObservation.nx, ny - previousObservation.ny) <
      threshold,
  );
  return {
    x:
      role === "bridge"
        ? world.river.x
        : stable
          ? previousEntity.x
          : Math.min(world.width - 1, Math.floor(nx * world.width)),
    y: stable
      ? previousEntity.y
      : Math.min(world.height - 1, Math.floor(ny * world.height)),
    anchorNx: stable ? previousObservation.nx : nx,
    anchorNy: stable ? previousObservation.ny : ny,
    stabilized: stable,
  };
}
