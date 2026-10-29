import { exampleWorld, validateWorld, applyPatch } from "/shared/world.js";
import { simulate, evidence, compareRuns } from "/shared/engine.js";
import {
  drawWorld,
  drawTablePreview,
  cellFromPointer,
  pickObject,
} from "./diorama.js";
import { stabilizeObservation } from "/shared/tracking.js";
import {
  PROJECT_FORMAT,
  PROJECT_LIMIT_BYTES,
  normalizeProject,
  makeCheckpoint,
  verifyTrial,
  describeWorldChanges,
  worldSignature,
} from "/shared/project.js";
import { applyRuleChange, ruleChangeFromForm } from "/shared/rules.js";
import { loadAutosave, saveAutosave } from "./storage.js";
import { experimentReport } from "./report.js";
import { describeEvent } from "/shared/mechanics.js";
import { createReplayClip, replayFormat } from "./replay-clip.js";
import { setupDesignLab } from "./design-lab.js";
import { nudgeProposalBridge, searchLocal } from "/shared/experiments.js";
import { evaluateContract } from "/shared/contract.js";

const $ = (id) => document.getElementById(id);
const escape = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const policyLabel = {
  nearest: "Nearest first",
  balanced: "Balanced service",
  deadline: "Deadline priority",
};
const roleSymbol = { source: "◉", house: "⌂", bridge: "≋", obstacle: "◇" };
const state = {
  world: exampleWorld(),
  run: null,
  selected: null,
  tick: 42,
  playing: false,
  speed: 1,
  busy: false,
  comparing: false,
  soloCandidate: false,
  dragCell: null,
  dragSide: null,
  studyStep: null,
  trials: [],
  candidate: null,
  result: null,
  status: null,
  scanImage: null,
  scanResult: null,
  scanSelected: null,
  camera: null,
  name: "My LiveWorld",
  photo: null,
  checkpoints: [],
  receiptCourier: null,
  creatorStudy: false,
  briefInstruction: "",
};
let restoredProject = null;
let designLab;
let clipRecording = null;
let clipUrls = [];
let ambientClock = 0;
try {
  const saved = await loadAutosave();
  if (saved) {
    restoredProject = normalizeProject(saved);
    Object.assign(state, {
      world: restoredProject.world,
      photo: restoredProject.photo,
      name: restoredProject.name,
      checkpoints: restoredProject.checkpoints,
      briefInstruction: restoredProject.briefInstruction,
      trials: restoredProject.trials,
      tick: restoredProject.tick,
    });
  } else {
    const legacy = localStorage.getItem("liveworld.world.v1");
    if (legacy) state.world = validateWorld(JSON.parse(legacy));
  }
} catch {
  /* An invalid saved layout is replaced by the example. */
}
state.run = simulate(state.world);

