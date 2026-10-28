import { validateWorld, applyPatch } from "./world.js";
import { simulate, evidence, compareRuns } from "./engine.js";
import { describeEvent } from "./mechanics.js";

export const PROJECT_FORMAT = "liveworld-project-v2";
export const PROJECT_LIMIT_BYTES = 15_000_000;
const kinds = ["agent", "capture", "rules", "checkpoint", "local"];
function short(value, fallback, max = 100) {
  return typeof value === "string" ? value.slice(0, max) : fallback;
}
export function safePhoto(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.length > 3_000_000)
    throw new Error("A saved image is too large.");
  if (
    !/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(value) &&
    !/^\/examples\/[a-z0-9_-]+\.(png|jpg)$/.test(value)
  )
    throw new Error(
      "Saved images must be embedded JPEG/PNG files or bundled examples.",
    );
  return value;
}
export function worldSignature(value) {
  const stable = (obj) =>
    Array.isArray(obj)
      ? obj.map(stable)
      : obj && typeof obj === "object"
        ? Object.fromEntries(
            Object.keys(obj)
              .sort()
              .map((key) => [key, stable(obj[key])]),
          )
        : obj;
  return JSON.stringify(stable(validateWorld(value)));
}

export function verifyTrial(base, input, imported = false) {
  if (!input || typeof input !== "object")
    throw new Error("Invalid experiment.");
  const kind = kinds.includes(input.kind)
    ? input.kind
    : input.patch
      ? "agent"
      : "capture";
  const world =
    kind === "agent" || kind === "local"
      ? applyPatch(base, input.patch).world
      : validateWorld(input.world);
  const run = simulate(world);
  return {
    id: short(input.id, "trial", 64),
    label: short(input.label, "Experiment"),
    kind,
    source: imported
      ? "imported"
      : short(input.source, kind === "agent" ? "meta" : kind),
    model: short(input.model, "", 80),
    instruction: short(input.instruction, "", 2000),
    world,
    photo: safePhoto(input.photo),
    patch: ["agent", "local"].includes(kind)
      ? structuredClone(input.patch)
      : undefined,
    evidence: evidence(run),
    comparison: compareRuns(simulate(base), run),
  };
}

export function makeCheckpoint(
  world,
  photo,
  label,
  id,
  createdAt = new Date().toISOString(),
) {
  return {
    id: short(id, "checkpoint", 64),
    label: short(label, "Saved world", 80),
    createdAt: short(createdAt, "", 40),
    world: validateWorld(world),
    photo: safePhoto(photo),
  };
}

export function normalizeProject(input, { imported = false } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Choose a LiveWorld project or experiment file.");
  if (
    new TextEncoder().encode(JSON.stringify(input)).byteLength >
    PROJECT_LIMIT_BYTES
  )
    throw new Error("Project files must be smaller than 15 MB.");
  if (![PROJECT_FORMAT, "liveworld-experiment-v1"].includes(input.format))
    throw new Error("Unsupported LiveWorld file format.");
  const world = validateWorld(input.world);
  const checkpoints = input.checkpoints ?? [];
  if (!Array.isArray(checkpoints) || checkpoints.length > 12)
    throw new Error("Use at most 12 saved checkpoints.");
  const ids = new Set();
  const checked = checkpoints.map((cp) => {
    const item = makeCheckpoint(
      cp.world,
      cp.photo,
      cp.label,
      cp.id,
      cp.createdAt,
    );
    if (ids.has(item.id)) throw new Error("Checkpoint IDs must be unique.");
    ids.add(item.id);
    return item;
  });
  const trials = input.trials ?? input.playtest?.experiments ?? [];
  if (!Array.isArray(trials) || trials.length > 32)
    throw new Error("Use at most 32 experiment trials.");
  const allTrials = [...trials];
  if (
    input.format === "liveworld-experiment-v1" &&
    input.selectedTrial &&
    !allTrials.some((t) => t.id === input.selectedTrial.id)
  )
    allTrials.push(input.selectedTrial);
  if (allTrials.length > 32)
    throw new Error("Use at most 32 experiment trials.");
  const verified = allTrials.map((t) => verifyTrial(world, t, imported));
  if (new Set(verified.map((t) => t.id)).size !== verified.length)
    throw new Error("Experiment IDs must be unique.");
  let selectedTrialId =
    input.selectedTrialId ?? input.selectedTrial?.id ?? null;
  if (selectedTrialId && !verified.some((t) => t.id === selectedTrialId))
    selectedTrialId = null;
  const summary =
    input.runSummary ??
    (input.playtest
      ? {
          goal: input.playtest.goal,
          model: input.playtest.model,
          summary: input.playtest.summary,
        }
      : null);
  return {
    format: PROJECT_FORMAT,
    name: short(input.name, world.name ?? "My LiveWorld", 80),
    briefInstruction: short(input.briefInstruction, "", 2000),
    world,
    photo: safePhoto(input.photo),
    checkpoints: checked,
    trials: verified,
    selectedTrialId,
    tick: Number.isFinite(input.tick)
      ? Math.max(
          0,
          Math.min(
            Math.max(
              world.rules.horizon,
              verified.find((t) => t.id === selectedTrialId)?.world.rules
                .horizon ?? 0,
            ),
            Math.round(input.tick),
          ),
        )
      : 0,
    runSummary: summary
      ? {
          goal: short(summary.goal, "", 2000),
          model: short(summary.model, "", 80),
          summary: short(summary.summary, "", 5000),
          source: imported ? "imported" : short(summary.source, "meta"),
        }
      : null,
  };
}

