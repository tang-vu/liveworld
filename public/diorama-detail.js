import { projectPoint as project } from "/shared/projection.js";

export function drawBackdrop(ctx, g) {
  const sky = ctx.createLinearGradient(0, 0, g.width, g.height);
  sky.addColorStop(0, "#183b43");
  sky.addColorStop(0.55, "#102d36");
  sky.addColorStop(1, "#0b212b");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, g.width, g.height);
  const light = ctx.createRadialGradient(
    g.width * 0.45,
    g.height * 0.3,
    0,
    g.width * 0.5,
    g.height * 0.4,
    g.width * 0.65,
  );
  light.addColorStop(0, "#8aab9824");
  light.addColorStop(1, "#8aab9800");
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, g.width, g.height);
  ctx.fillStyle = "#a3bdbb15";
  for (let x = 24; x < g.width; x += 32)
    for (let y = 24; y < g.height; y += 32) ctx.fillRect(x, y, 1, 1);
}

function polygon(ctx, points, fill) {
  ctx.beginPath();
  points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

export function drawStrata(ctx, g, world) {
  const q = (x, y, z) => project(g, x, y, z);
  const layers = [
    [0, -0.15, "#88a777", "#6e8e64"],
    [-0.15, -0.64, "#9a7d56", "#78684c"],
    [-0.64, -0.95, "#675b46", "#4c4b3b"],
    [-0.95, -1.03, "#b49b70", "#8b7b59"],
  ];
  for (const [top, bottom, front, side] of layers) {
    polygon(
      ctx,
      [
        q(0, world.height, top),
        q(world.width, world.height, top),
        q(world.width, world.height, bottom),
        q(0, world.height, bottom),
      ],
      front,
    );
    polygon(
      ctx,
      [
        q(world.width, 0, top),
        q(world.width, world.height, top),
        q(world.width, world.height, bottom),
        q(world.width, 0, bottom),
      ],
      side,
    );
  }
}

export function drawRiver(ctx, g, world, time) {
  const q = (x, y, z = 0.01) => project(g, x, y, z);
  for (let y = 0; y < world.height; y += 0.5) {
    const flow = ((time * 0.09 + y * 0.31) % 1) * 0.45;
    const x =
      world.river.x + 0.25 + (((y * 17) % 13) / 13) * (world.river.width - 0.6);
    const a = q(x, y + flow),
      b = q(x + 0.34, y + flow);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = y % 2 ? "#d5f9ef55" : "#c1f3ed88";
    ctx.lineWidth = Math.max(1, g.cell * 0.035);
    ctx.stroke();
  }
  for (const edge of [world.river.x, world.river.x + world.river.width]) {
    const a = q(edge, 0),
      b = q(edge, world.height);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = "#f0dfad88";
    ctx.lineWidth = Math.max(1.5, g.cell * 0.06);
    ctx.stroke();
  }
}

const sceneryCache = new WeakMap();
export function sceneryFor(world, run) {
  if (sceneryCache.has(run)) return sceneryCache.get(run);
  const occupied = new Set();
  for (const object of [
    world.source,
    ...world.houses,
    ...world.bridges,
    ...world.obstacles,
  ])
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        occupied.add(`${object.x + dx},${object.y + dy}`);
  for (const frame of run.frames)
    for (const agent of frame.agents)
      occupied.add(`${Math.round(agent.x)},${Math.round(agent.y)}`);
  for (const routes of [
    run.routes,
    ...(run.routeChanges ?? []).map((phase) => phase.routes),
  ])
    for (const route of Object.values(routes ?? {}))
      for (const p of route ?? []) occupied.add(`${p.x},${p.y}`);
  const trees = [];
  for (let y = 0; y < world.height; y++)
    for (let x = 0; x < world.width; x++) {
      const n = (x * 73 + y * 41 + world.seed) % 101;
      const edge =
        x < 2 || y < 2 || x >= world.width - 2 || y >= world.height - 1;
      if (
        trees.length < 17 &&
        edge &&
        n % 5 === 0 &&
        (x < world.river.x - 0.5 || x > world.river.x + world.river.width) &&
        !occupied.has(`${x},${y}`)
      )
        trees.push({
          x: x + 0.5,
          y: y + 0.5,
          scale: 0.7 + (n % 4) * 0.11,
          gold: n % 3 === 0,
        });
    }
  sceneryCache.set(run, trees);
  return trees;
}

export function drawTree(ctx, g, tree) {
  const p = project(g, tree.x, tree.y),
    s = g.cell * tree.scale;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.fillStyle = "#17372c30";
  ctx.beginPath();
  ctx.ellipse(s * 0.2, 3, s * 0.65, s * 0.2, -0.25, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#735938";
  ctx.lineWidth = Math.max(2, s * 0.09);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -s * 0.9);
  ctx.stroke();
  const colors = tree.gold
    ? ["#8b9e54", "#b0b969", "#d2ce87"]
    : ["#427f68", "#619b79", "#8ab285"];
  for (const [x, y, r, color] of [
    [0.12, -0.85, 0.42, colors[0]],
    [-0.25, -0.95, 0.39, colors[1]],
    [0, -1.16, 0.43, colors[2]],
  ]) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(x * s, y * s, r * s, r * s * 0.85, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