function projectSnapshot() {
  return normalizeProject({
    format: PROJECT_FORMAT,
    name: state.name,
    briefInstruction: state.briefInstruction,
    world: state.world,
    photo: state.photo,
    checkpoints: state.checkpoints,
    trials: state.trials,
    selectedTrialId: state.candidate?.id ?? null,
    tick: state.tick,
    runSummary: state.result
      ? {
          goal: state.result.goal ?? $("goal").value,
          model: state.result.model ?? "",
          summary: state.result.summary ?? "",
          source: state.result.source ?? "meta",
        }
      : null,
  });
}
let autosaveTimer;
let saveQueue = Promise.resolve();
function autosave() {
  $("save-status").textContent = "Saving…";
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    try {
      const project = projectSnapshot();
      saveQueue = saveQueue.catch(() => {}).then(() => saveAutosave(project));
      saveQueue.then(
        () => {
          $("save-status").textContent = "Saved in this browser";
        },
        () => {
          $("save-status").textContent =
            "Browser storage full · download a project copy";
        },
      );
    } catch (error) {
      $("save-status").textContent = error.message;
    }
  }, 250);
}
function download(value, name, type = "application/json") {
  const blob = new Blob(
    [typeof value === "string" ? value : JSON.stringify(value, null, 2)],
    { type },
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function checkpoint(label = state.world.name) {
  const item = makeCheckpoint(
    state.world,
    state.photo,
    label,
    `cp-${crypto.randomUUID()}`,
  );
  state.checkpoints = [...state.checkpoints.slice(-11), item];
  return item;
}
function restoreProject(project) {
  state.receiptCourier = null;
  Object.assign(state, {
    world: project.world,
    photo: project.photo,
    name: project.name,
    briefInstruction:
      project.briefInstruction ||
      (project.world.contract ? (project.runSummary?.goal ?? "") : ""),
    checkpoints: project.checkpoints,
    trials: project.trials,
    tick: project.tick,
    selected: null,
    candidate: null,
    comparing: false,
    playing: false,
    creatorStudy:
      project.name === "A fair delivery brief" &&
      project.world.contract?.minimumPerHouse === 3 &&
      project.world.provenance?.type === "synthetic",
    result: project.runSummary
      ? { ...project.runSummary, experiments: project.trials }
      : null,
  });
  state.run = simulate(state.world);
  $("project-name").value = state.name;
  $("verdict").hidden = true;
  $("agent-activity").hidden = true;
  if (project.selectedTrialId) selectTrial(project.selectedTrialId);
  else render();
}

function toast(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    $("toast").hidden = true;
  }, 6000);
}
async function api(path, body) {
  const response = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  if (!response.ok)
    if (result.code === "LIVE_ACCESS_REQUIRED") {
      openLiveAccess();
      throw new Error(result.error);
    }
  if (!response.ok)
    throw new Error(result.error ?? "The operation could not be completed.");
  return result;
}
function updateLiveControls() {
  const unavailable =
    !state.status?.configured || Boolean(state.status.budget?.blocked);
  const reason = state.status?.budget?.blocked
    ? "Live calls are paused. Recorded studies and local changes are available."
    : "Live Meta is unavailable. Explore the recorded playtest or try local changes.";
  for (const id of [
    "playtest",
    "compile-rules",
    "compile-brief",
    "scan-photo",
  ]) {
    $(id).disabled =
      state.busy || unavailable || (id === "scan-photo" && !state.scanImage);
    $(id).title = unavailable ? reason : "";
  }
  document.querySelector(".api-note").textContent = unavailable
    ? reason
    : "Live Meta request · protected by your app budget";
}
async function refreshStatus() {
  try {
    state.status = await api("/api/status");
    const b = state.status.budget;
    $("spend").textContent = `$${b.spentUsd.toFixed(3)}`;
    $("connection").classList.toggle(
      "ready",
      state.status.configured &&
        !b.blocked &&
        (!state.status.accessRequired || state.status.authorized),
    );
    $("connection").replaceChildren(
      Object.assign(document.createElement("i")),
      document.createTextNode(
        b.blocked
          ? "API paused"
          : state.status.configured
            ? state.status.accessRequired && !state.status.authorized
              ? "Meta · code required"
              : "Meta configured"
            : "Local mode",
      ),
    );
    $("manage-access").hidden = !state.status.accessRequired;
    $("budget-details").innerHTML =
      `<dl><dt>Recorded API cost estimate</dt><dd>$${b.spentUsd.toFixed(5)}</dd><dt>Held for pending calls</dt><dd>$${b.heldUsd.toFixed(4)}</dd><dt>Current phase cap</dt><dd>$${b.phaseBudgetUsd}</dd><dt>Project budget</dt><dd>$${b.totalBudgetUsd}</dd><dt>Protected reserve</dt><dd>$${b.reserveUsd}</dd><dt>Requests recorded</dt><dd>${b.requests}</dd></dl><p>${escape(b.scope)}</p><p>Token costs use published Standard rates without cache discounts. Unknown charges are held conservatively. The app pauses if a charge cannot be confirmed.</p>${b.blocked ? `<p><strong>${escape(b.blocked)}</strong></p>` : ""}`;
    updateLiveControls();
  } catch {
    state.status = null;
    $("connection").textContent = "Backend unavailable";
    updateLiveControls();
  }
}
function openLiveAccess() {
  if ($("scan-dialog").open) $("scan-dialog").close();
  if ($("rules-dialog").open) $("rules-dialog").close();
  if ($("budget-dialog").open) $("budget-dialog").close();
  $("access-code").value = "";
  $("access-status").textContent = state.status?.authorized
    ? "Live Meta calls are enabled in this browser for up to two hours."
    : "The code unlocks live calls in this browser for two hours.";
  $("logout-access").hidden = !state.status?.authorized;
  $("access-code").required = !state.status?.authorized;
  if (!$("access-dialog").open) $("access-dialog").showModal();
}
async function ensureLiveAccess() {
  await refreshStatus();
  if (!state.status?.configured || state.status.budget?.blocked) {
    toast(
      "Live Meta is unavailable. Recorded studies and local changes are ready to explore.",
    );
    return false;
  }
  if (state.status?.accessRequired && !state.status.authorized) {
    openLiveAccess();
    return false;
  }
  return true;
}
$("close-access").addEventListener("click", () => $("access-dialog").close());
$("manage-access").addEventListener("click", openLiveAccess);
$("access-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("unlock-access").disabled = true;
  try {
    await api("/api/access", { code: $("access-code").value.trim() });
    $("access-code").value = "";
    await refreshStatus();
    $("access-dialog").close();
    toast("Live Meta enabled. Select the action you want to run.");
  } catch (error) {
    $("access-status").textContent = error.message;
  } finally {
    $("unlock-access").disabled = false;
  }
});
$("logout-access").addEventListener("click", async () => {
  try {
    await api("/api/logout", {});
    await refreshStatus();
    $("access-dialog").close();
    toast("Live calls locked in this browser.");
  } catch (error) {
    $("access-status").textContent = error.message;
  }
});
function setBusy(busy) {
  state.busy = busy;
  for (const id of [
    "playtest",
    "local-sweep",
    "capture",
    "scenario",
    "reset-world",
    "recorded-example",
    "photo-file",
    "use-camera",
    "take-photo",
    "fixture-a",
    "fixture-b",
    "replay-capture",
    "open-project",
    "save-project",
    "export",
    "open-clip",
    "save-checkpoint",
    "compare-checkpoint",
    "edit-rules",
    "preview-rules",
    "compile-rules",
    "apply-candidate",
    "project-name",
    "checkpoints",
    "capture-hero",
    "open-study",
    "open-creator-study",
    "design-hero",
    "preview-event",
    "clear-events",
    "rule-prompt-flood",
    "rule-prompt-pause",
    "recorded-rule",
  ])
    $(id).disabled = busy;
  $("scan-photo").disabled = busy || !state.scanImage;
  $("confirm-scan").disabled = busy || !state.scanResult?.objects.length;
  $("compare-checkpoint").disabled = busy || !state.checkpoints.length;
  $("playtest").textContent = busy
    ? "Testing the world…"
    : "Find & test a fix ↗";
  document.querySelectorAll("[data-study]").forEach((button) => {
    button.disabled = busy;
  });
  document.querySelectorAll("[data-creator-step]").forEach((button) => {
    button.disabled = busy;
  });
  $("clear-events").disabled = busy || !state.world.events?.length;
  $("rule-prompt-flood").disabled = busy || !state.world.bridges.length;
  updateLiveControls();
  designLab?.render();
}
function commitWorld(
  world,
  { photo = state.photo, remember = true, briefInstruction = "" } = {},
) {
  if (state.busy) return;
  const validated = validateWorld(world);
  if (remember) checkpoint("Before · " + state.world.name);
  state.world = validated;
  state.briefInstruction = briefInstruction;
  state.photo = photo;
  state.run = simulate(state.world);
  state.candidate = null;
  state.trials = [];
  state.result = null;
  state.comparing = false;
  state.soloCandidate = false;
  state.studyStep = null;
  state.playing = false;
  state.tick = 0;
  state.receiptCourier = null;
  state.creatorStudy = false;
  $("verdict").hidden = true;
  $("agent-activity").hidden = true;
  render();
  autosave();
}
function roleOf(object) {
  return object.id === state.world.source.id
    ? "source"
    : state.world.houses.some((h) => h.id === object.id)
      ? "house"
      : state.world.bridges.some((b) => b.id === object.id)
        ? "bridge"
        : "obstacle";
}
function renderObjects() {
  const objects = [
    state.world.source,
    ...state.world.houses,
    ...state.world.bridges,
    ...state.world.obstacles,
  ];
  $("object-count").textContent = `${objects.length} objects`;
  $("objects").innerHTML = objects
    .map(
      (o) =>
        `<button class="object-row${o.id === state.selected ? " selected" : ""}" data-object="${escape(o.id)}"><span class="object-symbol ${roleOf(o)}">${roleSymbol[roleOf(o)]}</span><span>${escape(o.label ?? (roleOf(o) === "bridge" ? (o.id.includes("north") ? "North bridge" : o.id.includes("south") ? "South bridge" : "Bridge") : "Stone"))}</span><small>${roleOf(o) === "house" ? `${o.demand} water` : roleOf(o)}</small></button>`,
    )
    .join("");
  const selected = objects.find((o) => o.id === state.selected);
  $("object-detail").hidden = !selected;
  if (selected)
    $("object-detail").innerHTML =
      `<strong>${escape(selected.label ?? selected.id)}</strong><br>Cell ${selected.x + 1}, ${selected.y + 1}${selected.demand ? `<br>${selected.demand} water · deadline turn ${selected.deadline}` : ""}<br>${state.comparing ? "Drag a bridge to nudge the selected proposal. A stays fixed." : "Drag on the world to move."}`;
}
function drawMechanics() {
  const a = state.world.events ?? [],
    b = state.candidate?.world.events ?? [];
  const both = state.comparing && state.candidate;
  const worlds = both
    ? JSON.stringify(a) === JSON.stringify(b)
      ? [{ label: "A / B · LOCKED SCHEDULE", world: state.world }]
      : [
          { label: "A · ORIGINAL SCHEDULE", world: state.world },
          { label: "B · PROPOSED SCHEDULE", world: state.candidate.world },
        ]
    : [
        {
          label: state.soloCandidate
            ? "B · PROPOSED SCHEDULE"
            : "A · WORLD SCHEDULE",
          world: state.soloCandidate ? state.candidate.world : state.world,
        },
      ];
  const phases = worlds.map((row) => ({
    label: row.label,
    events: (row.world.events ?? []).map((e) => ({
      ...e,
      phase:
        state.tick < e.from
          ? "upcoming"
          : state.tick < e.to + 1
            ? "active"
            : "ended",
    })),
  }));
  const signature = JSON.stringify(phases);
  $("mechanics-strip").hidden = !phases.some((row) => row.events.length);
  if (drawMechanics.signature === signature) return;
  drawMechanics.signature = signature;
  $("mechanics-strip").innerHTML =
    worlds
      .map(
        (row, i) =>
          '<div class="mechanic-row"><span class="eyebrow">' +
          row.label +
          "</span><div>" +
          ((row.world.events ?? [])
            .map(
              (e, j) =>
                '<span class="mechanic-pill ' +
                phases[i].events[j].phase +
                '"><i></i>' +
                escape(describeEvent(e, row.world)) +
                "<small>" +
                phases[i].events[j].phase +
                "</small></span>",
            )
            .join("") ||
            '<span class="no-mechanics">No scheduled events</span>') +
          "</div></div>",
      )
      .join("") +
    '<button class="text-button" data-edit-mechanics>Edit schedule ↗</button>';
}
function renderRuleSchedule() {
  const kind = $("event-kind").value;
  const targets =
    kind === "bridge_closed" ? state.world.bridges : [state.world.source];
  $("event-target").innerHTML = targets
    .map(
      (o) =>
        '<option value="' +
        escape(o.id) +
        '">' +
        escape(o.label ?? o.id) +
        "</option>",
    )
    .join("");
  $("preview-event").disabled = state.busy || !targets.length;
  $("clear-events").disabled = state.busy || !state.world.events?.length;
  $("rule-prompt-flood").disabled = state.busy || !state.world.bridges.length;
  $("events-list").innerHTML =
    (state.world.events ?? [])
      .map(
        (e) =>
          '<div class="scheduled-rule">' +
          escape(describeEvent(e, state.world)) +
          "</div>",
      )
      .join("") ||
    '<p class="small-copy">No timed events. Add a rule to stress-test this design.</p>';
  $("event-from").max = state.world.rules.horizon;
  $("event-to").max = state.world.rules.horizon;
}
$("event-kind").addEventListener("change", renderRuleSchedule);
$("preview-event").addEventListener("click", () => {
  if (state.busy) return;
  try {
    const event = {
      id: "event-" + crypto.randomUUID(),
      kind: $("event-kind").value,
      targetId: $("event-target").value,
      from: Number($("event-from").value),
      to: Number($("event-to").value),
    };
    const { world } = applyRuleChange(state.world, {
      events: [...(state.world.events ?? []), event],
    });
    previewWorld(world, {
      kind: "rules",
      source: "manual",
      label: describeEvent(event, world),
    });
    $("rules-dialog").close();
    state.tick = event.from;
    draw();
  } catch (error) {
    $("rule-status").textContent = error.message;
  }
});
$("clear-events").addEventListener("click", () => {
  if (state.busy) return;
  try {
    const { world } = applyRuleChange(state.world, { events: [] });
    previewWorld(world, {
      kind: "rules",
      source: "manual",
      label: "Remove scheduled mechanics",
    });
    $("rules-dialog").close();
  } catch (error) {
    $("rule-status").textContent = error.message;
  }
});
$("rule-prompt-flood").addEventListener("click", () => {
  const b =
    state.world.bridges.find((b) => b.id === "bridge-north") ??
    state.world.bridges[0];
  if (!b) return;
  const name =
    b.id === "bridge-north"
      ? "north bridge"
      : b.label
        ? b.label + " (ID " + b.id + ")"
        : b.id;
  $("rule-instruction").value =
    "Close the " +
    name +
    " from turn " +
    Math.ceil(state.world.rules.horizon * 0.2) +
    " through turn " +
    Math.ceil(state.world.rules.horizon * 0.42) +
    ". Keep all other rules and scheduled events unchanged.";
  $("rule-instruction").focus();
});
$("rule-prompt-pause").addEventListener("click", () => {
  $("rule-instruction").value =
    "Pause the well's production from turn " +
    Math.ceil(state.world.rules.horizon * 0.2) +
    " through turn " +
    Math.ceil(state.world.rules.horizon * 0.35) +
    ". Keep existing water and every other rule unchanged.";
  $("rule-instruction").focus();
});