export function describeWorldChanges(before, after) {
  const a = validateWorld(before);
  const b = validateWorld(after);
  const changes = [];
  for (const field of ["width", "height", "seed"])
    if (a[field] !== b[field])
      changes.push(`${field}: ${a[field]} → ${b[field]}`);
  for (const field of ["x", "width"])
    if (a.river[field] !== b.river[field])
      changes.push(`river ${field}: ${a.river[field]} → ${b.river[field]}`);
  const objects = (w) => [
    { ...w.source, role: "source" },
    ...w.houses.map((o) => ({ ...o, role: "house" })),
    ...w.bridges.map((o) => ({ ...o, role: "bridge" })),
    ...w.obstacles.map((o) => ({ ...o, role: "obstacle" })),
  ];
  const old = new Map(objects(a).map((o) => [o.id, o]));
  const next = new Map(objects(b).map((o) => [o.id, o]));
  for (const [id, object] of next) {
    const previous = old.get(id);
    const label = object.label ?? id;
    if (!previous) {
      changes.push(`${label}: added`);
      continue;
    }
    if (previous.x !== object.x || previous.y !== object.y)
      changes.push(
        `${label}: cell ${previous.x + 1}, ${previous.y + 1} → ${object.x + 1}, ${object.y + 1}`,
      );
    if (previous.role !== object.role)
      changes.push(`${label}: role ${previous.role} → ${object.role}`);
    for (const field of ["demand", "deadline"])
      if (previous[field] !== object[field])
        changes.push(
          `${label}: ${field} ${previous[field]} → ${object[field]}`,
        );
  }
  for (const [id, object] of old)
    if (!next.has(id)) changes.push(`${object.label ?? id}: removed`);
  for (const field of Object.keys(a.rules))
    if (a.rules[field] !== b.rules[field])
      changes.push(`${field}: ${a.rules[field]} → ${b.rules[field]}`);
  if (JSON.stringify(a.contract ?? null) !== JSON.stringify(b.contract ?? null))
    changes.push(
      "Test brief changed: inspect its acceptance criteria and edit permissions.",
    );
  if (JSON.stringify(a.events ?? []) !== JSON.stringify(b.events ?? [])) {
    const oldEvents = new Map((a.events ?? []).map((e) => [e.id, e]));
    const newEvents = new Map((b.events ?? []).map((e) => [e.id, e]));
    for (const event of a.events ?? [])
      if (JSON.stringify(newEvents.get(event.id)) !== JSON.stringify(event))
        changes.push("Remove schedule: " + describeEvent(event, a));
    for (const event of b.events ?? [])
      if (JSON.stringify(oldEvents.get(event.id)) !== JSON.stringify(event))
        changes.push("Schedule: " + describeEvent(event, b));
  }
  return changes;
}
