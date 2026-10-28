export const EVENT_KINDS = ["bridge_closed", "production_paused"];

export function validateSchedule(input, world) {
  if (!Array.isArray(input) || input.length > 6)
    throw new Error("Use at most six scheduled events.");
  const ids = new Set();
  for (const event of input) {
    if (
      !event ||
      typeof event !== "object" ||
      Array.isArray(event) ||
      Object.keys(event).some(
        (key) => !["id", "kind", "targetId", "from", "to"].includes(key),
      )
    )
      throw new Error("A scheduled event contains unsupported fields.");
    if (
      typeof event.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,48}$/.test(event.id) ||
      ids.has(event.id)
    )
      throw new Error("Each scheduled event needs a unique simple ID.");
    ids.add(event.id);
    if (!EVENT_KINDS.includes(event.kind))
      throw new Error(
        "Only bridge closures and production pauses are supported.",
      );
    const target =
      event.kind === "bridge_closed"
        ? world.bridges.find((b) => b.id === event.targetId)
        : event.targetId === world.source.id
          ? world.source
          : null;
    if (!target)
      throw new Error(
        "A scheduled event must target an existing bridge or the well.",
      );
    if (
      !Number.isInteger(event.from) ||
      !Number.isInteger(event.to) ||
      event.from < 1 ||
      event.to < event.from ||
      event.to > world.rules.horizon
    )
      throw new Error(
        "Event turns must be an inclusive interval inside the simulation horizon.",
      );
  }
  for (let i = 0; i < input.length; i++)
    for (let j = i + 1; j < input.length; j++) {
      const a = input[i],
        b = input[j];
      if (
        a.kind === b.kind &&
        a.targetId === b.targetId &&
        a.from <= b.to &&
        b.from <= a.to
      )
        throw new Error(
          "Intervals for the same mechanic and object must not overlap.",
        );
    }
  return structuredClone(input);
}
export function activeMechanics(world, tick) {
  const active = (world.events ?? []).filter(
    (e) => e.from <= tick && tick <= e.to,
  );
  return {
    closedBridgeIds: active
      .filter((e) => e.kind === "bridge_closed")
      .map((e) => e.targetId)
      .sort(),
    productionPaused: active.some((e) => e.kind === "production_paused"),
  };
}
export function describeEvent(event, world) {
  const target =
    event.kind === "bridge_closed"
      ? world.bridges.find((b) => b.id === event.targetId)
      : world.source;
  const name =
    target?.label ??
    (event.targetId === "bridge-north"
      ? "North bridge"
      : event.targetId === "bridge-south"
        ? "South bridge"
        : event.targetId);
  return (
    (event.kind === "bridge_closed"
      ? name + " closed"
      : name + " production paused") +
    " · turns " +
    event.from +
    "–" +
    event.to
  );
}