function isValleyStudy() {
  return (
    state.result?.source === "recorded-meta-run" &&
    worldSignature(state.world) === worldSignature(exampleWorld())
  );
}
function renderMetrics() {
  const a = state.run.metrics;
  const b = state.candidate?.run.metrics;
  const floor = state.world.contract?.minimumPerHouse;
  const minA = Math.min(...state.run.houses.map((h) => h.onTime));
  const minB = state.candidate
    ? Math.min(...state.candidate.run.houses.map((h) => h.onTime))
    : null;
  $("stage-score").innerHTML =
    floor != null
      ? b
        ? `<span>${minA}</span> → ${minB}`
        : String(minA)
      : b
        ? `<span>${a.onTime}</span> → ${b.onTime}<span>/${b.demand}</span>`
        : `${a.onTime}<span>/${a.demand}</span>`;
  $("stage-score-label").textContent =
    floor != null
      ? `minimum on time per home · target ≥${floor}`
      : b
        ? "on time · A → B · full runs"
        : "on time · full run";
  $("stage-score").classList.toggle(
    "worse",
    Boolean(b && b.onTime / b.demand < a.onTime / a.demand),
  );
  const metric = (label, value, suffix, change, warning = false) =>
    `<div class="metric"><div class="metric-label">${label}</div><div class="metric-value${warning ? " orange" : ""}">${value}<small>${suffix}</small></div><div class="metric-change ${change?.good ? "good" : change?.bad ? "bad" : ""}">${change?.text ?? "Original world · full replay"}</div></div>`;
  $("metrics").innerHTML =
    metric(
      "Water delivered on time",
      b ? b.onTime : a.onTime,
      `/ ${(b ?? a).demand}`,
      b
        ? {
            text: `A: ${a.onTime}/${a.demand} → B: ${b.onTime}/${b.demand}`,
            good: b.onTime > a.onTime,
            bad: b.onTime < a.onTime,
          }
        : null,
    ) +
    metric(
      (b ?? a).pendingUnits
        ? "Late or awaiting deadline"
        : "Units missing their deadline",
      b
        ? b.lateUnits + (b.pendingUnits ?? 0)
        : a.lateUnits + (a.pendingUnits ?? 0),
      "units",
      (b ?? a).pendingUnits
        ? {
            text: `${(b ?? a).lateUnits} late · ${(b ?? a).pendingUnits} awaiting deadline`,
          }
        : b
          ? {
              text:
                a.lateUnits === b.lateUnits
                  ? "Same as original"
                  : `${Math.abs(a.lateUnits - b.lateUnits)} ${a.lateUnits > b.lateUnits ? "fewer" : "more"} than original`,
              good: b.lateUnits < a.lateUnits,
              bad: b.lateUnits > a.lateUnits,
            }
          : null,
      (b ?? a).lateUnits + ((b ?? a).pendingUnits ?? 0) > 0,
    ) +
    metric(
      "Waiting at bridges",
      b ? b.waitTicks : a.waitTicks,
      "turns",
      b
        ? {
            text: `A: ${a.waitTicks} → B: ${b.waitTicks}`,
            good: b.waitTicks < a.waitTicks,
            bad: b.waitTicks > a.waitTicks,
          }
        : null,
    );
}
function renderEvents() {
  const run = state.candidate?.run ?? state.run;
  const events = run.events.filter((e) =>
    [
      "deadline_missed",
      "unreachable",
      "all_delivered",
      "bridge_queue",
      "bridge_closed",
      "bridge_opened",
      "bridge_closed_wait",
      "production_paused",
      "production_resumed",
      "reroute",
    ].includes(e.type),
  );
  $("event-log").innerHTML =
    events
      .map(
        (e) =>
          `<div class="event-row ${e.type === "deadline_missed" || e.type === "unreachable" ? "warning" : e.type === "all_delivered" ? "success" : ""}"><time>T${String(e.tick).padStart(3, "0")}</time><span>${escape(e.message)}</span><button data-tick="${e.tick}" aria-label="Replay turn ${e.tick}">Replay ↗</button></div>`,
      )
      .join("") ||
    '<div class="event-row"><span>No queue or deadline events in this world.</span></div>';
  $("household-results").innerHTML =
    `<table class="house-table"><thead><tr><th>HOUSEHOLD</th><th>ON TIME</th><th>DELIVERED</th><th>DEADLINE</th></tr></thead><tbody>${run.houses.map((h) => `<tr><td>${escape(h.label)}</td><td>${h.onTime} / ${h.demand}</td><td>${h.delivered} / ${h.demand}</td><td>Turn ${h.deadline}</td></tr>`).join("")}</tbody></table>`;
}
function renderTrials() {
  $("trial-count").textContent = state.trials.length;
  if (!state.trials.length) {
    $("trials").innerHTML =
      '<div class="empty-trials"><span>↗ ↘</span><p>A good idea earns its place<br>by surviving a test.</p></div>';
    return;
  }
  const displayed = state.candidate
    ? [
        ...state.trials.filter((t) => t.id === state.candidate.id),
        ...state.trials.filter((t) => t.id !== state.candidate.id),
      ]
    : state.trials;
  $("trials").innerHTML = displayed
    .map((t) => {
      const comparison = t.comparison;
      const label = comparison.goalMet
        ? "GOAL MET"
        : comparison.improved
          ? "IMPROVED"
          : "NO IMPROVEMENT";
      return `<button class="trial-card${state.candidate?.id === t.id ? " selected" : ""}" data-trial="${escape(t.id)}"><span class="trial-top"><span>TRIAL ${String(state.trials.indexOf(t) + 1).padStart(2, "0")}</span><span class="trial-badge${comparison.improved || comparison.goalMet ? "" : " failed"}">${label}</span></span><strong>${escape(t.label)}</strong><span class="trial-stats"><span>${t.evidence.metrics.onTime}/${t.evidence.metrics.demand} on time</span><span>${t.evidence.metrics.waitTicks} waiting turns</span></span></button>`;
    })
    .join("");
}
function render() {
  if (!state.candidate) state.soloCandidate = false;
  $("world-name").textContent = state.world.name;
  $("policy-label").textContent = policyLabel[state.world.rules.dispatch];
  $("scene-tag").textContent =
    state.world.provenance?.type === "synthetic"
      ? "SYNTHETIC"
      : state.world.provenance?.type === "photo"
        ? "YOUR TABLE"
        : "EXAMPLE";
  $("courier-count").textContent = `${state.world.rules.couriers} couriers`;
  const designPreview =
    state.candidate &&
    ["rules", "capture", "checkpoint"].includes(state.candidate.kind);
  $("change-constraint").textContent = designPreview
    ? "Creator design preview"
    : "1 change / trial";
  $("resource-constraint").textContent = designPreview
    ? "Review rule differences"
    : state.world.events?.length
      ? "Resources + schedule locked"
      : "Same resources";
  $("replay-note").textContent =
    state.candidate && !state.candidate.comparison.sameSeed
      ? "Different seeds · inspect inputs"
      : state.candidate
        ? "Same seed · replayable results"
        : "Deterministic replay";
  const horizon = Math.max(
    state.world.rules.horizon,
    state.candidate?.world.rules.horizon ?? 0,
  );
  $("horizon").textContent = ` / ${horizon}`;
  $("timeline").max = horizon;
  $("result-caption").textContent =
    `${state.candidate ? "B" : "A"} · Results across ${(state.candidate?.world ?? state.world).rules.horizon} turns`;
  $("view-compare").disabled = !state.candidate;
  $("view-candidate").disabled = !state.candidate;
  $("view-compare").classList.toggle("active", state.comparing);
  $("view-world").classList.toggle(
    "active",
    !state.comparing && !state.soloCandidate,
  );
  $("view-candidate").classList.toggle("active", state.soloCandidate);
  $("world-caption-label").innerHTML = state.soloCandidate
    ? '<i class="branch-dot alternative"></i>B · Proposed world'
    : '<i class="branch-dot"></i>A · Original world';
  $("policy-label").textContent =
    policyLabel[
      (state.soloCandidate ? state.candidate.world : state.world).rules.dispatch
    ];
  $("candidate-pane").hidden = !state.comparing;
  $("canvas-section").classList.toggle("comparing", state.comparing);
  $("candidate-label").textContent = state.candidate?.label.slice(0, 36) ?? "";
  if (state.photo) $("table-photo").src = state.photo;
  else $("table-photo").removeAttribute("src");
  $("table-photo").alt =
    state.world.provenance?.type === "synthetic"
      ? "AI-generated tabletop test input"
      : "Your captured tabletop";
  $("table-preview").hidden = Boolean($("table-photo").getAttribute("src"));
  $("table-photo").hidden = !Boolean($("table-photo").getAttribute("src"));
  $("preview-caption").textContent =
    state.world.provenance?.type === "synthetic"
      ? "AI-generated test input"
      : state.world.provenance?.type === "photo"
        ? $("table-photo").hidden
          ? "Saved layout · photo not stored"
          : "Your table · confirmed roles"
        : "A little valley, on your desk";
  const visiblePhoto = state.soloCandidate
    ? (state.candidate.photo ?? state.photo)
    : state.photo;
  $("source-photo").hidden = !visiblePhoto;
  if (visiblePhoto) $("source-photo").src = visiblePhoto;
  else $("source-photo").removeAttribute("src");
  document.querySelector(".source-icon").hidden = Boolean(visiblePhoto);
  $("source-caption").textContent =
    state.world.provenance?.type === "synthetic"
      ? "AI-generated tabletop input · confirmed roles"
      : state.world.provenance?.type === "photo"
        ? "Your tabletop · confirmed roles"
        : "An authored example world";
  $("study-controls").hidden = !isValleyStudy();
  document.querySelectorAll("[data-study]").forEach((button) => {
    const active = button.dataset.study === state.studyStep;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  const checkpointId = $("checkpoints").value;
  $("checkpoints").innerHTML = state.checkpoints.length
    ? state.checkpoints
        .map(
          (cp) =>
            `<option value="${escape(cp.id)}">${escape(cp.label)}</option>`,
        )
        .join("")
    : '<option value="">No checkpoints yet</option>';
  if (state.checkpoints.some((cp) => cp.id === checkpointId))
    $("checkpoints").value = checkpointId;
  $("compare-checkpoint").disabled = state.busy || !state.checkpoints.length;
  $("change-preview").hidden = !state.candidate;
  $("change-instruction").hidden = !state.candidate?.instruction;
  if (state.candidate) {
    $("change-instruction").textContent = state.candidate.instruction
      ? `“${state.candidate.instruction}”`
      : "";
    $("change-title").textContent =
      `${state.candidate.kind === "rules" ? "Designer rule preview" : "Changes from A to B"}${state.candidate.source === "imported" ? " · imported, recomputed" : state.candidate.source === "recorded-meta-design" ? " · recorded Meta proposal" : ""}`;
    const changes = describeWorldChanges(state.world, state.candidate.world);
    $("change-list").innerHTML = (
      changes.length ? changes : ["No layout or rule differences."]
    )
      .map((text) => `<li>${escape(text)}</li>`)
      .join("");
  }
  renderObjects();
  renderMetrics();
  renderEvents();
  renderTrials();
  designLab?.render();
  $("creator-controls").hidden = !state.creatorStudy;
  requestAnimationFrame(draw);
}
function draw() {
  const shownWorld = state.soloCandidate ? state.candidate.world : state.world;
  const shownRun = state.soloCandidate ? state.candidate.run : state.run;
  const changedIds = state.candidate
    ? state.candidate.world.bridges
        .filter((b) =>
          state.world.bridges.some((a) => a.id === b.id && a.y !== b.y),
        )
        .map((b) => b.id)
    : [];
  drawWorld(
    $("world-canvas"),
    shownWorld,
    shownRun,
    state.tick,
    state.selected,
    state.soloCandidate,
    {
      changedIds: state.soloCandidate || state.comparing ? changedIds : [],
      originBridges: state.soloCandidate ? state.world.bridges : [],
      dragCell: state.dragSide === "a" ? state.dragCell : null,
      ambientTime: ambientClock,
      selectedCourier:
        state.receiptCourier?.side === "a" ? state.receiptCourier.id : null,
    },
  );
  if (state.comparing && state.candidate)
    drawWorld(
      $("candidate-canvas"),
      state.candidate.world,
      state.candidate.run,
      state.tick,
      state.selected,
      true,
      {
        changedIds,
        originBridges: state.world.bridges,
        dragCell: state.dragSide === "b" ? state.dragCell : null,
        ambientTime: ambientClock,
        selectedCourier:
          state.receiptCourier?.side === "b" ? state.receiptCourier.id : null,
      },
    );
  if (!$("table-preview").hidden)
    drawTablePreview($("table-preview"), state.world);
  $("timeline").value = Math.round(state.tick);
  $("turn").textContent = Math.round(state.tick);
  $("play").textContent = state.playing ? "Ⅱ" : "▶";
  $("play").setAttribute(
    "aria-label",
    state.playing ? "Pause simulation" : "Play simulation",
  );
  drawMechanics();
  const t = Math.floor(state.tick);
  const frame = shownRun.frames[Math.min(t, shownRun.frames.length - 1)];
  const failureRun = state.comparing ? state.run : shownRun;
  const failure = failureRun.events.find((e) =>
    ["deadline_missed", "unreachable"].includes(e.type),
  );
  $("jump-event").disabled = !failure;
  $("jump-event").textContent = failure
    ? `Inspect ${state.comparing ? "A’s " : ""}first failure ↗`
    : "All deadlines met";
  $("signal-kicker").textContent = state.comparing
    ? "SYNCHRONIZED REPLAY · A / B"
    : `${state.soloCandidate ? "B" : "A"} · REPLAY AT TURN ${String(t).padStart(3, "0")}`;
  const latestMiss = shownRun.events.findLast(
    (e) => e.type === "deadline_missed" && e.tick <= t,
  );
  $("signal-text").textContent = state.comparing
    ? `Turn ${t}: A has delivered ${state.run.frames[Math.min(t, state.run.frames.length - 1)].delivered}/${state.run.metrics.demand} water; B has delivered ${state.candidate.run.frames[Math.min(t, state.candidate.run.frames.length - 1)].delivered}/${state.candidate.run.metrics.demand}.`
    : (latestMiss?.message ??
      `At this turn, ${frame.delivered}/${shownRun.metrics.demand} water units have arrived. ${frame.agents.filter((a) => a.waiting).length} couriers are waiting at a crossing.`);
}
function selectTrial(id, { focus = false } = {}) {
  const t = state.trials.find((t) => t.id === id);
  if (!t) return;
  state.receiptCourier = null;
  $("receipt-replay-note").textContent = "";
  state.candidate = { ...t, run: simulate(t.world) };
  const narrow = matchMedia("(max-width: 560px)").matches;
  state.comparing = !narrow;
  state.soloCandidate = narrow;
  if (focus) {
    const failure = state.run.events.find(
      (e) => e.type === "deadline_missed" || e.type === "unreachable",
    );
    state.tick =
      failure?.tick ??
      Math.min(
        state.world.rules.horizon,
        state.candidate.run.metrics.completedAt ??
          Math.floor(state.world.rules.horizon / 2),
      );
    state.selected = failure?.houseId ?? null;
    state.playing = false;
  }
  state.tick = Math.min(
    state.tick,
    Math.max(state.world.rules.horizon, t.world.rules.horizon),
  );
  render();
  $("trials").scrollTop = 0;
  if (
    ["capture", "rules", "checkpoint"].includes(t.kind) ||
    t.source === "imported"
  ) {
    $("verdict").className = `verdict${t.comparison.goalMet ? "" : " warning"}`;
    $("verdict").replaceChildren();
    const title = document.createElement("strong");
    title.textContent =
      t.source === "imported"
        ? "Imported trial, replayed."
        : "A design change, measured.";
    $("verdict").append(
      title,
      document.createTextNode(
        `${t.evidence.metrics.onTime}/${t.evidence.metrics.demand} water units on time in B. Review the changes before applying. ${t.source === "imported" ? "Imported inputs; results recomputed locally." : t.source === "recorded-meta-design" ? "Recorded Meta rule proposal; the simulator recomputed the outcome. No new API calls." : t.kind === "rules" && t.source === "meta" ? "Meta translated the instruction; the simulator checked the outcome." : "Computed locally from the confirmed layout and rules."}`,
      ),
    );
    $("verdict").hidden = false;
  } else if (state.result)
    displayVerdict(
      {
        ...state.result,
        selected: true,
        verdict: t.comparison.goalMet
          ? "goal_met"
          : t.comparison.improved
            ? "improved"
            : "no_improvement",
        verification: { goalMet: t.comparison.goalMet },
      },
      state.result.source === "local-sweep",
    );
  autosave();
}
function previewWorld(
  world,
  {
    kind,
    label,
    photo = state.photo,
    source = kind,
    model = "",
    instruction = "",
  } = {},
) {
  const trial = verifyTrial(state.world, {
    id: `${kind}-${Date.now().toString(36)}`,
    kind,
    label,
    world,
    photo,
    source,
    model,
    instruction,
  });
  state.trials = [...state.trials.slice(-31), trial];
  selectTrial(trial.id);
  if (kind === "rules") {
    const changedEvent = (world.events ?? []).find(
      (e) =>
        !(state.world.events ?? []).some(
          (old) => JSON.stringify(old) === JSON.stringify(e),
        ),
    );
    if (changedEvent) {
      state.tick = changedEvent.from;
      state.selected = changedEvent.targetId;
      draw();
    }
  }
}
function displayVerdict(result, local = false) {
  const title = {
    goal_met: "The change passes the test.",
    improved: "Better — with work still to do.",
    already_met: "This world already meets the goal.",
    no_improvement: result.selected
      ? "This idea did not improve the result."
      : "No verified fix found in these trials.",
  }[result.verdict];
  const currentMetrics = state.candidate?.run.metrics ?? state.run.metrics;
  const text = currentMetrics.pendingUnits
    ? `The replay ends with ${currentMetrics.pendingUnits} deliveries still awaiting their deadlines. Extend the horizon to verify them.`
    : result.verdict === "goal_met"
      ? "Every condition of the confirmed test brief passed with the same resources. Inspect household changes and waiting tradeoffs."
      : result.verdict === "improved"
        ? "This trial improved the measured result. Some deadlines are still missed."
        : result.verdict === "already_met"
          ? "The original world already passes every condition of the confirmed brief."
          : result.selected
            ? "This trial did not meet the goal. Other tested candidates may do better."
            : "These trials did not meet the goal. This does not prove that no solution exists.";
  $("verdict").className =
    `verdict${result.verification?.goalMet ? "" : " warning"}`;
  $("verdict").innerHTML =
    `<strong>${title}</strong>${text}<br><small>${local ? "Local simulation sweep · no AI calls" : result.source === "recorded-meta-run" ? "Recorded Meta run · freshly replayed · no new API calls" : `Muse Spark · ${result.experiments.length} verified trials`}</small>`;
  $("verdict").hidden = false;
}

$("objects").addEventListener("click", (e) => {
  const row = e.target.closest("[data-object]");
  if (row) {
    state.selected = row.dataset.object;
    renderObjects();
    draw();
  }
});
$("scenario").addEventListener("change", () => {
  state.selected = null;
  commitWorld(exampleWorld($("scenario").value), { photo: null });
});
$("reset-world").addEventListener("click", () => {
  state.selected = null;
  commitWorld(exampleWorld($("scenario").value), { photo: null });
});
$("play").addEventListener("click", () => {
  if (
    state.tick >=
    Math.max(
      state.world.rules.horizon,
      state.candidate?.world.rules.horizon ?? 0,
    )
  )
    state.tick = 0;
  state.playing = !state.playing;
  if (state.playing)
    document
      .querySelector(".simulation-heading")
      .scrollIntoView({ block: "nearest" });
  draw();
});
$("rewind").addEventListener("click", () => {
  state.tick = 0;
  state.playing = false;
  draw();
});
$("timeline").addEventListener("input", (e) => {
  state.tick = Number(e.target.value);
  state.playing = false;
  draw();
  autosave();
});
$("speed").addEventListener("change", (e) => {
  state.speed = Number(e.target.value);
});
$("view-world").addEventListener("click", () => {
  state.comparing = false;
  state.soloCandidate = false;
  render();
});
$("world-zoom").addEventListener("change", (e) => {
  $("world-canvas").dataset.zoom = e.target.value;
  $("candidate-canvas").dataset.zoom = e.target.value;
  draw();
});
$("view-candidate").addEventListener("click", () => {
  if (!state.candidate) return;
  state.comparing = false;
  state.soloCandidate = true;
  render();
});
$("view-compare").addEventListener("click", () => {
  if (state.candidate) {
    state.comparing = true;
    state.soloCandidate = false;
    render();
  }
});
$("jump-event").addEventListener("click", () => {
  const run = state.soloCandidate ? state.candidate.run : state.run;
  const e = run.events.find((e) =>
    ["deadline_missed", "unreachable"].includes(e.type),
  );
  if (!e) return;
  state.tick = e.tick;
  state.selected = e.houseId ?? null;
  state.playing = false;
  renderObjects();
  draw();
});
$("show-inspector").addEventListener("click", () =>
  $("scene-dialog").showModal(),
);
function setFocusView(active) {
  document.body.classList.toggle("focus-world", active);
  $("focus-world").setAttribute("aria-pressed", String(active));
  $("focus-world").textContent = active ? "↙ Exit focus" : "↗ Focus";
  requestAnimationFrame(draw);
}
$("focus-world").addEventListener("click", () =>
  setFocusView(!document.body.classList.contains("focus-world")),
);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !document.querySelector("dialog[open]"))
    setFocusView(false);
});
$("close-scene").addEventListener("click", () => $("scene-dialog").close());
$("capture-hero").addEventListener("click", () => $("capture").click());
$("design-hero").addEventListener("click", () => $("edit-rules").click());
$("mechanics-strip").addEventListener("click", (event) => {
  if (event.target.closest("[data-edit-mechanics]")) $("edit-rules").click();
});
document.querySelector(".project-menu").addEventListener("click", (e) => {
  if (e.target.closest("button, a"))
    document.querySelector(".project-menu").open = false;
});
$("trials").addEventListener("click", (e) => {
  const card = e.target.closest("[data-trial]");
  if (card) selectTrial(card.dataset.trial);
});
$("event-log").addEventListener("click", (e) => {
  const button = e.target.closest("[data-tick]");
  if (button) {
    state.tick = Number(button.dataset.tick);
    state.playing = false;
    draw();
  }
});
document.querySelectorAll("[data-tab]").forEach((button) =>
  button.addEventListener("click", () => {
    document
      .querySelectorAll("[data-tab]")
      .forEach((b) => b.classList.toggle("active", b === button));
    $("event-log").hidden = button.dataset.tab !== "events";
    $("household-results").hidden = button.dataset.tab !== "households";
    $("receipts-panel").hidden = button.dataset.tab !== "receipts";
    $("stress-panel").hidden = button.dataset.tab !== "stress";
  }),
);
$("budget-button").addEventListener("click", () => {
  refreshStatus();
  $("budget-dialog").showModal();
});
$("close-budget").addEventListener("click", () => $("budget-dialog").close());

