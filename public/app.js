import {
  exampleWorld,
  validateWorld,
  applyPatch,
  objectAt,
} from "/shared/world.js";
import { simulate, evidence, compareRuns } from "/shared/engine.js";
import { drawWorld, drawTablePreview, cellFromPointer } from "./render.js";
import { stabilizeObservation } from "/shared/tracking.js";
import {
  PROJECT_FORMAT,
  PROJECT_LIMIT_BYTES,
  normalizeProject,
  makeCheckpoint,
  verifyTrial,
  describeWorldChanges,
} from "/shared/project.js";
import { applyRuleChange, ruleChangeFromForm } from "/shared/rules.js";
import { loadAutosave, saveAutosave } from "./storage.js";
import { experimentReport } from "./report.js";

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
  trials: [],
  candidate: null,
  result: null,
  status: null,
  scanImage: null,
  scanResult: null,
  camera: null,
  name: "My LiveWorld",
  photo: null,
  checkpoints: [],
};
let restoredProject = null;
try {
  const saved = await loadAutosave();
  if (saved) {
    restoredProject = normalizeProject(saved);
    Object.assign(state, {
      world: restoredProject.world,
      photo: restoredProject.photo,
      name: restoredProject.name,
      checkpoints: restoredProject.checkpoints,
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
  Object.assign(state, {
    world: project.world,
    photo: project.photo,
    name: project.name,
    checkpoints: project.checkpoints,
    trials: project.trials,
    tick: project.tick,
    selected: null,
    candidate: null,
    comparing: false,
    playing: false,
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
    document.querySelector(".api-note").textContent =
      `Uses Meta API · up to 6 model turns · $${b.phaseBudgetUsd} phase cap`;
  } catch {
    $("connection").textContent = "Backend unavailable";
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
    "save-checkpoint",
    "compare-checkpoint",
    "edit-rules",
    "preview-rules",
    "compile-rules",
    "apply-candidate",
    "project-name",
    "checkpoints",
  ])
    $(id).disabled = busy;
  $("scan-photo").disabled = busy || !state.scanImage;
  $("confirm-scan").disabled = busy || !state.scanResult?.objects.length;
  $("compare-checkpoint").disabled = busy || !state.checkpoints.length;
  $("playtest").textContent = busy
    ? "Testing the world…"
    : "Find & test a fix ↗";
}
function commitWorld(world, { photo = state.photo, remember = true } = {}) {
  if (state.busy) return;
  const validated = validateWorld(world);
  if (remember) checkpoint("Before · " + state.world.name);
  state.world = validated;
  state.photo = photo;
  state.run = simulate(state.world);
  state.candidate = null;
  state.trials = [];
  state.result = null;
  state.comparing = false;
  state.playing = false;
  state.tick = 0;
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
      `<strong>${escape(selected.label ?? selected.id)}</strong><br>Cell ${selected.x + 1}, ${selected.y + 1}${selected.demand ? `<br>${selected.demand} water · deadline turn ${selected.deadline}` : ""}<br>Drag on the world to move.`;
}
function renderMetrics() {
  const a = state.run.metrics;
  const b = state.candidate?.run.metrics;
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
      "Units missing their deadline",
      b ? b.lateUnits : a.lateUnits,
      "units",
      b
        ? {
            text:
              a.lateUnits === b.lateUnits
                ? "Same as original"
                : `${Math.abs(a.lateUnits - b.lateUnits)} ${a.lateUnits > b.lateUnits ? "fewer" : "more"} than original`,
            good: b.lateUnits < a.lateUnits,
            bad: b.lateUnits > a.lateUnits,
          }
        : null,
      (b ?? a).lateUnits > 0,
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
      return `<button class="trial-card${state.candidate?.id === t.id ? " selected" : ""}" data-trial="${escape(t.id)}"><span class="trial-top"><span>${escape(t.id.toUpperCase())}</span><span class="trial-badge${comparison.improved || comparison.goalMet ? "" : " failed"}">${label}</span></span><strong>${escape(t.label)}</strong><span class="trial-stats"><span>${t.evidence.metrics.onTime}/${t.evidence.metrics.demand} on time</span><span>${t.evidence.metrics.waitTicks} waiting turns</span></span></button>`;
    })
    .join("");
}
function render() {
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
  $("view-compare").classList.toggle("active", state.comparing);
  $("view-world").classList.toggle("active", !state.comparing);
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
  if (state.candidate) {
    $("change-title").textContent =
      `${state.candidate.kind === "rules" ? "Designer rule preview" : "Changes from A to B"}${state.candidate.source === "imported" ? " · imported, recomputed" : ""}`;
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
  requestAnimationFrame(draw);
}
function draw() {
  drawWorld(
    $("world-canvas"),
    state.world,
    state.run,
    state.tick,
    state.selected,
  );
  if (state.comparing && state.candidate)
    drawWorld(
      $("candidate-canvas"),
      state.candidate.world,
      state.candidate.run,
      state.tick,
      state.selected,
      true,
    );
  if (!$("table-preview").hidden)
    drawTablePreview($("table-preview"), state.world);
  $("timeline").value = Math.round(state.tick);
  $("turn").textContent = Math.round(state.tick);
  $("play").textContent = state.playing ? "Ⅱ" : "▶";
}
function selectTrial(id) {
  const t = state.trials.find((t) => t.id === id);
  if (!t) return;
  state.candidate = { ...t, run: simulate(t.world) };
  state.comparing = true;
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
        `${t.evidence.metrics.onTime}/${t.evidence.metrics.demand} water units on time in B. Review the changes before applying. ${t.source === "imported" ? "Imported inputs; results recomputed locally." : t.kind === "rules" && t.source === "meta" ? "Meta translated the instruction; the simulator checked the outcome." : "Computed locally from the confirmed layout and rules."}`,
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
  const text =
    result.verdict === "goal_met"
      ? "Every requested water unit arrived by its deadline with the same resources."
      : result.verdict === "improved"
        ? "This trial improved the measured result. Some deadlines are still missed."
        : result.verdict === "already_met"
          ? "All water deliveries already arrive on time."
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
  render();
});
$("view-compare").addEventListener("click", () => {
  if (state.candidate) {
    state.comparing = true;
    render();
  }
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
  }),
);
$("budget-button").addEventListener("click", () => {
  refreshStatus();
  $("budget-dialog").showModal();
});
$("close-budget").addEventListener("click", () => $("budget-dialog").close());

