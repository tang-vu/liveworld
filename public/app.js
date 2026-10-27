import {
  exampleWorld,
  validateWorld,
  applyPatch,
  objectAt,
} from "/shared/world.js";
import { simulate, evidence, compareRuns } from "/shared/engine.js";
import { drawWorld, drawTablePreview, cellFromPointer } from "./render.js";

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
};
try {
  const saved = localStorage.getItem("liveworld.world.v1");
  if (saved) state.world = validateWorld(JSON.parse(saved));
} catch {
  /* An invalid saved layout is replaced by the example. */
}
state.run = simulate(state.world);

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
      state.status.configured && !b.blocked,
    );
    $("connection").replaceChildren(
      Object.assign(document.createElement("i")),
      document.createTextNode(
        b.blocked
          ? "API paused"
          : state.status.configured
            ? "Meta connected"
            : "Local mode",
      ),
    );
    $("budget-details").innerHTML =
      `<dl><dt>Recorded API cost estimate</dt><dd>$${b.spentUsd.toFixed(5)}</dd><dt>Held for pending calls</dt><dd>$${b.heldUsd.toFixed(4)}</dd><dt>Current phase cap</dt><dd>$${b.phaseBudgetUsd}</dd><dt>Project budget</dt><dd>$${b.totalBudgetUsd}</dd><dt>Protected reserve</dt><dd>$${b.reserveUsd}</dd><dt>Requests recorded</dt><dd>${b.requests}</dd></dl><p>${escape(b.scope)}</p><p>Token costs use published Standard rates without cache discounts. Unknown charges are held conservatively. The app pauses if a charge cannot be confirmed.</p>${b.blocked ? `<p><strong>${escape(b.blocked)}</strong></p>` : ""}`;
    document.querySelector(".api-note").textContent =
      `Uses Meta API · up to 6 model turns · $${b.phaseBudgetUsd} phase cap`;
  } catch {
    $("connection").textContent = "Backend unavailable";
  }
}
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
  ])
    $(id).disabled = busy;
  $("scan-photo").disabled = busy || !state.scanImage;
  $("confirm-scan").disabled = busy || !state.scanResult?.objects.length;
  $("playtest").textContent = busy
    ? "Testing the world…"
    : "Find & test a fix ↗";
}
function commitWorld(world) {
  if (state.busy) return;
  state.world = validateWorld(world);
  state.run = simulate(state.world);
  state.candidate = null;
  state.trials = [];
  state.result = null;
  state.comparing = false;
  state.playing = false;
  state.tick = 0;
  try {
    localStorage.setItem("liveworld.world.v1", JSON.stringify(state.world));
  } catch {
    /* Saving is optional. */
  }
  $("verdict").hidden = true;
  $("agent-activity").hidden = true;
  render();
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
      `/ ${a.demand}`,
      b
        ? {
            text: `A: ${a.onTime} → B: ${b.onTime}`,
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
            text: `${a.lateUnits - b.lateUnits} fewer than original`,
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
    state.world.provenance?.type === "photo" ? "YOUR TABLE" : "EXAMPLE";
  $("courier-count").textContent = `${state.world.rules.couriers} couriers`;
  $("horizon").textContent = ` / ${state.world.rules.horizon}`;
  $("timeline").max = state.world.rules.horizon;
  $("result-caption").textContent =
    `${state.candidate ? "B" : "A"} · Results across ${state.world.rules.horizon} turns`;
  $("view-compare").disabled = !state.candidate;
  $("view-compare").classList.toggle("active", state.comparing);
  $("view-world").classList.toggle("active", !state.comparing);
  $("candidate-pane").hidden = !state.comparing;
  $("canvas-section").classList.toggle("comparing", state.comparing);
  $("candidate-label").textContent = state.candidate?.label.slice(0, 36) ?? "";
  $("table-preview").hidden = Boolean($("table-photo").getAttribute("src"));
  $("table-photo").hidden = !Boolean($("table-photo").getAttribute("src"));
  $("preview-caption").textContent =
    state.world.provenance?.type === "photo"
      ? $("table-photo").hidden
        ? "Saved layout · photo not stored"
        : "Your table · confirmed roles"
      : "A little valley, on your desk";
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
  state.tick = Math.min(state.tick, state.world.rules.horizon);
  render();
  if (state.result)
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
  $("table-photo").removeAttribute("src");
  state.selected = null;
  commitWorld(exampleWorld($("scenario").value));
});
$("reset-world").addEventListener("click", () => {
  $("table-photo").removeAttribute("src");
  state.selected = null;
  commitWorld(exampleWorld($("scenario").value));
});
$("play").addEventListener("click", () => {
  if (state.tick >= state.world.rules.horizon) state.tick = 0;
  state.playing = !state.playing;
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
    try {
      const world = applyPatch(state.world, patch).world;
      const run = simulate(world);
      trials.push({
        id: `local-${trials.length + 1}`,
        label,
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
  toast(`Checked ${trials.length} local changes. No API credit used.`);
});

$("playtest").addEventListener("click", async () => {
  if (state.busy) return;
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
          state.trials = event.result.experiments;
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
    refreshStatus();
  }
});

$("export").addEventListener("click", () => {
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
  const blob = new Blob([JSON.stringify(artifact, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "liveworld-experiment.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("Experiment exported with its inputs and evidence.");
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
    state.trials = result.experiments;
    $("table-photo").removeAttribute("src");
    selectTrial(result.best.id);
    state.tick = state.candidate.run.metrics.completedAt ?? 94;
    draw();
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
function loadImage(source, width, height) {
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
  };
  state.scanResult = null;
  $("scan-workspace").hidden = false;
  $("scan-objects").replaceChildren();
  $("confirm-scan").disabled = true;
  $("scan-photo").disabled = false;
  $("scan-status").textContent =
    "Photo ready. Find objects sends this image to Muse Spark and SAM 3.1.";
  drawScan();
}
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
  const world = exampleWorld();
  world.name = "My tabletop world";
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
    let x = bridge
      ? world.river.x
      : Math.min(world.width - 1, Math.floor(nx * world.width));
    let y = Math.min(world.height - 1, Math.floor(ny * world.height));
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
    const match = previous
      .filter((p) => p.role === object.role && !matched.has(p.id))
      .map((p) => ({ ...p, distance: Math.hypot(p.nx - nx, p.ny - ny) }))
      .sort((a, b) => a.distance - b.distance)[0];
    const id =
      match && match.distance < 0.25
        ? match.id
        : `photo-${index + 1}-${Date.now().toString(36)}`;
    matched.add(id);
    occupied.add(`${x},${y}`);
    positions.push({ id, role: object.role, nx, ny });
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
    type: "photo",
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
    $("table-photo").src = state.scanImage.dataUrl;
    $("preview-caption").textContent = "Your table · confirmed roles";
    state.selected = null;
    commitWorld(world);
    $("scan-dialog").close();
    toast(
      "Your world is ready. Review the grid placements, then run a playtest.",
    );
  } catch (error) {
    toast(error.message);
  }
});

let previousTime = 0;
function animate(time) {
  if (state.playing && time - previousTime > 140 / state.speed) {
    state.tick = Math.min(state.tick + 1, state.world.rules.horizon);
    if (state.tick >= state.world.rules.horizon) state.playing = false;
    draw();
    previousTime = time;
  }
  requestAnimationFrame(animate);
}
new ResizeObserver(() => draw()).observe($("canvas-section"));
render();
refreshStatus();
requestAnimationFrame(animate);