let dragged = null;
function finishDrag() {
  dragged = null;
  state.dragCell = null;
  state.dragSide = null;
}
function bindWorldDrag(canvas, side, getWorld) {
  canvas.addEventListener("pointerdown", (e) => {
    if (state.busy) return;
    const world = getWorld();
    if (!world) return;
    if (state.soloCandidate && side === "a")
      return toast(
        "Switch to Original to edit. Apply the proposal to make it your working world.",
      );
    const object = pickObject(canvas, world, e);
    if (!object) return;
    state.selected = object.id;
    dragged = { id: object.id, startX: e.clientX, startY: e.clientY, side };
    state.dragSide = side;
    canvas.setPointerCapture(e.pointerId);
    renderObjects();
    draw();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragged || dragged.side !== side) return;
    const world = getWorld();
    if (!world) return;
    state.dragCell = cellFromPointer(canvas, world, e);
    draw();
  });
  canvas.addEventListener("pointerup", (e) => {
    if (!dragged || dragged.side !== side) return;
    const drag = dragged;
    const world = getWorld();
    finishDrag();
    if (
      !world ||
      Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 4
    )
      return draw();
    const cell = cellFromPointer(canvas, world, e);
    if (state.comparing && state.candidate) {
      const bridge = state.candidate.world.bridges.find(
        (item) => item.id === drag.id,
      );
      if (!bridge)
        return toast(
          "During a comparison, drag a bridge. A stays fixed, and the selected proposal is scored again.",
        );
      try {
        const nudged = nudgeProposalBridge(
          state.candidate.world,
          bridge.id,
          cell.y,
        );
        if (nudged.bridges.find((item) => item.id === bridge.id).y === bridge.y)
          return draw();
        const study = state.creatorStudy;
        previewWorld(nudged, {
          kind: "capture",
          label: `Move ${bridge.label ?? bridge.id} to row ${cell.y + 1} on the selected proposal`,
          source: "layout-probe",
        });
        state.creatorStudy = study;
        render();
        const verdict = evaluateContract(
          state.candidate.run,
          state.world.contract,
        );
        const failed = verdict.checks
          .filter((check) => !check.passed)
          .map((check) => check.label);
        toast(
          verdict.passed
            ? "A is unchanged. This nudge of the selected proposal still passes the brief."
            : `A is unchanged. This nudge fails the brief: ${failed.join("; ")}.`,
        );
      } catch (error) {
        toast(error.message);
        draw();
      }
      return;
    }
    if (state.creatorStudy)
      return toast(
        "This recorded study keeps A fixed. Select a proposal, then drag a bridge to test it.",
      );
    const next = structuredClone(state.world);
    const object = [
      next.source,
      ...next.houses,
      ...next.bridges,
      ...next.obstacles,
    ].find((item) => item.id === drag.id);
    if (next.bridges.includes(object)) object.y = cell.y;
    else {
      object.x = cell.x;
      object.y = cell.y;
    }
    try {
      commitWorld(next);
      toast("Layout changed. A fresh replay is ready.");
    } catch (error) {
      toast(error.message);
      draw();
    }
  });
  canvas.addEventListener("pointercancel", () => {
    if (!dragged || dragged.side !== side) return;
    finishDrag();
    draw();
  });
}
bindWorldDrag($("world-canvas"), "a", () =>
  state.soloCandidate ? state.candidate.world : state.world,
);
bindWorldDrag($("candidate-canvas"), "b", () => state.candidate?.world);

