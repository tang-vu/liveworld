export const POLICIES = ["nearest", "balanced", "deadline"];
export const WIDTH = 18;
export const HEIGHT = 12;

export function exampleWorld(kind = "bottleneck") {
  const world = {
    version: 1,
    name: "The little valley",
    width: WIDTH,
    height: HEIGHT,
    seed: 271026,
    river: { x: 8, width: 2 },
    source: { id: "well", label: "The well", x: 3, y: 5 },
    bridges: [
      { id: "bridge-north", x: 8, y: 2 },
      { id: "bridge-south", x: 8, y: 9 },
    ],
    houses: [
      { id: "h1", label: "Orchard", x: 5, y: 2, demand: 4, deadline: 38 },
      { id: "h2", label: "Meadow", x: 4, y: 9, demand: 4, deadline: 45 },
      { id: "h3", label: "Pine", x: 12, y: 2, demand: 4, deadline: 58 },
      { id: "h4", label: "Cedar", x: 14, y: 5, demand: 4, deadline: 66 },
      { id: "h5", label: "Willow", x: 12, y: 9, demand: 4, deadline: 72 },
      { id: "h6", label: "Hilltop", x: 16, y: 9, demand: 4, deadline: 94 },
    ],
    obstacles: [
      { id: "stone-1", x: 6, y: 5 },
      { id: "stone-2", x: 12, y: 6 },
    ],
    rules: {
      dispatch: "nearest",
      couriers: 6,
      bridgeCapacity: 1,
      productionInterval: 2,
      horizon: 120,
    },
    provenance: { type: "example", confirmed: true },
  };
  if (kind === "disconnected") {
    world.name = "A missing crossing";
    world.bridges = [];
  } else if (kind === "impossible") {
    world.name = "An impossible deadline";
    world.houses.forEach((h) => {
      h.deadline = 5;
    });
  }
  return world;
}

function integer(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`${label} must be an integer from ${min} to ${max}.`);
}

function fields(value, allowed, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    throw new Error(`${label} contains unsupported fields.`);
}

