import { bridgeAt } from "/shared/engine.js";

export function boardGeometry(canvas, world) {
  const width = canvas.clientWidth || 600;
  const height = canvas.clientHeight || 400;
  const cell = Math.min(
    (width - 40) / world.width,
    (height - 36) / world.height,
  );
  return {
    width,
    height,
    cell,
    left: (width - cell * world.width) / 2,
    top: (height - cell * world.height) / 2,
  };
}

export function cellFromPointer(canvas, world, event) {
  const r = canvas.getBoundingClientRect();
  const g = boardGeometry(canvas, world);
  return {
    x: Math.floor((event.clientX - r.left - g.left) / g.cell),
    y: Math.floor((event.clientY - r.top - g.top) / g.cell),
  };
}

function rounded(ctx, x, y, w, h, r, fill, stroke) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

export function drawWorld(
  canvas,
  world,
  run,
  tick,
  selected,
  alternative = false,
) {
  const g = boardGeometry(canvas, world);
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  if (
    canvas.width !== Math.round(g.width * ratio) ||
    canvas.height !== Math.round(g.height * ratio)
  ) {
    canvas.width = Math.round(g.width * ratio);
    canvas.height = Math.round(g.height * ratio);
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, g.width, g.height);
  const { cell: s, left, top } = g;
  const pos = (o) => ({ x: left + (o.x + 0.5) * s, y: top + (o.y + 0.5) * s });
  const frame = run.frames[Math.min(Math.round(tick), run.frames.length - 1)];
  ctx.fillStyle = "#f0f1e5";
  ctx.fillRect(0, 0, g.width, g.height);
  rounded(
    ctx,
    left - 5,
    top - 5,
    world.width * s + 10,
    world.height * s + 10,
    10,
    "#e8edd9",
    "#dce2cb",
  );
  for (let x = 0; x < world.width; x++)
    for (let y = 0; y < world.height; y++) {
      const n = (x * 17 + y * 31 + (world.seed % 101)) % 13;
      if (n < 4) {
        ctx.fillStyle = "#dfe7cc";
        ctx.fillRect(left + x * s + 1, top + y * s + 1, s - 2, s - 2);
      }
      ctx.beginPath();
      ctx.arc(left + (x + 0.5) * s, top + (y + 0.5) * s, 0.6, 0, Math.PI * 2);
      ctx.fillStyle = "#cad4b9";
      ctx.fill();
    }
  const riverLeft = left + world.river.x * s;
  const riverWidth = world.river.width * s;
  ctx.fillStyle = "#b7d5d3";
  ctx.fillRect(riverLeft, top, riverWidth, world.height * s);
  ctx.fillStyle = "#cadfd2";
  ctx.fillRect(riverLeft - 2, top, 3, world.height * s);
  ctx.fillRect(riverLeft + riverWidth - 1, top, 3, world.height * s);
  ctx.strokeStyle = "#94bfbe";
  ctx.lineWidth = 0.7;
  for (let i = 0; i < world.height * 2; i++) {
    const y = top + ((i + 0.5) * s) / 2;
    const drift = Math.sin((i + tick / 15) * 0.8) * s * 0.08;
    ctx.beginPath();
    ctx.moveTo(riverLeft + s * 0.2 + drift, y);
    ctx.quadraticCurveTo(
      riverLeft + riverWidth / 2,
      y + 2,
      riverLeft + riverWidth - s * 0.2 + drift,
      y,
    );
    ctx.stroke();
  }
  if (selected && run.routes[selected]) {
    ctx.beginPath();
    run.routes[selected].forEach((p, i) => {
      const q = pos(p);
      if (!i) ctx.moveTo(q.x, q.y);
      else ctx.lineTo(q.x, q.y);
    });
    ctx.strokeStyle = "#c49a67a0";
    ctx.lineWidth = s * 0.15;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
  }
  for (const b of world.bridges) {
    const p = pos(b);
    const w = world.river.width * s + s * 0.42;
    const x = riverLeft - s * 0.21;
    rounded(ctx, x + 1, p.y - s * 0.22 + 3, w, s * 0.52, 2, "#536b5333");
    rounded(ctx, x, p.y - s * 0.25, w, s * 0.5, 2, "#d8b982", "#b99966");
    ctx.strokeStyle = "#b99b69";
    ctx.lineWidth = 0.7;
    for (let px = x + s * 0.2; px < x + w; px += s * 0.23) {
      ctx.beginPath();
      ctx.moveTo(px, p.y - s * 0.24);
      ctx.lineTo(px, p.y + s * 0.24);
      ctx.stroke();
    }
    ctx.strokeStyle = "#a98753";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, p.y - s * 0.25);
    ctx.lineTo(x + w, p.y - s * 0.25);
    ctx.moveTo(x, p.y + s * 0.25);
    ctx.lineTo(x + w, p.y + s * 0.25);
    ctx.stroke();
    if (b.id === selected)
      rounded(
        ctx,
        x - 3,
        p.y - s * 0.25 - 3,
        w + 6,
        s * 0.5 + 6,
        4,
        null,
        "#b57547",
      );
  }
  for (const o of world.obstacles) {
    const p = pos(o);
    ctx.fillStyle = "#59624420";
    ctx.beginPath();
    ctx.ellipse(p.x + 2, p.y + s * 0.2, s * 0.36, s * 0.15, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#a6ac9b";
    ctx.beginPath();
    ctx.moveTo(p.x - s * 0.3, p.y + s * 0.12);
    ctx.lineTo(p.x - s * 0.2, p.y - s * 0.2);
    ctx.lineTo(p.x + s * 0.14, p.y - s * 0.29);
    ctx.lineTo(p.x + s * 0.33, p.y);
    ctx.lineTo(p.x + s * 0.23, p.y + s * 0.24);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#bac0ad";
    ctx.beginPath();
    ctx.moveTo(p.x - s * 0.2, p.y - s * 0.2);
    ctx.lineTo(p.x + s * 0.14, p.y - s * 0.29);
    ctx.lineTo(p.x + s * 0.05, p.y + s * 0.06);
    ctx.lineTo(p.x - s * 0.3, p.y + s * 0.12);
    ctx.closePath();
    ctx.fill();
  }
  const wp = pos(world.source);
  ctx.fillStyle = "#42695725";
  ctx.beginPath();
  ctx.ellipse(wp.x + 1, wp.y + s * 0.25, s * 0.4, s * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();
  rounded(
    ctx,
    wp.x - s * 0.3,
    wp.y - s * 0.1,
    s * 0.6,
    s * 0.4,
    s * 0.08,
    "#b6ba9f",
    "#7c927b",
  );
  ctx.fillStyle = "#a0c5c9";
  ctx.beginPath();
  ctx.ellipse(wp.x, wp.y - s * 0.1, s * 0.3, s * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#7c927b";
  ctx.stroke();
  ctx.strokeStyle = "#8d7957";
  ctx.lineWidth = Math.max(1, s * 0.055);
  ctx.beginPath();
  ctx.moveTo(wp.x - s * 0.25, wp.y - s * 0.4);
  ctx.lineTo(wp.x - s * 0.25, wp.y + s * 0.1);
  ctx.moveTo(wp.x + s * 0.25, wp.y - s * 0.4);
  ctx.lineTo(wp.x + s * 0.25, wp.y + s * 0.1);
  ctx.moveTo(wp.x - s * 0.31, wp.y - s * 0.4);
  ctx.lineTo(wp.x + s * 0.31, wp.y - s * 0.4);
  ctx.stroke();
  for (const h of world.houses) {
    const p = pos(h);
    const state = frame.houses.find((a) => a.id === h.id);
    const late = tick >= h.deadline && state.onTime < h.demand;
    const full = state.delivered === h.demand;
    ctx.fillStyle = "#526b4930";
    ctx.beginPath();
    ctx.ellipse(p.x + 2, p.y + s * 0.26, s * 0.43, s * 0.17, 0, 0, Math.PI * 2);
    ctx.fill();
    rounded(
      ctx,
      p.x - s * 0.3,
      p.y - s * 0.1,
      s * 0.6,
      s * 0.46,
      2,
      full ? "#e7e7c7" : "#f1e7c9",
      "#bcba99",
    );
    ctx.fillStyle = late ? "#c18056" : "#7c9770";
    ctx.beginPath();
    ctx.moveTo(p.x - s * 0.4, p.y - s * 0.08);
    ctx.lineTo(p.x, p.y - s * 0.48);
    ctx.lineTo(p.x + s * 0.4, p.y - s * 0.08);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = late ? "#aa6744" : "#60835d";
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - s * 0.48);
    ctx.lineTo(p.x + s * 0.4, p.y - s * 0.08);
    ctx.lineTo(p.x + s * 0.08, p.y - s * 0.08);
    ctx.closePath();
    ctx.fill();
    rounded(
      ctx,
      p.x - s * 0.08,
      p.y + s * 0.1,
      s * 0.16,
      s * 0.25,
      1,
      "#9a9878",
    );
    ctx.fillStyle = "#e0d9a3";
    ctx.fillRect(p.x - s * 0.22, p.y + s * 0.03, s * 0.1, s * 0.1);
    ctx.fillRect(p.x + s * 0.12, p.y + s * 0.03, s * 0.1, s * 0.1);
    rounded(
      ctx,
      p.x - s * 0.37,
      p.y + s * 0.47,
      s * 0.74,
      s * 0.09,
      2,
      "#cbd5ba",
    );
    if (state.delivered)
      rounded(
        ctx,
        p.x - s * 0.37,
        p.y + s * 0.47,
        (s * 0.74 * state.delivered) / h.demand,
        s * 0.09,
        2,
        full ? "#65895a" : "#72a4ab",
      );
    ctx.font = `${Math.max(7, Math.min(9, s * 0.27))}px Arial`;
    ctx.textAlign = "center";
    ctx.fillStyle = "#788366";
    ctx.fillText(h.label.slice(0, 12), p.x, p.y + s * 0.88);
    if (h.id === selected)
      rounded(
        ctx,
        p.x - s * 0.5,
        p.y - s * 0.61,
        s,
        s * 1.3,
        5,
        null,
        "#b57547",
      );
  }
  for (const a of frame.agents) {
    if (a.state === "idle") continue;
    const p = pos(a);
    const index = Number(a.id.split("-")[1]);
    const dx = ((index % 3) - 1) * s * 0.1;
    const dy = (Math.floor(index / 3) - 1) * s * 0.09;
    ctx.fillStyle = "#485b4428";
    ctx.beginPath();
    ctx.ellipse(
      p.x + dx + 1,
      p.y + dy + s * 0.17,
      s * 0.12,
      s * 0.07,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    rounded(
      ctx,
      p.x + dx - s * 0.075,
      p.y + dy - s * 0.04,
      s * 0.15,
      s * 0.22,
      s * 0.055,
      a.waiting ? "#c58d50" : a.state === "outbound" ? "#5c8d9a" : "#9d9a79",
    );
    ctx.fillStyle = "#e6cda0";
    ctx.beginPath();
    ctx.arc(p.x + dx, p.y + dy - s * 0.09, s * 0.075, 0, Math.PI * 2);
    ctx.fill();
    if (a.waiting) {
      ctx.fillStyle = "#a76b3c";
      ctx.font = `bold ${Math.max(8, s * 0.29)}px Arial`;
      ctx.textAlign = "center";
      ctx.fillText("!", p.x + dx, p.y + dy - s * 0.27);
    }
  }
  ctx.font = "7px Arial";
  ctx.textAlign = "right";
  ctx.fillStyle = "#8d9b7d";
  ctx.fillText(
    alternative ? "B / SAME STARTING CONDITIONS" : "A / ORIGINAL LAYOUT",
    g.width - 13,
    g.height - 8,
  );
}

export function drawTablePreview(canvas, world) {
  const w = canvas.clientWidth || 200;
  const h = canvas.clientHeight || 160;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.fillStyle = "#d9cfb7";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "#c1b29155";
  ctx.lineWidth = 0.5;
  for (let y = 9; y < h; y += 11) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(w / 3, y - 3, (w * 2) / 3, y + 2, w, y);
    ctx.stroke();
  }
  ctx.save();
  ctx.translate(w / 2, h / 2 - 6);
  ctx.rotate(-0.06);
  rounded(
    ctx,
    -w * 0.42 + 2,
    -h * 0.36 + 3,
    w * 0.84,
    h * 0.66,
    4,
    "#7b735d30",
  );
  rounded(
    ctx,
    -w * 0.42,
    -h * 0.36,
    w * 0.84,
    h * 0.66,
    4,
    "#ecebdc",
    "#d1cbb7",
  );
  for (const object of [
    world.source,
    ...world.houses,
    ...world.bridges,
    ...world.obstacles,
  ]) {
    const x = (object.x / world.width - 0.5) * w * 0.75;
    const y = (object.y / world.height - 0.5) * h * 0.55;
    if (world.bridges.includes(object)) {
      rounded(ctx, x - 10, y - 2, 22, 5, 1, "#b88e5b", "#97794f");
    } else if (object.id === world.source.id) {
      ctx.fillStyle = "#8faeb0";
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, 2 * Math.PI);
      ctx.fill();
      ctx.strokeStyle = "#607e81";
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x + 7, y, 3, -0.5, 2);
      ctx.stroke();
    } else if (world.obstacles.includes(object)) {
      rounded(ctx, x - 4, y - 3, 8, 6, 3, "#a7aa94");
    } else {
      rounded(ctx, x - 4, y - 5, 9, 10, 1, "#9da77c", "#7e8d65");
      ctx.fillStyle = "#bdc49e";
      ctx.fillRect(x - 3, y - 4, 7, 3);
    }
  }
  ctx.restore();
}