$("local-sweep").addEventListener("click", () => {
  if (state.busy) return;
  const search = searchLocal(state.world);
  const trials = search.trials;
  state.trials = trials;
  const best = trials.find(
    (t) => t.comparison.improved || t.comparison.goalMet,
  );
  state.result = {
    source: "local-sweep",
    verdict: best?.comparison.goalMet
      ? "goal_met"
      : best?.comparison.improved
        ? "improved"
        : evaluateContract(state.run).passed
          ? "already_met"
          : "no_improvement",
    experiments: trials,
    search: {
      checked: search.checked,
      validCandidates: search.validCandidates,
      complete: search.complete,
    },
    verification: {
      goalMet: Boolean(best?.comparison.goalMet),
      testsRun: trials.length,
      seed: state.world.seed,
    },
  };
  if (best) selectTrial(best.id, { focus: true });
  else render();
  displayVerdict(state.result, true);
  $("agent-activity").hidden = true;
  autosave();
  toast(
    `Checked ${search.checked}/${search.validCandidates} permitted local changes${search.complete ? " ? complete for this one-edit space" : " ? trial limit reached"}. No API credit used.`,
  );
});

$("playtest").addEventListener("click", async () => {
  if (state.busy) return;
  if (!(await ensureLiveAccess()) || state.busy) return;
  setBusy(true);
  state.trials = [];
  state.candidate = null;
  state.result = null;
  state.comparing = false;
  state.playing = false;
  $("agent-activity").replaceChildren();
  $("agent-activity").hidden = false;
  $("verdict").hidden = true;
  render();
  try {
    const response = await fetch("/api/playtest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ world: state.world, goal: $("goal").value }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let completed = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let end;
      while ((end = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const line = block.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        const event = JSON.parse(line.slice(6));
        if (event.type === "error") throw new Error(event.message);
        if (event.message) {
          const row = document.createElement("div");
          row.className = "activity-row";
          row.textContent = event.message;
          $("agent-activity").append(row);
          while ($("agent-activity").children.length > 5)
            $("agent-activity").firstElementChild.remove();
        }
        if (event.type === "experiment") {
          state.trials.push(event.experiment);
          renderTrials();
        }
        if (event.type === "complete") {
          completed = true;
          state.result = event.result;
          state.trials = event.result.experiments.map((t) =>
            verifyTrial(state.world, { ...t, kind: "agent", source: "meta" }),
          );
          if (event.result.best)
            selectTrial(event.result.best.id, { focus: true });
          else render();
          displayVerdict(event.result);
        }
      }
    }
    if (!completed)
      throw new Error(
        "The playtest stopped before returning a verified result.",
      );
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(false);
    autosave();
    refreshStatus();
  }
});

$("export").addEventListener("click", () => $("evidence-dialog").showModal());
$("close-evidence").addEventListener("click", () =>
  $("evidence-dialog").close(),
);
$("export-json").addEventListener("click", () => {
  const artifact = {
    format: "liveworld-experiment-v1",
    exportedAt: new Date().toISOString(),
    world: state.world,
    baseline: evidence(state.run),
    playtest: state.result,
    selectedTrial: state.candidate
      ? { ...state.candidate, run: undefined }
      : null,
  };
  download(artifact, "liveworld-experiment.json");
  toast("Experiment exported with its inputs and evidence.");
});
$("save-project").addEventListener("click", () => {
  try {
    download(projectSnapshot(), "liveworld-project.json");
    autosave();
    toast("Project saved with its photos, checkpoints and replayable trials.");
  } catch (error) {
    toast(error.message);
  }
});
$("export-report").addEventListener("click", () => {
  try {
    download(
      experimentReport(projectSnapshot()),
      "liveworld-report.html",
      "text/html;charset=utf-8",
    );
    toast("Report exported. Open it in a browser to read or print.");
  } catch (error) {
    toast(error.message);
  }
});
$("open-project").addEventListener("click", () => $("project-file").click());
$("project-file").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file || state.busy) return;
  if (file.size > PROJECT_LIMIT_BYTES)
    return toast("Choose a project file under 15 MB.");
  try {
    const project = normalizeProject(JSON.parse(await file.text()), {
      imported: true,
    });
    restoreProject(project);
    autosave();
    toast(
      "Project opened. All trial results were recomputed from their inputs.",
    );
  } catch (error) {
    toast(error.message);
  }
});
$("project-name").addEventListener("input", (e) => {
  state.name = e.target.value.trim() || "My LiveWorld";
  e.target.value = state.name;
  autosave();
});
$("save-checkpoint").addEventListener("click", () => {
  const item = checkpoint(
    `Checkpoint ${state.checkpoints.length + 1} · ${state.world.name}`,
  );
  render();
  $("checkpoints").value = item.id;
  autosave();
  toast("Checkpoint saved. Compare it with a later version from the list.");
});
$("compare-checkpoint").addEventListener("click", () => {
  const cp = state.checkpoints.find((cp) => cp.id === $("checkpoints").value);
  if (!cp || state.busy) return;
  const current = { world: state.world, photo: state.photo };
  commitWorld(cp.world, { photo: cp.photo });
  previewWorld(current.world, {
    kind: "checkpoint",
    label: "Current world vs saved checkpoint",
    photo: current.photo,
  });
  $("scene-dialog").close();
});
$("apply-candidate").addEventListener("click", () => {
  if (!state.candidate || state.busy) return;
  const trial = state.candidate;
  commitWorld(trial.world, { photo: trial.photo ?? state.photo });
  toast("B is now your working world. A is saved as a checkpoint.");
});

