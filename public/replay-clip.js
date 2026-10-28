import { drawWorld } from "./diorama.js";
import { simulate } from "/shared/engine.js";
import { normalizeProject, describeWorldChanges } from "/shared/project.js";
import { describeEvent } from "/shared/mechanics.js";

const W = 1920,
  H = 1080;
const font = (size, weight = 400) =>
  `${weight} ${size}px "Segoe UI",Arial,sans-serif`;
function text(ctx, value, x, y, size = 24, color = "#244b38", weight = 400) {
  ctx.fillStyle = color;
  ctx.font = font(size, weight);
  ctx.textAlign = "left";
  ctx.fillText(value, x, y);
}
function lines(
  ctx,
  value,
  x,
  y,
  maxWidth,
  size = 24,
  maxLines = 2,
  color = "#566a59",
) {
  ctx.font = font(size);
  const words = String(value).split(/\s+/);
  let line = "",
    row = 0;
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      text(ctx, line, x, y + row * (size + 9), size, color);
      row++;
      line = word;
      if (row >= maxLines) return;
    } else line = next;
  }
  if (line && row < maxLines)
    text(ctx, line, x, y + row * (size + 9), size, color);
}
function frameAt(run, tick) {
  return run.frames[Math.min(Math.floor(tick), run.frames.length - 1)];
}
function significant(run, tick) {
  return run.events.findLast(
    (e) =>
      e.tick <= tick &&
      [
        "deadline_missed",
        "bridge_closed",
        "bridge_opened",
        "production_paused",
        "production_resumed",
        "unreachable",
        "all_delivered",
        "reroute",
      ].includes(e.type),
  );
}
export function replayFormat() {
  return typeof VideoEncoder !== "undefined" &&
    typeof VideoFrame !== "undefined"
    ? "video/webm"
    : null;
}
// The recording uses the same renderer and recomputed simulation as the studio.
// It never captures the desktop, calls a model, or trusts imported result flags.
export function createReplayClip(
  canvas,
  input,
  settings,
  onProgress = () => {},
) {
  const project = normalizeProject(structuredClone(input));
  const original = { world: project.world, run: simulate(project.world) };
  const trial = project.trials.find((t) => t.id === project.selectedTrialId);
  const proposed = trial
    ? { world: trial.world, run: simulate(trial.world) }
    : null;
  const mode = settings.mode;
  if (
    !["original", "proposed", "compare"].includes(mode) ||
    (mode !== "original" && !proposed)
  )
    throw new Error("Select an available world view.");
  const duration = Number(settings.duration),
    start = Number(settings.start),
    end = Number(settings.end);
  const horizon = Math.max(
    original.world.rules.horizon,
    proposed?.world.rules.horizon ?? 0,
  );
  if (
    ![12, 20, 30].includes(duration) ||
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end <= start ||
    end > horizon
  )
    throw new Error(
      `Choose a turn range within 0–${horizon} and a supported clip duration.`,
    );
  const mimeType = replayFormat();
  if (!mimeType)
    throw new Error(
      "This browser cannot record a replay. Download the project or HTML evidence instead.",
    );
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  const boards = [
    document.createElement("canvas"),
    document.createElement("canvas"),
  ];
  const comparison = mode === "compare";
  const shown = comparison
    ? [original, proposed]
    : [mode === "proposed" ? proposed : original];
  const changes = proposed
    ? describeWorldChanges(original.world, proposed.world)
    : [];
  const changedIds = proposed
    ? proposed.world.bridges
        .filter((b) =>
          original.world.bridges.some((a) => a.id === b.id && a.y !== b.y),
        )
        .map((b) => b.id)
    : [];
  const provenance = project.runSummary?.source;
  const source = ["recorded-meta-run", "recorded-meta-design"].includes(
    provenance,
  )
    ? "RECORDED META STUDY · RECOMPUTED"
    : provenance === "imported" || trial?.source === "imported"
      ? "IMPORTED EXPERIMENT · RECOMPUTED"
      : provenance === "meta"
        ? "SAVED META EXPERIMENT · RECOMPUTED"
        : "SAVED EXPERIMENT · ENGINE REPLAY";
  function paint(tick) {
    ctx.fillStyle = "#f4f2e9";
    ctx.fillRect(0, 0, W, H);
    text(ctx, "LiveWorld.", 58, 70, 40, "#173d2c", 700);
    text(ctx, source, 1160, 61, 19, "#607464", 600);
    const title = project.name || project.world.name;
    text(
      ctx,
      title.length > 54 ? title.slice(0, 51) + "…" : title,
      58,
      139,
      44,
      "#193d2d",
      650,
    );
    text(
      ctx,
      `TURN ${String(Math.floor(tick)).padStart(3, "0")} / ${horizon}`,
      1570,
      134,
      25,
      "#365c45",
      600,
    );
    for (let i = 0; i < shown.length; i++) {
      const item = shown[i],
        isB = (comparison && i === 1) || mode === "proposed";
      const x = comparison ? 52 + i * 934 : 52,
        y = 214,
        width = comparison ? 882 : 1816,
        height = 634;
      text(
        ctx,
        isB ? "B · PROPOSED WORLD" : "A · ORIGINAL WORLD",
        x,
        193,
        22,
        isB ? "#187b69" : "#536945",
        650,
      );
      drawWorld(boards[i], item.world, item.run, tick, null, isB, {
        width,
        height,
        zoom: 1,
        pixelRatio: 1,
        replayClip: true,
        changedIds: isB ? changedIds : [],
        originBridges: isB ? original.world.bridges : [],
      });
      ctx.drawImage(boards[i], x, y, width, height);
      const f = frameAt(item.run, tick),
        m = item.run.metrics;
      text(
        ctx,
        `${m.onTime}/${m.demand}`,
        x,
        911,
        57,
        m.allOnTime ? "#177c65" : "#a56b31",
        700,
      );
      text(ctx, "on time · full run", x + 175, 907, 22, "#516750");
      text(
        ctx,
        `At this turn: ${f.delivered}/${m.demand} delivered`,
        x,
        950,
        23,
        "#2d543b",
        500,
      );
      const active = (item.world.events ?? []).filter(
        (e) => tick >= e.from && tick <= e.to,
      );
      const event = significant(item.run, tick);
      const caption = active.length
        ? active.map((e) => describeEvent(e, item.world)).join(" · ")
        : event
          ? `T${event.tick}: ${event.message}`
          : `${m.waitTicks} total bridge waiting turns`;
      lines(ctx, caption, x, 987, width - 12, 21, 2);
    }
    // Render a compact change summary while keeping observations separate from claims.
    ctx.fillStyle = "#d5dfcf";
    ctx.fillRect(52, 1028, 1816, 1);
    const note =
      proposed && mode !== "original"
        ? changes.join(" · ")
        : "Deterministic logistics prototype · same saved inputs · no new model calls";
    lines(ctx, note, 58, 1061, 1560, 19, 1, "#5a6b58");
    text(
      ctx,
      project.world.provenance?.type === "synthetic"
        ? "SYNTHETIC INPUT"
        : "SIMULATION REPLAY",
      1650,
      1061,
      16,
      "#6c7c68",
      600,
    );
  }
  paint(start);
  let cancelled = false;
  const done = (async () => {
    // Encode every simulated frame at an explicit timestamp. Background-tab
    // throttling can delay export, but cannot reduce the file's frame cadence.
    const { Output, WebMOutputFormat, BufferTarget, CanvasSource, Quality } =
      await import("./vendor/mediabunny.js");
    const target = new BufferTarget();
    const output = new Output({ format: new WebMOutputFormat(), target });
    const source = new CanvasSource(canvas, {
      codec: "vp9",
      quality: new Quality({ bitrate: 8_000_000 }),
      latencyMode: "realtime",
    });
    output.addVideoTrack(source, { frameRate: 30 });
    const frameCount = duration * 30;
    try {
      await output.start();
      for (let i = 0; i < frameCount; i++) {
        if (cancelled) throw new Error("Replay export cancelled.");
        const progress = Math.min(1, i / 30 / Math.max(1, duration - 1.2));
        paint(start + (end - start) * progress);
        await source.add(i / 30, 1 / 30, { keyFrame: i % 90 === 0 });
        onProgress((i + 1) / frameCount);
        if (i % 15 === 14)
          await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (cancelled) throw new Error("Replay export cancelled.");
      source.close();
      await output.finalize();
      return {
        blob: new Blob([target.buffer], { type: "video/webm" }),
        extension: "webm",
        project,
        metadata: {
          format: "liveworld-replay-clip-v1",
          width: W,
          height: H,
          fps: 30,
          frameCount,
          durationSeconds: duration,
          start,
          end,
          mode,
          source: provenance,
          original: original.run.metrics,
          proposed: proposed?.run.metrics ?? null,
        },
      };
    } catch (error) {
      if (output.state !== "finalized" && output.state !== "canceled")
        await output.cancel();
      throw error;
    }
  })();
  return {
    done,
    cancel() {
      cancelled = true;
    },
  };
}