let dragged = null;
$("world-canvas").addEventListener("pointerdown", (e) => {
  if (state.busy) return;
  const cell = cellFromPointer($("world-canvas"), state.world, e);
  const object = objectAt(state.world, cell.x, cell.y);
  if (object) {
    state.selected = object.id;
    dragged = { id: object.id, startX: e.clientX, startY: e.clientY };
    $("world-canvas").setPointerCapture(e.pointerId);
    renderObjects();
    draw();
  }
});
$("world-canvas").addEventListener("pointerup", (e) => {
  if (!dragged) return;
  const drag = dragged;
  dragged = null;
  if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 4) return;
  const cell = cellFromPointer($("world-canvas"), state.world, e);
  const world = structuredClone(state.world);
  const object = [
    world.source,
    ...world.houses,
    ...world.bridges,
    ...world.obstacles,
  ].find((o) => o.id === drag.id);
  if (world.bridges.includes(object)) object.y = cell.y;
  else {
    object.x = cell.x;
    object.y = cell.y;
  }
  try {
    commitWorld(world);
    toast("Layout changed. A fresh replay is ready.");
  } catch (error) {
    toast(error.message);
  }
});
$("world-canvas").addEventListener("pointercancel", () => {
  dragged = null;
});

$("local-sweep").addEventListener("click", () => {
  if (state.busy) return;
  const trials = [];
  const patches = ["balanced", "deadline"].map((dispatch) => ({
    patch: { dispatch },
    label: `Use ${policyLabel[dispatch].toLowerCase()}`,
  }));
  for (const bridge of state.world.bridges)
    for (let y = 0; y < state.world.height; y++)
      if (y !== bridge.y)
        patches.push({
          patch: { bridgeMoves: [{ id: bridge.id, y }] },
          label: `Move ${bridge.id.replace("bridge-", "")} bridge to row ${y + 1}`,
        });
  for (const { patch, label } of patches) {
    if (trials.length >= 32) break;
    try {
      const world = applyPatch(state.world, patch).world;
      const run = simulate(world);
      trials.push({
        id: `local-${trials.length + 1}`,
        label,
        kind: "local",
        source: "local-sweep",
        patch,
        world,
        comparison: compareRuns(state.run, run),
        evidence: evidence(run),
      });
    } catch {
      /* Overlapping bridge positions are invalid candidates. */
    }
  }
  trials.sort(
    (a, b) =>
      a.evidence.metrics.lateUnits - b.evidence.metrics.lateUnits ||
      a.evidence.metrics.waitTicks - b.evidence.metrics.waitTicks,
  );
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
        : "no_improvement",
    experiments: trials,
    verification: {
      goalMet: Boolean(best?.comparison.goalMet),
      testsRun: trials.length,
      seed: state.world.seed,
    },
  };
  if (best) selectTrial(best.id);
  else render();
  displayVerdict(state.result, true);
  $("agent-activity").hidden = true;
  autosave();
  toast(
    `Checked ${trials.length} local changes${trials.length === 32 ? " (32-trial limit)" : ""}. No API credit used.`,
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
          state.trials = event.result.experiments.map((t) => ({
            ...t,
            kind: "agent",
            source: "meta",
          }));
          if (event.result.best) selectTrial(event.result.best.id);
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
});
$("apply-candidate").addEventListener("click", () => {
  if (!state.candidate || state.busy) return;
  const trial = state.candidate;
  commitWorld(trial.world, { photo: trial.photo ?? state.photo });
  toast("B is now your working world. A is saved as a checkpoint.");
});