$("edit-rules").addEventListener("click", () => {
  $("scene-dialog").close();
  for (const [key, value] of Object.entries(state.world.rules))
    $("rule-" + key).value = value;
  $("household-fields").innerHTML = state.world.houses
    .map(
      (h) =>
        `<div class="household-rule-row"><span>${escape(h.label ?? h.id)}</span><label>Water demand<input data-house="${escape(h.id)}" data-field="demand" aria-label="Water demand for ${escape(h.label ?? h.id)}" type="number" min="1" max="12" value="${h.demand}" /></label><label>Deadline turn<input data-house="${escape(h.id)}" data-field="deadline" aria-label="Deadline for ${escape(h.label ?? h.id)}" type="number" min="1" max="240" value="${h.deadline}" /></label></div>`,
    )
    .join("");
  $("rule-status").textContent = "Manual previews use no API credit.";
  renderRuleSchedule();
  $("event-from").value = Math.max(
    1,
    Math.ceil(state.world.rules.horizon * 0.2),
  );
  $("event-to").value = Math.max(
    1,
    Math.ceil(state.world.rules.horizon * 0.42),
  );
  $("rules-dialog").showModal();
});
$("close-rules").addEventListener("click", () => $("rules-dialog").close());
$("preview-rules").addEventListener("click", () => {
  try {
    const values = Object.fromEntries(
      Object.keys(state.world.rules).map((key) => [
        key,
        $("rule-" + key).value,
      ]),
    );
    const proposal = ruleChangeFromForm(values);
    proposal.households = state.world.houses.map((h) => ({ id: h.id }));
    document.querySelectorAll("[data-house]").forEach((input) => {
      proposal.households.find((h) => h.id === input.dataset.house)[
        input.dataset.field
      ] = Number(input.value);
    });
    const { world } = applyRuleChange(state.world, proposal);
    previewWorld(world, {
      kind: "rules",
      source: "manual",
      label: "Manual rule changes",
    });
    $("rules-dialog").close();
    toast("Rules previewed in B. Review the differences, then apply.");
  } catch (error) {
    $("rule-status").textContent = error.message;
  }
});
$("compile-rules").addEventListener("click", async () => {
  if (state.busy) return;
  if (!(await ensureLiveAccess()) || state.busy) return;
  const instruction = $("rule-instruction").value.trim();
  if (!instruction)
    return ($("rule-status").textContent =
      "Describe the rule you want to change.");
  setBusy(true);
  $("rule-status").textContent =
    "Meta is translating your instruction into a rule proposal…";
  try {
    const result = await api("/api/rules", { world: state.world, instruction });
    if (!result.supported) {
      $("rule-status").textContent = result.unsupported.join(" · ");
      return;
    }
    // Reapply and recompute in the browser, rather than trust returned success fields.
    const { world } = applyRuleChange(state.world, result.proposal);
    previewWorld(world, {
      kind: "rules",
      source: "meta",
      label: result.explanation.slice(0, 100),
      model: result.model,
      instruction,
    });
    $("rules-dialog").close();
    toast(
      "Meta's rule proposal is ready in B. Review and apply when satisfied.",
    );
  } catch (error) {
    $("rule-status").textContent = error.message;
  } finally {
    setBusy(false);
    refreshStatus();
    autosave();
  }
});

async function loadRecordedStudy(step = "repair") {
  if (state.busy) return;
  setBusy(true);
  try {
    const result = await api("/examples/valley-playtest.json");
    setBusy(false);
    commitWorld(result.startingWorld);
    for (const trial of result.experiments) {
      const world = applyPatch(state.world, trial.patch).world;
      const run = simulate(world);
      if (
        JSON.stringify(run.metrics) !== JSON.stringify(trial.evidence.metrics)
      )
        throw new Error(
          "Recorded measurements do not match this simulator version.",
        );
      trial.world = world;
      trial.comparison = compareRuns(state.run, run);
      trial.evidence = evidence(run);
    }
    state.result = { ...result, source: "recorded-meta-run" };
    state.trials = result.experiments.map((t) => ({
      ...t,
      kind: "agent",
      source: "recorded-meta-run",
    }));
    state.photo = null;
    showStudyStep(step);
    autosave();
    $("agent-activity").hidden = true;
    toast(
      "Loaded an actual recorded Meta run. All displayed measurements were recomputed locally.",
    );
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(false);
  }
}
function showStudyStep(step) {
  if (state.busy || !isValleyStudy()) return;
  state.studyStep = step;
  state.playing = false;
  if (step === "baseline") {
    state.candidate = null;
    state.comparing = false;
    state.soloCandidate = false;
    const first = state.run.events.find((e) => e.type === "deadline_missed");
    state.tick = first?.tick ?? 0;
    state.selected = first?.houseId ?? null;
    $("verdict").hidden = true;
  } else {
    const trial =
      step === "hypothesis"
        ? state.trials.find((t) => t.patch?.dispatch === "balanced")
        : state.trials.find(
            (t) =>
              t.id ===
              (state.result.best?.id ??
                state.trials.find((trial) => trial.comparison.goalMet)?.id),
          );
    if (!trial) return;
    selectTrial(trial.id);
    if (step === "hypothesis") {
      state.soloCandidate = true;
      state.comparing = false;
      const first = state.candidate.run.events.find(
        (e) => e.type === "deadline_missed",
      );
      state.tick = first?.tick ?? 0;
      state.selected = first?.houseId ?? null;
    } else {
      state.tick =
        state.candidate.run.metrics.completedAt ?? state.world.rules.horizon;
      state.selected = trial.patch?.bridgeMoves?.[0]?.id ?? null;
    }
  }
  render();
  autosave();
}
$("recorded-example").addEventListener("click", () => loadRecordedStudy());
$("open-study").addEventListener("click", () => loadRecordedStudy("baseline"));
$("recorded-rule").addEventListener("click", async () => {
  if (state.busy) return;
  setBusy(true);
  try {
    const record = await api("/examples/closed-crossing-design.json");
    const world = applyRuleChange(record.startingWorld, record.proposal).world;
    const run = simulate(world);
    if (JSON.stringify(evidence(run)) !== JSON.stringify(record.evidence))
      throw new Error(
        "The recorded rule experiment does not match this simulator.",
      );
    setBusy(false);
    commitWorld(record.startingWorld, { photo: null });
    state.name = "A crossing that closes";
    $("project-name").value = state.name;
    state.result = {
      source: "recorded-meta-design",
      model: record.model,
      goal: record.instruction,
      summary: record.explanation,
    };
    previewWorld(world, {
      kind: "rules",
      label: "Close the north bridge · turns 25–50",
      source: "recorded-meta-design",
      model: record.model,
      instruction: record.instruction,
    });
    $("rules-dialog").close();
    toast(
      "Recorded Meta rule experiment loaded. Every result was recomputed; no new API calls.",
    );
    autosave();
  } catch (error) {
    $("rule-status").textContent = error.message;
  } finally {
    setBusy(false);
  }
});

