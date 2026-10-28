import {
  worldGeometry,
  projectPoint,
  unprojectPoint,
} from "/shared/projection.js";
import {
  drawBackdrop,
  drawStrata,
  drawRiver,
  sceneryFor,
  drawTree,
} from "./diorama-detail.js";
import { drawDiorama3D } from "./diorama-three.js";

export function boardGeometry(canvas, world, options = {}) {
  const width = options.width ?? (canvas.clientWidth || 900);
  const requested = options.zoom ?? canvas.dataset.zoom ?? "auto";
  const zoom =
    requested === "auto"
      ? width < 450
        ? 1.15
        : 1
      : Math.max(1, Math.min(2, Number(requested) || 1));
  return worldGeometry(
    width,
    options.height ?? (canvas.clientHeight || 500),
    world,
    zoom,
  );
}
export function cellFromPointer(canvas, world, event) {
  const r = canvas.getBoundingClientRect();
  const p = unprojectPoint(
    boardGeometry(canvas, world),
    event.clientX - r.left,
    event.clientY - r.top,
  );
  return { x: Math.floor(p.x), y: Math.floor(p.y) };
}
export function pickObject(canvas, world, event) {
  const r = canvas.getBoundingClientRect();
  const g = boardGeometry(canvas, world);
  const x = event.clientX - r.left,
    y = event.clientY - r.top;
  const cell = cellFromPointer(canvas, world, event);
  const bridge = world.bridges.find(
    (b) =>
      b.y === cell.y &&
      cell.x >= world.river.x &&
      cell.x < world.river.x + world.river.width,
  );
  if (bridge) return bridge;
  const objects = [world.source, ...world.houses, ...world.obstacles].sort(
    (a, b) => b.x + b.y - a.x - a.y,
  );
  return (
    objects.find((o) => {
      const p = projectPoint(g, o.x + 0.5, o.y + 0.5);
      const isRock = world.obstacles.includes(o);
      return (
        Math.abs(p.x - x) < g.cell * 0.75 &&
        y > p.y - g.cell * (isRock ? 0.65 : 1.6) &&
        y < p.y + g.cell * 0.45
      );
    }) ?? null
  );
}
function poly(ctx, points, fill, stroke) {
  ctx.beginPath();
  points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 0.7;
    ctx.stroke();
  }
}
function round(ctx, x, y, w, h, r, fill, stroke) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}
function line(ctx, points, color, width = 1) {
  ctx.beginPath();
  points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();
}
function ellipse(ctx, x, y, rx, ry, color) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}
function tag(
  ctx,
  x,
  y,
  text,
  { fill = "#fffcf0", color = "#34483b", border = "#d9ddc8", size = 12 } = {},
) {
  ctx.font = "600 " + size + 'px "Segoe UI",Arial,sans-serif';
  const w = ctx.measureText(text).width + 18;
  ctx.save();
  ctx.shadowColor = "#233d2420";
  ctx.shadowBlur = 9;
  ctx.shadowOffsetY = 2;
  round(ctx, x - w / 2, y - 13, w, 25, 7, fill, border);
  ctx.restore();
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
  ctx.textBaseline = "alphabetic";
}
function cuboid(ctx, g, x, y, w, d, z, h, colors) {
  const p = (a, b, c) => projectPoint(g, a, b, c);
  poly(
    ctx,
    [
      p(x, y + d, z),
      p(x + w, y + d, z),
      p(x + w, y + d, z + h),
      p(x, y + d, z + h),
    ],
    colors[0],
  );
  poly(
    ctx,
    [
      p(x + w, y, z),
      p(x + w, y + d, z),
      p(x + w, y + d, z + h),
      p(x + w, y, z + h),
    ],
    colors[1],
  );
  poly(
    ctx,
    [
      p(x, y, z + h),
      p(x + w, y, z + h),
      p(x + w, y + d, z + h),
      p(x, y + d, z + h),
    ],
    colors[2],
  );
}
function house(ctx, g, h, current, tick, selected) {
  const s = g.cell,
    p = projectPoint(g, h.x + 0.5, h.y + 0.5);
  const full = current.delivered >= h.demand;
  const missed = tick >= h.deadline && current.onTime < h.demand;
  ellipse(ctx, p.x + 3, p.y + 7, s * 0.8, s * 0.32, "#1e432326");
  if (selected || missed) {
    ctx.save();
    ctx.setLineDash(missed ? [3, 4] : []);
    ctx.strokeStyle = missed ? "#c66a3b" : "#147e75";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, s * 0.87, s * 0.44, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  const x = h.x + 0.16,
    y = h.y + 0.16;
  cuboid(ctx, g, h.x + 0.07, h.y + 0.07, 0.86, 0.86, 0, 0.07, [
    "#b6aa82",
    "#989876",
    "#d5cba3",
  ]);
  cuboid(ctx, g, x, y, 0.68, 0.68, 0.04, 0.57, [
    "#f7e5b8",
    "#c6b58e",
    "#fff1ce",
  ]);
  const q = (a, b, z) => projectPoint(g, a, b, z);
  const tone = [...h.id].reduce((sum, c) => sum + c.charCodeAt(0), 0) % 3;
  const roof = missed
    ? ["#d97750", "#ad5039"]
    : [
        ["#6995a0", "#3b6975"],
        ["#d39566", "#9d634b"],
        ["#729480", "#3b6e60"],
      ][tone];
  poly(
    ctx,
    [
      q(h.x + 0.04, h.y + 0.08, 0.57),
      q(h.x + 0.5, h.y + 0.08, 1.03),
      q(h.x + 0.5, h.y + 0.92, 1.03),
      q(h.x + 0.04, h.y + 0.92, 0.57),
    ],
    roof[0],
  );
  poly(
    ctx,
    [
      q(h.x + 0.5, h.y + 0.08, 1.03),
      q(h.x + 0.96, h.y + 0.08, 0.57),
      q(h.x + 0.96, h.y + 0.92, 0.57),
      q(h.x + 0.5, h.y + 0.92, 1.03),
    ],
    roof[1],
  );
  for (let offset = 0.2; offset < 0.9; offset += 0.14) {
    line(
      ctx,
      [
        q(h.x + 0.06, h.y + offset, 0.59),
        q(h.x + 0.5, h.y + offset, 1.05),
        q(h.x + 0.94, h.y + offset, 0.59),
      ],
      "#fff1ca26",
      Math.max(0.6, s * 0.018),
    );
  }
  line(
    ctx,
    [q(h.x + 0.5, h.y + 0.05, 1.05), q(h.x + 0.5, h.y + 0.95, 1.05)],
    "#f2d3a47a",
    Math.max(1, s * 0.045),
  );
  poly(
    ctx,
    [
      q(h.x + 0.16, h.y + 0.84, 0.57),
      q(h.x + 0.84, h.y + 0.84, 0.57),
      q(h.x + 0.5, h.y + 0.84, 0.91),
    ],
    "#f9e4b2",
  );
  // Windows and doorway sit on the two visible walls.
  poly(
    ctx,
    [
      q(x + 0.09, y + 0.685, 0.22),
      q(x + 0.24, y + 0.685, 0.22),
      q(x + 0.24, y + 0.685, 0.39),
      q(x + 0.09, y + 0.685, 0.39),
    ],
    full ? "#edc77b" : "#81aaa2",
  );
  poly(
    ctx,
    [
      q(x + 0.43, y + 0.685, 0.02),
      q(x + 0.59, y + 0.685, 0.02),
      q(x + 0.59, y + 0.685, 0.33),
      q(x + 0.43, y + 0.685, 0.33),
    ],
    "#7d6549",
  );
  poly(
    ctx,
    [
      q(x + 0.685, y + 0.23, 0.2),
      q(x + 0.685, y + 0.42, 0.2),
      q(x + 0.685, y + 0.42, 0.38),
      q(x + 0.685, y + 0.23, 0.38),
    ],
    full ? "#dfbd7b" : "#658d88",
  );
  cuboid(ctx, g, h.x + 0.64, h.y + 0.2, 0.13, 0.15, 0.65, 0.32, [
    "#b58a65",
    "#8e684d",
    "#dfbe93",
  ]);
}
function houseLabels(ctx, g, world, frame, tick) {
  const s = g.cell;
  const used = world.bridges
    .filter((b) => frame.closedBridgeIds?.includes(b.id))
    .map((b) => {
      const p = projectPoint(
        g,
        world.river.x + world.river.width / 2,
        b.y + 0.5,
        0.85,
      );
      return { x: p.x + s * 1.5 - 33, y: p.y - s * 0.7 - 13, w: 66, h: 26 };
    });
  const blockers = [world.source, ...world.houses, ...world.obstacles].map(
    (o) => {
      const p = projectPoint(g, o.x + 0.5, o.y + 0.5);
      return {
        id: o.id,
        x: p.x - s * 0.68,
        y: p.y - s * 1.1,
        w: s * 1.36,
        h: s * 1.5,
      };
    },
  );
  const overlap = (a, b) =>
    Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  for (const h of world.houses) {
    const p = projectPoint(g, h.x + 0.5, h.y + 0.5),
      current = frame.houses.find((a) => a.id === h.id);
    const missed = tick >= h.deadline && current.onTime < h.demand;
    const text =
      (h.label ?? h.id).slice(0, 16) +
      " · " +
      (missed
        ? h.demand - current.onTime + " late"
        : current.delivered + "/" + h.demand);
    const size = Math.max(10, Math.min(12, s * 0.4));
    ctx.font = "600 " + size + 'px "Segoe UI",Arial,sans-serif';
    const w = ctx.measureText(text).width + 18;
    const choices = [
      [0, 0.7],
      [-1.7, 0.4],
      [1.7, 0.4],
      [0, -1.45],
      [-2.3, 0.1],
      [2.3, 0.1],
    ]
      .map(([dx, dy], i) => {
        const box = {
          x: Math.max(8, Math.min(g.width - w - 8, p.x + dx * s - w / 2)),
          y: p.y + dy * s - 13,
          w,
          h: 25,
        };
        const score =
          [...blockers.filter((b) => b.id !== h.id), ...used].reduce(
            (sum, b) => sum + overlap(box, b),
            0,
          ) *
            50 +
          i;
        return { box, score };
      })
      .sort((a, b) => a.score - b.score);
    const box = choices[0].box,
      x = box.x + w / 2,
      y = box.y + 13;
    if (Math.abs(x - p.x) > s || y < p.y)
      line(ctx, [p, { x, y }], missed ? "#b7784e99" : "#748d5d88", 1);
    tag(ctx, x, y, text, {
      size,
      fill: missed
        ? "#b85532"
        : current.delivered === h.demand
          ? "#eaf1d7"
          : "#fffdf3",
      border: missed ? "#a3482b" : "#d7dfc4",
      color: missed ? "#fff9e8" : "#4e624d",
    });
    used.push(box);
  }
}
function well(ctx, g, source, stock, selected, paused = false) {
  const p = projectPoint(g, source.x + 0.5, source.y + 0.5),
    s = g.cell;
  ellipse(ctx, p.x + 3, p.y + 7, s * 0.7, s * 0.28, "#1e432326");
  if (selected) {
    ctx.strokeStyle = "#147e75";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, s * 0.8, s * 0.4, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  cuboid(ctx, g, source.x + 0.17, source.y + 0.17, 0.66, 0.66, 0, 0.25, [
    "#a7b8a5",
    "#849b8c",
    "#d3d7ba",
  ]);
  ellipse(ctx, p.x, p.y - s * 0.25, s * 0.3, s * 0.14, "#287f99");
  ellipse(ctx, p.x - 2, p.y - s * 0.27, s * 0.18, s * 0.07, "#5fb7cb");
  cuboid(ctx, g, source.x + 0.1, source.y + 0.32, 0.08, 0.08, 0.08, 0.8, [
    "#a88053",
    "#775b3f",
    "#d7b87b",
  ]);
  cuboid(ctx, g, source.x + 0.8, source.y + 0.59, 0.08, 0.08, 0.08, 0.8, [
    "#a88053",
    "#775b3f",
    "#d7b87b",
  ]);
  line(
    ctx,
    [
      projectPoint(g, source.x + 0.1, source.y + 0.32, 0.85),
      projectPoint(g, source.x + 0.88, source.y + 0.67, 0.85),
    ],
    "#886240",
    s * 0.1,
  );
  const a = projectPoint(g, source.x + 0.5, source.y + 0.5, 0.76);
  line(ctx, [a, { x: a.x, y: a.y + s * 0.42 }], "#d0be87", 1.5);
}
function wellLabels(ctx, g, source, stock, paused) {
  const p = projectPoint(g, source.x + 0.5, source.y + 0.5),
    s = g.cell;
  tag(ctx, p.x, p.y + s * 0.72, (source.label ?? "Well").slice(0, 16), {
    size: 12,
  });
  tag(
    ctx,
    p.x,
    p.y - s * 1.2,
    (paused ? "Paused · stock " : "Stock ") + stock,
    {
      fill: paused ? "#f8e7c6" : "#e5f1ed",
      color: paused ? "#9b6736" : "#266c62",
      border: paused ? "#debb83" : "#bfd4c8",
      size: 11,
    },
  );
}
function rock(ctx, g, o, selected) {
  const p = projectPoint(g, o.x + 0.5, o.y + 0.5),
    s = g.cell;
  ellipse(ctx, p.x + 4, p.y + 5, s * 0.56, s * 0.25, "#24412e25");
  const a = { x: p.x - s * 0.48, y: p.y },
    b = { x: p.x - s * 0.18, y: p.y - s * 0.48 },
    c = { x: p.x + s * 0.24, y: p.y - s * 0.56 },
    e = { x: p.x + s * 0.5, y: p.y - s * 0.05 },
    f = { x: p.x + s * 0.14, y: p.y + s * 0.22 };
  poly(ctx, [a, b, c, e, f], "#849b8f", selected ? "#147e75" : null);
  poly(ctx, [a, b, c, { x: p.x + 1, y: p.y - s * 0.1 }], "#b1bc9f");
  poly(ctx, [c, e, f, { x: p.x + 1, y: p.y - s * 0.1 }], "#647f75");
}
function bridge(ctx, g, world, b, selected, changed, closed = false) {
  const { x, width } = world.river,
    y = b.y;
  const q = (a, c, z = 0) => projectPoint(g, a, c, z);
  if (changed) {
    ctx.save();
    ctx.shadowColor = "#d4863b";
    ctx.shadowBlur = 17;
    poly(
      ctx,
      [
        q(x - 0.35, y - 0.08),
        q(x + width + 0.35, y - 0.08),
        q(x + width + 0.35, y + 1.08),
        q(x - 0.35, y + 1.08),
      ],
      "#f0b24e26",
      "#d1a059",
    );
    ctx.restore();
  }
  cuboid(ctx, g, x - 0.22, y + 0.17, width + 0.44, 0.66, 0, 0.13, [
    "#ad794a",
    "#92603d",
    "#d6b278",
  ]);
  for (let a = x - 0.2; a < x + width + 0.2; a += 0.2)
    line(ctx, [q(a, y + 0.17, 0.14), q(a, y + 0.83, 0.14)], "#b08a56", 1);
  for (const c of [y + 0.18, y + 0.82]) {
    for (let a = x - 0.15; a < x + width + 0.2; a += 0.55)
      cuboid(ctx, g, a, c, 0.055, 0.055, 0.1, 0.28, [
        "#a47c4c",
        "#8a643e",
        "#e4c690",
      ]);
    line(
      ctx,
      [q(x - 0.17, c, 0.36), q(x + width + 0.2, c, 0.36)],
      "#9a7047",
      Math.max(1.5, g.cell * 0.055),
    );
  }
  if (closed) {
    const a = q(x + width / 2, y + 0.06, 0.5),
      c = q(x + width / 2, y + 0.94, 0.5);
    line(ctx, [a, c], "#c16a45", Math.max(4, g.cell * 0.15));
    line(
      ctx,
      [
        { x: a.x, y: a.y + 3 },
        { x: a.x, y: a.y + g.cell * 0.4 },
      ],
      "#966c45",
      2,
    );
    line(
      ctx,
      [
        { x: c.x, y: c.y + 3 },
        { x: c.x, y: c.y + g.cell * 0.4 },
      ],
      "#966c45",
      2,
    );
    const p = q(x + width / 2, y + 0.5, 0.85);
    line(
      ctx,
      [p, { x: p.x + g.cell * 1.5, y: p.y - g.cell * 0.7 }],
      "#a4633b",
      1,
    );
    tag(ctx, p.x + g.cell * 1.5, p.y - g.cell * 0.7, "CLOSED", {
      size: 10,
      fill: "#b75e3d",
      border: "#a95135",
      color: "#fff3da",
    });
  }
  if (selected) {
    ctx.save();
    ctx.setLineDash([4, 3]);
    line(
      ctx,
      [
        q(x - 0.35, y),
        q(x + width + 0.35, y),
        q(x + width + 0.35, y + 1),
        q(x - 0.35, y + 1),
        q(x - 0.35, y),
      ],
      "#147e75",
      2,
    );
    ctx.restore();
  }
}
function courier(ctx, g, a, next, mix) {
  const s = g.cell,
    index = Number(a.id.split("-")[1]);
  const x = a.x + (next.x - a.x) * mix,
    y = a.y + (next.y - a.y) * mix;
  const p = projectPoint(g, x + 0.5, y + 0.5);
  p.x += ((index % 3) - 1) * s * 0.15;
  p.y += (Math.floor(index / 3) - 1) * s * 0.1;
  const size = Math.max(0.8, s / 32);
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.scale(size, size);
  ellipse(ctx, 2, 4, 5, 2.2, "#173c3033");
  line(
    ctx,
    [
      { x: -1.5, y: -2 },
      { x: -2.5, y: 3 },
    ],
    "#29473e",
    2,
  );
  line(
    ctx,
    [
      { x: 1.5, y: -2 },
      { x: 3, y: 3 },
    ],
    "#29473e",
    2,
  );
  round(
    ctx,
    -3.5,
    -10,
    7,
    10,
    2,
    a.waiting ? "#d39032" : a.state === "outbound" ? "#258aa4" : "#648e7e",
  );
  ellipse(ctx, 0, -13, 3.6, 3.6, "#dfb586");
  ellipse(ctx, 0, -15, 4, 1.8, "#335f53");
  if (a.state === "outbound")
    round(ctx, 3, -7, 4.5, 6, 1, "#6ec9d0", "#2d8797");
  if (a.waiting) {
    ellipse(ctx, 0, -24, 6.5, 6.5, "#fff8e6");
    ctx.fillStyle = "#ad6828";
    ctx.font = "bold 10px Arial";
    ctx.textAlign = "center";
    ctx.fillText("!", 0, -20.5);
  }
  ctx.restore();
}
export function drawWorld(
  canvas,
  world,
  run,
  tick,
  selected,
  alternative = false,
  options = {},
) {
  const g = boardGeometry(canvas, world, options),
    s = g.cell;
  const dpr = options.pixelRatio ?? Math.min(window.devicePixelRatio || 1, 2);
  if (
    canvas.width !== Math.round(g.width * dpr) ||
    canvas.height !== Math.round(g.height * dpr)
  ) {
    canvas.width = Math.round(g.width * dpr);
    canvas.height = Math.round(g.height * dpr);
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, g.width, g.height);
  drawBackdrop(ctx, g);
  const q = (x, y, z = 0) => projectPoint(g, x, y, z);
  const floorTick = Math.min(
    Math.max(0, Math.floor(tick)),
    run.frames.length - 1,
  );
  const frame = run.frames[floorTick],
    next = run.frames[Math.min(floorTick + 1, run.frames.length - 1)];
  const mix = Math.max(0, Math.min(1, tick - floorTick));
  const rendered3d = drawDiorama3D(ctx, g, world, run, frame, next, mix, {
    ...options,
    tick,
    selected,
  });
  canvas.dataset.renderMode = rendered3d ? "3d" : "2d";
  if (!rendered3d) {
    // Ground shadow, then the two exposed sides of the tabletop island.
    ctx.save();
    ctx.filter = "blur(24px)";
    poly(
      ctx,
      [
        q(0, 0),
        q(world.width, 0),
        q(world.width, world.height),
        q(0, world.height),
      ].map((p) => ({ x: p.x + s * 0.5, y: p.y + s * 1.5 })),
      "#020e16b0",
    );
    ctx.restore();
    drawStrata(ctx, g, world);
    for (let depth = 0; depth < world.width + world.height; depth++)
      for (let x = 0; x < world.width; x++) {
        const y = depth - x;
        if (y < 0 || y >= world.height) continue;
        const water =
          x >= world.river.x && x < world.river.x + world.river.width;
        const n = (x * 17 + y * 31 + (world.seed % 101)) % 13;
        poly(
          ctx,
          [q(x, y), q(x + 1, y), q(x + 1, y + 1), q(x, y + 1)],
          water
            ? n % 2
              ? "#3c9ca6"
              : "#348c99"
            : ["#b7ca91", "#bdce98", "#abc18a", "#b4c68e"][n % 4],
          water ? "#86d8cf22" : "#dfdfb51a",
        );
        if (water && n % 2 === 0) {
          const drift = Math.sin((x + y) * 1.5 + tick * 0.08) * 0.12;
          line(
            ctx,
            [q(x + 0.23, y + 0.48 + drift), q(x + 0.7, y + 0.48 + drift)],
            "#b3d9d25c",
            1,
          );
        } else if (!water && n < 3) {
          const p = q(x + 0.72, y + 0.58);
          line(
            ctx,
            [
              { x: p.x - 2, y: p.y },
              { x: p.x - 2, y: p.y - 3 },
            ],
            "#809e5945",
            0.8,
          );
          line(
            ctx,
            [
              { x: p.x + 1, y: p.y + 1 },
              { x: p.x + 2, y: p.y - 2 },
            ],
            "#809e5945",
            0.8,
          );
        }
      }
    drawRiver(ctx, g, world, options.ambientTime ?? tick * 0.14);
    // All paths come from this simulation; highlighted paths show a selected home.
    const routePhase = run.routeChanges?.findLast(
      (phase) => phase.tick <= tick,
    );
    for (const [id, route] of Object.entries(
      routePhase?.routes ?? run.routes,
    )) {
      if (!route) continue;
      line(
        ctx,
        route.map((p) => q(p.x + 0.5, p.y + 0.5, 0.012)),
        id === selected ? "#fff0bc" : "#ecd4a5aa",
        id === selected ? s * 0.27 : s * 0.2,
      );
      if (id === selected)
        line(
          ctx,
          route.map((p) => q(p.x + 0.5, p.y + 0.5, 0.018)),
          "#a9803a",
          Math.max(1, s * 0.035),
        );
    }
    for (const b of world.bridges)
      bridge(
        ctx,
        g,
        world,
        b,
        selected === b.id,
        options.changedIds?.includes(b.id),
        frame.closedBridgeIds?.includes(b.id),
      );
    const entities = [
      ...sceneryFor(world, run).map((tree) => ({
        depth: tree.x + tree.y,
        draw: () => drawTree(ctx, g, tree),
      })),
      {
        depth: world.source.x + world.source.y,
        draw: () =>
          well(
            ctx,
            g,
            world.source,
            frame.stock,
            selected === world.source.id,
            frame.productionPaused,
          ),
      },
      ...world.obstacles.map((o) => ({
        depth: o.x + o.y,
        draw: () => rock(ctx, g, o, selected === o.id),
      })),
      ...world.houses.map((h) => ({
        depth: h.x + h.y,
        draw: () =>
          house(
            ctx,
            g,
            h,
            frame.houses.find((a) => a.id === h.id),
            tick,
            selected === h.id,
          ),
      })),
      ...frame.agents
        .filter((a) => a.state !== "idle")
        .map((a) => ({
          depth: a.x + a.y + 0.1,
          draw: () =>
            courier(
              ctx,
              g,
              a,
              next.agents.find((b) => b.id === a.id) ?? a,
              mix,
            ),
        })),
    ];
    entities.sort((a, b) => a.depth - b.depth).forEach((e) => e.draw());
  } else {
    for (const b of world.bridges.filter((b) =>
      frame.closedBridgeIds?.includes(b.id),
    )) {
      const p = q(world.river.x + world.river.width / 2, b.y + 0.5, 0.85);
      line(ctx, [p, { x: p.x + s * 1.5, y: p.y - s * 0.7 }], "#cd9361", 1);
      tag(ctx, p.x + s * 1.5, p.y - s * 0.7, "CLOSED", {
        size: 10,
        fill: "#b75e3d",
        border: "#a95135",
        color: "#fff3da",
      });
    }
    for (const a of frame.agents.filter((a) => a.waiting)) {
      const p = q(a.x + 0.5, a.y + 0.5, 0.95);
      ellipse(ctx, p.x, p.y, 6, 6, "#ffe6a3");
      ctx.fillStyle = "#8c6339";
      ctx.font = "bold 10px Arial";
      ctx.textAlign = "center";
      ctx.fillText("!", p.x, p.y + 3);
    }
  }
  wellLabels(ctx, g, world.source, frame.stock, frame.productionPaused);
  houseLabels(ctx, g, world, frame, tick);
  for (const b of world.bridges) {
    const origin = options.originBridges?.find(
      (a) => a.id === b.id && a.y !== b.y,
    );
    if (!origin) continue;
    const x = world.river.x + world.river.width / 2;
    const from = q(x, origin.y + 0.5, 0.4),
      to = q(x, b.y + 0.5, 0.4);
    ctx.save();
    ctx.setLineDash([5, 4]);
    line(ctx, [from, to], "#b07b2a", 2);
    ctx.restore();
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    line(
      ctx,
      [
        {
          x: to.x - Math.cos(angle - 0.5) * 9,
          y: to.y - Math.sin(angle - 0.5) * 9,
        },
        to,
        {
          x: to.x - Math.cos(angle + 0.5) * 9,
          y: to.y - Math.sin(angle + 0.5) * 9,
        },
      ],
      "#b07b2a",
      2,
    );
    tag(ctx, from.x, from.y + 20, "was row " + (origin.y + 1), {
      size: 10,
      fill: "#f8edce",
      border: "#d8b979",
      color: "#9b7239",
    });
  }
  if (options.dragCell) {
    const { x, y } = options.dragCell;
    if (x >= 0 && y >= 0 && x < world.width && y < world.height)
      poly(
        ctx,
        [
          q(x, y, 0.03),
          q(x + 1, y, 0.03),
          q(x + 1, y + 1, 0.03),
          q(x, y + 1, 0.03),
        ],
        "#ffffff75",
        "#167e70",
      );
  }
  ctx.textAlign = "left";
  ctx.fillStyle = "#8eaaa4";
  ctx.font = '10px "Segoe UI",Arial,sans-serif';
  ctx.fillText(
    options.replayClip
      ? "ENGINE REPLAY · INTERPOLATED MOVEMENT"
      : g.zoom > 1
        ? "DETAIL VIEW · SELECT FIT MAP FOR OVERVIEW"
        : "DIORAMA VIEW · DRAG OBJECTS TO DESIGN",
    18,
    g.height - 17,
  );
  ctx.textAlign = "right";
  ctx.fillText(
    alternative ? "B / PROPOSED WORLD" : "A / ORIGINAL WORLD",
    g.width - 18,
    g.height - 17,
  );
}
export function drawTablePreview(canvas, world) {
  const w = canvas.clientWidth || 240,
    h = canvas.clientHeight || 160,
    dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.fillStyle = "#d5c5a4";
  ctx.fillRect(0, 0, w, h);
  for (let y = 8; y < h; y += 13)
    line(
      ctx,
      [
        { x: 0, y },
        { x: w, y: y + 2 },
      ],
      "#b8a68044",
      1,
    );
  round(ctx, w * 0.1, h * 0.13, w * 0.8, h * 0.7, 4, "#eee8d2", "#c1b695");
  for (const o of [
    world.source,
    ...world.houses,
    ...world.bridges,
    ...world.obstacles,
  ]) {
    const x = w * 0.15 + (o.x / world.width) * w * 0.7,
      y = h * 0.2 + (o.y / world.height) * h * 0.55;
    if (world.bridges.includes(o))
      round(ctx, x - 12, y - 3, 26, 6, 2, "#ae7a47");
    else if (o.id === world.source.id) {
      ellipse(ctx, x, y, 8, 6, "#70a8aa");
      ellipse(ctx, x, y, 5, 3, "#3b777e");
    } else if (world.obstacles.includes(o)) ellipse(ctx, x, y, 6, 4, "#929b83");
    else round(ctx, x - 5, y - 6, 11, 12, 2, "#8caa79", "#71875c");
  }
}