$("edit-rules").addEventListener("click", () => {
  for (const [key, value] of Object.entries(state.world.rules))
    $("rule-" + key).value = value;
  $("household-fields").innerHTML = state.world.houses
    .map(
      (h) =>
        `<div class="household-rule-row"><span>${escape(h.label ?? h.id)}</span><label>Water demand<input data-house="${escape(h.id)}" data-field="demand" aria-label="Water demand for ${escape(h.label ?? h.id)}" type="number" min="1" max="12" value="${h.demand}" /></label><label>Deadline turn<input data-house="${escape(h.id)}" data-field="deadline" aria-label="Deadline for ${escape(h.label ?? h.id)}" type="number" min="1" max="240" value="${h.deadline}" /></label></div>`,
    )
    .join("");
  $("rule-status").textContent = "Manual previews use no API credit.";
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

$("recorded-example").addEventListener("click", async () => {
  if (state.busy) return;
  try {
    const result = await api("/examples/valley-playtest.json");
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
    state.result = result;
    state.trials = result.experiments.map((t) => ({
      ...t,
      kind: "agent",
      source: "recorded-meta-run",
    }));
    state.photo = null;
    selectTrial(result.best.id);
    state.tick = state.candidate.run.metrics.completedAt ?? 94;
    draw();
    autosave();
    $("agent-activity").hidden = true;
    toast(
      "Loaded an actual recorded Meta run. All displayed measurements were recomputed locally.",
    );
  } catch (error) {
    toast(error.message);
  }
});

// Camera capture is user initiated. Photos stay in the browser until Find objects.
$("capture").addEventListener("click", () => $("scan-dialog").showModal());
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
  $("scan-workspace").hidden = false;
  $("scan-objects").replaceChildren();
  $("confirm-scan").disabled = true;
  $("scan-photo").disabled = false;
  $("scan-status").textContent =
    provenance.type === "synthetic"
      ? "AI-generated test input ready. Find objects sends it to Muse Spark and SAM 3.1."
      : "Photo ready. Find objects sends this image to Muse Spark and SAM 3.1.";
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
  for (const object of state.scanResult?.objects ?? []) {
    const color = {
      source: "#387f9d",
      house: "#658b42",
      bridge: "#ba7d3f",
      obstacle: "#8d8271",
      ignore: "#999999",
    }[object.role];
    if (object.mask) {
      const m = object.mask;
      ctx.save();
      ctx.translate(m.bounds.left, m.bounds.top);
      ctx.scale(
        (m.bounds.right - m.bounds.left) / m.width,
        (m.bounds.bottom - m.bounds.top) / m.height,
      );
      ctx.fillStyle = color + "55";
      ctx.fill(new Path2D(m.path));
      ctx.restore();
    }
    const b = object.box;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, width / 300);
    ctx.strokeRect(b.left, b.top, b.right - b.left, b.bottom - b.top);
    ctx.font = `${Math.max(12, width / 48)}px Arial`;
    ctx.fillStyle = color;
    ctx.fillText(
      `${object.label} · ${object.role}`,
      b.left,
      Math.max(18, b.top - 6),
    );
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
          `<label class="scan-object-row"><span>${escape(o.label)}${o.segmented ? " ✓" : ""}</span><select data-scan-index="${i}" aria-label="Role for ${escape(o.label)}">${["source", "house", "bridge", "obstacle", "ignore"].map((role) => `<option${o.role === role ? " selected" : ""}>${role}</option>`).join("")}</select></label>`,
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
    $("scan-photo").disabled = !state.scanImage;
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
  const world = structuredClone(state.world);
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
function animate(time) {
  if (state.playing && time - previousTime > 140 / state.speed) {
    const horizon = Math.max(
      state.world.rules.horizon,
      state.candidate?.world.rules.horizon ?? 0,
    );
    state.tick = Math.min(state.tick + 1, horizon);
    if (state.tick >= horizon) {
      state.playing = false;
      autosave();
    }
    draw();
    previousTime = time;
  }
  requestAnimationFrame(animate);
}
new ResizeObserver(() => draw()).observe($("canvas-section"));
if (restoredProject) restoreProject(restoredProject);
else {
  $("project-name").value = state.name;
  render();
}
document.querySelector("main").removeAttribute("inert");
document.querySelector("main").setAttribute("aria-busy", "false");
$("budget-button").disabled = false;
autosave();
refreshStatus();
requestAnimationFrame(animate);