function clearClipDownloads() {
  for (const url of clipUrls) URL.revokeObjectURL(url);
  clipUrls = [];
  for (const id of ["download-clip", "download-clip-project"]) {
    $(id).hidden = true;
    $(id).removeAttribute("href");
  }
}
function clipControls(recording) {
  for (const id of ["clip-mode", "clip-duration", "clip-start", "clip-end"])
    $(id).disabled = recording;
  $("record-clip").disabled = recording || !replayFormat();
  $("cancel-clip").hidden = !recording;
}
$("open-clip").addEventListener("click", () => {
  if (state.busy) return;
  state.playing = false;
  draw();
  clearClipDownloads();
  document.querySelector(".project-menu").open = false;
  const end = Math.max(
    state.world.rules.horizon,
    state.candidate?.world.rules.horizon ?? 0,
  );
  $("clip-mode").value = state.candidate ? "compare" : "original";
  for (const option of $("clip-mode").options)
    option.disabled = option.value !== "original" && !state.candidate;
  $("clip-start").value = 0;
  $("clip-end").value = end;
  $("clip-start").max = end - 1;
  $("clip-end").max = end;
  $("clip-canvas").hidden = true;
  $("clip-progress").hidden = true;
  $("clip-status").textContent = replayFormat()
    ? "Your project and comparison stay unchanged."
    : "Replay video is unavailable in this browser. Project and HTML evidence exports still work.";
  clipControls(false);
  $("clip-dialog").showModal();
});
$("record-clip").addEventListener("click", async () => {
  if (clipRecording) return;
  clearClipDownloads();
  try {
    $("clip-canvas").hidden = false;
    $("clip-progress").hidden = false;
    $("clip-progress").value = 0;
    $("clip-status").textContent = "Preparing the replay frames…";
    clipControls(true);
    let lastPercent = -1;
    clipRecording = createReplayClip(
      $("clip-canvas"),
      projectSnapshot(),
      {
        mode: $("clip-mode").value,
        duration: $("clip-duration").value,
        start: $("clip-start").value,
        end: $("clip-end").value,
      },
      (progress) => {
        const percent = Math.floor(progress * 100);
        if (percent === lastPercent) return;
        lastPercent = percent;
        $("clip-progress").value = progress;
        $("clip-status").textContent =
          `Rendering ${percent}% · 30 frames per second · no API usage`;
      },
    );
    const result = await clipRecording.done;
    const videoUrl = URL.createObjectURL(result.blob);
    const projectUrl = URL.createObjectURL(
      new Blob([JSON.stringify(result.project, null, 2)], {
        type: "application/json",
      }),
    );
    clipUrls = [videoUrl, projectUrl];
    const label = `liveworld-replay-${$("clip-mode").value}-${$("clip-start").value}-${$("clip-end").value}-${$("clip-duration").value}s`;
    $("download-clip").href = videoUrl;
    $("download-clip").download = `${label}.${result.extension}`;
    $("download-clip").hidden = false;
    $("download-clip-project").href = projectUrl;
    $("download-clip-project").download = `${label}.json`;
    $("download-clip-project").hidden = false;
    $("clip-status").textContent =
      `Ready · 1920 × 1080 · ${(result.blob.size / 1_000_000).toFixed(1)} MB · silent engine replay. Download the inputs to reproduce it.`;
    $("clip-progress").value = 1;
  } catch (error) {
    $("clip-status").textContent = error.message;
  } finally {
    clipRecording = null;
    clipControls(false);
  }
});
$("cancel-clip").addEventListener("click", () => clipRecording?.cancel());
$("close-clip").addEventListener("click", () => $("clip-dialog").close());
$("clip-dialog").addEventListener("close", () => clipRecording?.cancel());
document
  .querySelectorAll("[data-study]")
  .forEach((button) =>
    button.addEventListener("click", () => showStudyStep(button.dataset.study)),
  );

// Camera capture is user initiated. Photos stay in the browser until Find objects.
$("capture").addEventListener("click", () => {
  $("scene-dialog").close();
  $("scan-dialog").showModal();
});
function stopCamera() {
  state.camera?.getTracks().forEach((t) => t.stop());
  state.camera = null;
  $("camera").srcObject = null;
  $("camera").hidden = true;
  $("take-photo").hidden = true;
}
$("close-scan").addEventListener("click", () => $("scan-dialog").close());
$("scan-dialog").addEventListener("close", stopCamera);
$("use-camera").addEventListener("click", async () => {
  try {
    stopCamera();
    state.camera = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1280 } },
      audio: false,
    });
    $("camera").srcObject = state.camera;
    $("camera").hidden = false;
    $("take-photo").hidden = false;
  } catch {
    toast("Camera unavailable. You can choose a photo instead.");
  }
});
function loadImage(source, width, height, provenance = { type: "photo" }) {
  const scale = Math.min(1, 1024 / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
  state.scanImage = {
    dataUrl: canvas.toDataURL("image/jpeg", 0.86),
    width: canvas.width,
    height: canvas.height,
    bitmap: canvas,
    provenance,
  };
  state.scanResult = null;
  state.scanSelected = null;
  $("scan-input-options").open = false;
  $("scan-input-summary").textContent = "Change image or try another example";
  $("scan-workspace").hidden = false;
  $("scan-objects").replaceChildren();
  $("confirm-scan").disabled = true;
  updateLiveControls();
  $("scan-status").textContent =
    provenance.type === "synthetic"
      ? "AI-generated test input ready. Find objects sends it to Muse Spark and SAM 3.1."
      : "Photo ready. Find objects sends this image to Muse Spark and SAM 3.1.";
  if (!state.world.provenance?.objects?.length)
    $("scan-status").textContent +=
      " Building a new table starts with default game rules; your current world is kept as a checkpoint.";
  drawScan();
}
for (const variant of ["a", "b"]) {
  $(`fixture-${variant}`).addEventListener("click", async () => {
    if (state.busy) return;
    try {
      const response = await fetch(
        `/examples/generated-tabletop-${variant}.png`,
      );
      if (!response.ok)
        throw new Error("The synthetic test image could not be loaded.");
      const bitmap = await createImageBitmap(await response.blob());
      loadImage(bitmap, bitmap.width, bitmap.height, {
        type: "synthetic",
        fixture: variant,
        manifest: "/examples/generated-inputs.json",
      });
      bitmap.close();
    } catch (error) {
      toast(error.message);
    }
  });
}
$("replay-capture").addEventListener("click", async () => {
  if (state.busy) return;
  try {
    const project = normalizeProject(
      await api("/examples/tabletop-study.json"),
    );
    restoreProject(project);
    $("scan-dialog").close();
    autosave();
    toast(
      "Replayed actual saved Meta captures of generated inputs. No new API calls.",
    );
  } catch (error) {
    toast(error.message);
  }
});
$("photo-file").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  if (file.size > 30_000_000) return toast("Choose a photo under 30 MB.");
  try {
    const bitmap = await createImageBitmap(file);
    loadImage(bitmap, bitmap.width, bitmap.height);
    bitmap.close();
  } catch {
    toast("Could not read that image.");
  }
});
$("take-photo").addEventListener("click", () => {
  const video = $("camera");
  if (video.videoWidth) {
    loadImage(video, video.videoWidth, video.videoHeight);
    stopCamera();
  }
});
function drawScan() {
  if (!state.scanImage) return;
  const { width, height, bitmap } = state.scanImage;
  const canvas = $("scan-preview");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0);
  $("scan-overlay-options").hidden = !state.scanResult;
  for (const [index, object] of (state.scanResult?.objects ?? []).entries()) {
    const color = {
      source: "#387f9d",
      house: "#658b42",
      bridge: "#ba7d3f",
      obstacle: "#8d8271",
      ignore: "#999999",
    }[object.role];
    if (object.mask && $("scan-show-masks").checked) {
      const m = object.mask;
      ctx.save();
      ctx.translate(m.bounds.left, m.bounds.top);
      ctx.scale(
        (m.bounds.right - m.bounds.left) / m.width,
        (m.bounds.bottom - m.bounds.top) / m.height,
      );
      const path = new Path2D(m.path);
      ctx.fillStyle = color + (state.scanSelected === index ? "88" : "55");
      ctx.fill(path);
      ctx.strokeStyle = color;
      ctx.lineWidth =
        (Math.max(2, width / 400) * m.width) / (m.bounds.right - m.bounds.left);
      ctx.stroke(path);
      ctx.restore();
    }
    const b = object.box;
    if ($("scan-show-boxes").checked) {
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(2, width / 400);
      ctx.setLineDash([width / 160, width / 240]);
      ctx.strokeRect(b.left, b.top, b.right - b.left, b.bottom - b.top);
      ctx.setLineDash([]);
    }
    const radius = Math.max(12, width / 75);
    const x = Math.max(radius, Math.min(width - radius, b.left));
    const y = Math.max(radius, b.top - radius * 0.3);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.font = `600 ${radius}px Arial`;
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(index + 1, x, y);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }
}
$("scan-photo").addEventListener("click", async () => {
  if (!state.scanImage || state.busy) return;
  if (!(await ensureLiveAccess()) || state.busy) return;
  setBusy(true);
  $("scan-status").textContent =
    "Muse Spark is locating objects, then SAM 3.1 will trace them…";
  try {
    const { dataUrl, width, height } = state.scanImage;
    state.scanResult = await api("/api/scan", { dataUrl, width, height });
    $("scan-objects").innerHTML = state.scanResult.objects
      .map(
        (o, i) =>
          `<label class="scan-object-row" data-scan-row="${i}"><span><b>${i + 1}</b>${escape(o.label)}${o.segmented ? " ✓" : ""}</span><select data-scan-index="${i}" aria-label="Role for ${escape(o.label)}">${["source", "house", "bridge", "obstacle", "ignore"].map((role) => `<option${o.role === role ? " selected" : ""}>${role}</option>`).join("")}</select></label>`,
      )
      .join("");
    drawScan();
    $("scan-status").textContent = state.scanResult.objects.length
      ? "Review roles: use exactly one source and at least one house. A check mark means SAM returned a mask."
      : "No suitable objects were detected. Try a clearer photo with separated objects.";
  } catch (error) {
    $("scan-status").textContent = error.message;
  } finally {
    setBusy(false);
    updateLiveControls();
    $("confirm-scan").disabled = !state.scanResult?.objects.length;
    refreshStatus();
  }
});
$("scan-objects").addEventListener("change", (e) => {
  const index = e.target.dataset.scanIndex;
  if (index !== undefined) {
    state.scanResult.objects[Number(index)].role = e.target.value;
    drawScan();
  }
});
for (const id of ["scan-show-masks", "scan-show-boxes"])
  $(id).addEventListener("change", drawScan);