export function validateWorld(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("A world must be an object.");
  if (JSON.stringify(input).length > 60_000)
    throw new Error("World is too large.");
  const world = structuredClone(input);
  fields(
    world,
    [
      "version",
      "name",
      "width",
      "height",
      "seed",
      "river",
      "source",
      "bridges",
      "houses",
      "obstacles",
      "rules",
      "provenance",
    ],
    "World",
  );
  if (
    typeof world.name !== "string" ||
    !world.name.trim() ||
    world.name.length > 80
  )
    throw new Error("Give the world a name of 1–80 characters.");
  fields(world.river, ["x", "width"], "River");
  fields(
    world.rules,
    ["dispatch", "couriers", "bridgeCapacity", "productionInterval", "horizon"],
    "Rules",
  );
  if (world.version !== 1) throw new Error("Unsupported world version.");
  integer(world.width, 8, 32, "Width");
  integer(world.height, 6, 24, "Height");
  integer(world.seed, 0, 2 ** 32 - 1, "Seed");
  integer(world.river?.x, 1, world.width - 3, "River position");
  integer(world.river?.width, 1, 3, "River width");
  if (world.river.x + world.river.width >= world.width)
    throw new Error("River must fit inside the board.");
  if (
    !Array.isArray(world.houses) ||
    world.houses.length < 1 ||
    world.houses.length > 12
  )
    throw new Error("Use 1–12 houses.");
  if (!Array.isArray(world.bridges) || world.bridges.length > 4)
    throw new Error("Use at most four bridges.");
  if (!Array.isArray(world.obstacles) || world.obstacles.length > 24)
    throw new Error("Use at most 24 obstacles.");
  const ids = new Set();
  const occupied = new Set();
  for (const object of [
    world.source,
    ...world.houses,
    ...world.bridges,
    ...world.obstacles,
  ]) {
    if (
      !object ||
      typeof object.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,48}$/.test(object.id) ||
      ids.has(object.id)
    )
      throw new Error("Every object needs a unique simple ID.");
    ids.add(object.id);
    fields(
      object,
      world.houses.includes(object)
        ? ["id", "label", "x", "y", "demand", "deadline"]
        : ["id", "label", "x", "y"],
      "Object",
    );
    integer(object.x, 0, world.width - 1, "Object x");
    integer(object.y, 0, world.height - 1, "Object y");
    const isBridge = world.bridges.includes(object);
    const inRiver =
      object.x >= world.river.x && object.x < world.river.x + world.river.width;
    if (isBridge && object.x !== world.river.x)
      throw new Error("Bridge anchors must be on the river’s left edge.");
    if (!isBridge && inRiver)
      throw new Error("Place houses, the well, and obstacles on land.");
    const key = `${object.x},${object.y}`;
    if (occupied.has(key)) throw new Error("Two objects cannot share a cell.");
    occupied.add(key);
    if (
      object.label !== undefined &&
      (typeof object.label !== "string" || object.label.length > 60)
    )
      throw new Error("Object labels must be short text.");
  }
  for (const h of world.houses) {
    integer(h.demand, 1, 12, "Water demand");
    integer(h.deadline, 1, 240, "Deadline");
  }
  if (!POLICIES.includes(world.rules?.dispatch))
    throw new Error("Unknown dispatch policy.");
  integer(world.rules.couriers, 1, 12, "Couriers");
  integer(world.rules.bridgeCapacity, 1, 3, "Bridge capacity");
  integer(world.rules.productionInterval, 1, 12, "Production interval");
  integer(world.rules.horizon, 10, 240, "Horizon");
  if (world.provenance !== undefined) {
    const p = world.provenance;
    fields(
      p,
      ["type", "confirmed", "objects", "models", "note", "fixture", "manifest"],
      "Provenance",
    );
    if (
      !["example", "photo", "synthetic"].includes(p.type) ||
      typeof p.confirmed !== "boolean"
    )
      throw new Error("Invalid world provenance.");
    for (const key of ["note", "fixture", "manifest"])
      if (
        p[key] !== undefined &&
        (typeof p[key] !== "string" || p[key].length > 500)
      )
        throw new Error("Invalid provenance text.");
    if (
      p.models !== undefined &&
      (!Array.isArray(p.models) ||
        p.models.length > 4 ||
        p.models.some((m) => typeof m !== "string" || m.length > 80))
    )
      throw new Error("Invalid model provenance.");
    if (p.objects !== undefined) {
      if (!Array.isArray(p.objects) || p.objects.length > 41)
        throw new Error("Invalid observation history.");
      const observed = new Set();
      for (const point of p.objects) {
        fields(
          point,
          ["id", "role", "nx", "ny", "observedNx", "observedNy", "stabilized"],
          "Observation",
        );
        if (
          !ids.has(point.id) ||
          observed.has(point.id) ||
          !["source", "house", "bridge", "obstacle"].includes(point.role)
        )
          throw new Error("Invalid observed object.");
        observed.add(point.id);
        for (const key of ["nx", "ny", "observedNx", "observedNy"])
          if (
            (key === "nx" || key === "ny" || point[key] !== undefined) &&
            (!Number.isFinite(point[key]) || point[key] < 0 || point[key] > 1)
          )
            throw new Error("Invalid observed position.");
        if (
          point.stabilized !== undefined &&
          typeof point.stabilized !== "boolean"
        )
          throw new Error("Invalid observation state.");
      }
    }
  }
  return world;
}

export function applyPatch(input, patch, maxEdits = 1) {
  const world = validateWorld(input);
  if (!patch || typeof patch !== "object" || Array.isArray(patch))
    throw new Error("A change must be an object.");
  if (
    Object.keys(patch).some((key) => !["dispatch", "bridgeMoves"].includes(key))
  )
    throw new Error("Only dispatch policy and bridge positions may change.");
  let edits = 0;
  if (patch.dispatch !== undefined && patch.dispatch !== null) {
    if (!POLICIES.includes(patch.dispatch))
      throw new Error("Unknown dispatch policy.");
    if (world.rules.dispatch !== patch.dispatch) {
      world.rules.dispatch = patch.dispatch;
      edits++;
    }
  }
  const moves = patch.bridgeMoves ?? [];
  if (!Array.isArray(moves) || moves.length > 1)
    throw new Error("Move at most one bridge.");
  for (const move of moves) {
    const bridge = world.bridges.find((b) => b.id === move.id);
    if (!bridge) throw new Error("That bridge does not exist.");
    integer(move.y, 0, world.height - 1, "Bridge row");
    if (bridge.y !== move.y) {
      bridge.y = move.y;
      edits++;
    }
  }
  if (edits > maxEdits)
    throw new Error(`This experiment allows at most ${maxEdits} change.`);
  return { world: validateWorld(world), edits };
}

export function objectAt(world, x, y) {
  return [
    world.source,
    ...world.houses,
    ...world.bridges,
    ...world.obstacles,
  ].find((o) => o.x === x && o.y === y);
}