$("scan-objects").addEventListener("focusin", (e) => {
  const row = e.target.closest("[data-scan-row]");
  if (row) {
    state.scanSelected = Number(row.dataset.scanRow);
    drawScan();
  }
});
function worldFromScan() {
  const result = state.scanResult;
  const objects = result.objects.filter((o) => o.role !== "ignore");
  if (
    objects.filter((o) => o.role === "source").length !== 1 ||
    !objects.some((o) => o.role === "house")
  )
    throw new Error("Assign exactly one source and at least one house.");
  if (objects.filter((o) => o.role === "bridge").length > 4)
    throw new Error("Use at most four bridges.");
  const world = state.world.provenance?.objects?.length
    ? structuredClone(state.world)
    : exampleWorld();
  world.name =
    state.scanImage.provenance.type === "synthetic"
      ? "Synthetic tabletop world"
      : "My tabletop world";
  world.houses = [];
  world.bridges = [];
  world.obstacles = [];
  const occupied = new Set();
  const available = (x, y, bridge) =>
    x >= 0 &&
    y >= 0 &&
    x < world.width &&
    y < world.height &&
    !occupied.has(`${x},${y}`) &&
    (bridge
      ? x === world.river.x
      : x < world.river.x || x >= world.river.x + world.river.width);
  const previous = state.world.provenance?.objects ?? [];
  const matched = new Set();
  const positions = [];
  for (const [index, object] of objects.entries()) {
    const nx = (object.box.left + object.box.right) / 2 / result.width;
    const ny = (object.box.top + object.box.bottom) / 2 / result.height;
    const bridge = object.role === "bridge";
    const match = previous
      .filter((p) => p.role === object.role && !matched.has(p.id))
      .map((p) => ({ ...p, distance: Math.hypot(p.nx - nx, p.ny - ny) }))
      .sort((a, b) => a.distance - b.distance)[0];
    const matchedObservation = match && match.distance < 0.25 ? match : null;
    const oldEntity = matchedObservation
      ? [
          state.world.source,
          ...state.world.houses,
          ...state.world.bridges,
          ...state.world.obstacles,
        ].find((o) => o.id === matchedObservation.id)
      : null;
    const placement = stabilizeObservation({
      world,
      role: object.role,
      nx,
      ny,
      previousObservation: matchedObservation,
      previousEntity: oldEntity,
    });
    let { x, y } = placement;
    if (!available(x, y, bridge)) {
      const cells = [];
      for (let cy = 0; cy < world.height; cy++)
        for (let cx = 0; cx < world.width; cx++)
          if (available(cx, cy, bridge))
            cells.push({
              x: cx,
              y: cy,
              distance: Math.abs(cx - x) + Math.abs(cy - y),
            });
      cells.sort((a, b) => a.distance - b.distance);
      if (!cells.length) throw new Error("No free cell for this object.");
      ({ x, y } = cells[0]);
    }
    const id = matchedObservation
      ? matchedObservation.id
      : `photo-${index + 1}-${Date.now().toString(36)}`;
    matched.add(id);
    occupied.add(`${x},${y}`);
    positions.push({
      id,
      role: object.role,
      nx: placement.anchorNx,
      ny: placement.anchorNy,
      observedNx: nx,
      observedNy: ny,
      stabilized: placement.stabilized,
    });
    const entity = { id, label: object.label, x, y };
    if (object.role === "source") world.source = entity;
    else if (object.role === "house") {
      const old = state.world.houses.find((h) => h.id === id);
      world.houses.push({
        ...entity,
        demand: old?.demand ?? 4,
        deadline: old?.deadline ?? 80,
      });
    } else if (bridge) world.bridges.push(entity);
    else world.obstacles.push(entity);
  }
  world.provenance = {
    ...state.scanImage.provenance,
    confirmed: true,
    objects: positions,
    models: result.models,
    note: "Image-relative positions snapped to a fixed grid; bridge anchors mapped to the river.",
  };
  return validateWorld(world);
}
$("confirm-scan").addEventListener("click", () => {
  try {
    const world = worldFromScan();
    state.selected = null;
    const rescan = Boolean(state.world.provenance?.objects?.length);
    if (rescan)
      previewWorld(world, {
        kind: "capture",
        label: "Confirmed rescan of the table",
        photo: state.scanImage.dataUrl,
      });
    else commitWorld(world, { photo: state.scanImage.dataUrl });
    $("scan-dialog").close();
    toast(
      rescan
        ? "Rescan ready in B. Review the changes before applying."
        : "Your world is ready. Review the grid placements, then run a playtest.",
    );
  } catch (error) {
    toast(error.message);
  }
});

let previousTime = 0;
let creatorBestId = null;
function creatorStep(step) {
  if (state.busy || !state.creatorStudy) return;
  state.playing = false;
  state.receiptCourier = null;
  const captions = {
    table:
      "One generated tabletop, processed by Muse Spark and SAM. Review its fixed-grid placements. A has 20/24 on time, 22 waiting turns, and one home gets zero on-time deliveries.",
    brief:
      "The creator's confirmed brief: at least 20/24 on time, at least 3 at EVERY home, and no more than 10 waiting turns. One permitted edit; the same workers, deadlines and schedule.",
    counterexample:
      "Moving the lower stick reduces waiting 22 → 10, but transfers four late units to another home. Total on-time remains 20/24. This rescan fails the per-home floor.",
    repair:
      "Recorded Meta playtest: balanced dispatch gives 20/24 on time, 7 waiting turns and at least 3 on time at every home. Four late units remain; three previously fully served homes each give up one on-time unit.",
    stress:
      "Shift the lower bridge by one cell in both worlds: the balanced design fails the waiting cap in one direction and the on-time floor in the other. Passing the nominal brief is not a guarantee outside it.",
  };
  if (step === "table" || step === "brief") {
    state.candidate = null;
    state.comparing = false;
    state.soloCandidate = false;
    state.tick = 80;
    $("verdict").hidden = true;
    render();
  } else
    selectTrial(
      step === "counterexample"
        ? "rescan-counterexample"
        : (creatorBestId ??
            state.trials.find((t) => t.patch?.dispatch === "balanced")?.id),
    );
  $("creator-caption").textContent = captions[step];
  document
    .querySelectorAll("[data-creator-step]")
    .forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.creatorStep === step),
      ),
    );
  if (step === "counterexample" || step === "repair") $("receipts-tab").click();
  if (step === "brief") $("brief-details").open = true;
  if (step === "stress") {
    document.querySelector('[data-tab="stress"]').click();
    $("stress-axis").value = "bridge-position";
    $("stress-axis").dispatchEvent(new Event("change"));
    $("stress-bridge").value =
      [...state.world.bridges].sort((a, b) => b.y - a.y)[0]?.id ?? "";
    $("run-stress").click();
  }
  autosave();
}
$("open-creator-study").addEventListener("click", async () => {
  if (state.busy) return;
  setBusy(true);
  try {
    const project = normalizeProject(
      await api("/examples/creator-brief-project.json"),
    );
    setBusy(false);
    restoreProject(project);
    $("brief-instruction").value = project.runSummary?.goal ?? "";
    creatorBestId = project.selectedTrialId;
    state.creatorStudy = true;
    creatorStep("table");
    toast(
      "Recorded Meta creator study loaded. Every result is recomputed; no new API calls.",
    );
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(false);
  }
});
document
  .querySelectorAll("[data-creator-step]")
  .forEach((button) =>
    button.addEventListener("click", () =>
      creatorStep(button.dataset.creatorStep),
    ),
  );
designLab = setupDesignLab({
  getState: () => state,
  commit: commitWorld,
  api,
  ensureLiveAccess,
  setBusy,
  refreshStatus,
  notify: toast,
  replay: ({ houseId, tick, courierId, side }) => {
    state.selected = houseId;
    state.tick = tick;
    state.playing = false;
    state.receiptCourier = { id: courierId, side };
    state.comparing = Boolean(state.candidate);
    state.soloCandidate = false;
    $("receipt-replay-note").textContent =
      `Replaying ${side.toUpperCase()} at turn ${tick}: ${courierId}, home ${houseId}. Both worlds share this replay turn.`;
    render();
  },
});
let lastAmbientDraw = 0;
function animate(time) {
  ambientClock = time / 1000;
  if (state.playing && previousTime) {
    const horizon = Math.max(
      state.world.rules.horizon,
      state.candidate?.world.rules.horizon ?? 0,
    );
    state.tick = Math.min(
      state.tick + (Math.min(time - previousTime, 80) * state.speed) / 140,
      horizon,
    );
    if (state.tick >= horizon) {
      state.playing = false;
      autosave();
    }
    draw();
  } else if (
    !clipRecording &&
    !document.hidden &&
    time - lastAmbientDraw > 65 &&
    !matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    lastAmbientDraw = time;
    draw();
  }
  previousTime = time;
  requestAnimationFrame(animate);
}
new ResizeObserver(() => draw()).observe($("canvas-section"));
if (restoredProject) restoreProject(restoredProject);
else {
  $("project-name").value = state.name;
  state.playing = !matchMedia("(prefers-reduced-motion: reduce)").matches;
  render();
}
document.querySelector("main").removeAttribute("inert");
document.querySelector("main").setAttribute("aria-busy", "false");
$("budget-button").disabled = false;
autosave();
refreshStatus();
requestAnimationFrame(animate);
