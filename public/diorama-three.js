import * as T from "./vendor/three.module.js";
import { sceneryFor } from "./diorama-detail.js";
import { boardCameraFrame } from "/shared/projection.js";

// Orthographic framing matches shared/projection.js, including the vertical
// scale. The renderer decorates engine state; it never changes that state.
const scenes = new Map(),
  materials = new Map();
let renderer,
  unsupported = false;
const box = new T.BoxGeometry(1, 1, 1);
const sphere = new T.IcosahedronGeometry(1, 1);
const cylinder = new T.CylinderGeometry(1, 1, 1, 12);
const shape = new T.Shape();
shape.moveTo(-0.48, 0);
shape.lineTo(0, 0.52);
shape.lineTo(0.48, 0);
shape.closePath();
const roofGeometry = new T.ExtrudeGeometry(shape, {
  depth: 0.9,
  bevelEnabled: false,
});
const material = (color) => {
  if (!materials.has(color))
    materials.set(
      color,
      new T.MeshStandardMaterial({ color, roughness: 0.88, metalness: 0 }),
    );
  return materials.get(color);
};
function mesh(parent, geometry, color, x, y, z, sx = 1, sy = 1, sz = 1) {
  const object = new T.Mesh(geometry, material(color));
  object.position.set(x, y, z);
  object.scale.set(sx, sy, sz);
  object.castShadow = true;
  object.receiveShadow = true;
  parent.add(object);
  return object;
}
const block = (p, c, x, y, z, sx, sy, sz) =>
  mesh(p, box, c, x, y, z, sx, sy, sz);
function house(parent, h) {
  const x = h.x + 0.5,
    z = h.y + 0.5;
  block(parent, "#a8a281", x, 0.045, z, 0.9, 0.09, 0.9);
  block(parent, "#f5e7c7", x, 0.37, z, 0.7, 0.65, 0.7);
  const tone = [...h.id].reduce((n, c) => n + c.charCodeAt(0), 0) % 3;
  mesh(
    parent,
    roofGeometry,
    ["#5b8194", "#bc7951", "#4c7e73"][tone],
    x,
    0.7,
    h.y + 0.05,
  );
  // Ridge, tiled roof seams, chimney and framed amber windows.
  block(parent, "#e0c098", x, 1.205, z, 0.045, 0.045, 0.94);
  for (let i = 0.18; i < 0.9; i += 0.15) {
    const a = block(
      parent,
      "#f1d7ad",
      x - 0.245,
      0.96,
      h.y + i,
      0.66,
      0.013,
      0.014,
    );
    a.rotation.z = Math.PI / 4;
    const b = block(
      parent,
      "#d1ab7c",
      x + 0.245,
      0.96,
      h.y + i,
      0.66,
      0.013,
      0.014,
    );
    b.rotation.z = -Math.PI / 4;
  }
  block(parent, "#aa8b67", h.x + 0.7, 1.1, h.y + 0.3, 0.14, 0.4, 0.15);
  block(parent, "#d5c3a0", h.x + 0.7, 1.31, h.y + 0.3, 0.19, 0.04, 0.2);
  for (const wx of [-0.2, 0.2]) {
    block(parent, "#6b7f75", x + wx, 0.42, h.y + 0.861, 0.16, 0.23, 0.025);
    block(parent, "#e9c88c", x + wx, 0.43, h.y + 0.878, 0.11, 0.16, 0.01);
  }
  block(parent, "#7c6449", x, 0.21, h.y + 0.869, 0.14, 0.34, 0.025);
  block(parent, "#e0cc9e", x, 0.035, h.y + 0.99, 0.23, 0.07, 0.2);
  block(parent, "#70897b", h.x + 0.861, 0.41, z, 0.025, 0.22, 0.17);
  block(parent, "#e9c88c", h.x + 0.878, 0.42, z, 0.01, 0.15, 0.12);
}
function well(parent, source) {
  const x = source.x + 0.5,
    z = source.y + 0.5;
  const ring = new T.Mesh(
    new T.TorusGeometry(0.34, 0.09, 8, 18),
    material("#c6c8ac"),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.set(x, 0.32, z);
  ring.castShadow = true;
  ring.receiveShadow = true;
  parent.add(ring);
  mesh(parent, cylinder, "#7e9a8c", x, 0.14, z, 0.42, 0.28, 0.42);
  mesh(parent, cylinder, "#4aabb5", x, 0.289, z, 0.29, 0.014, 0.29);
  for (const dx of [-0.39, 0.39])
    block(parent, "#af885a", x + dx, 0.54, z, 0.065, 1.04, 0.075);
  block(parent, "#d4b27c", x, 1.08, z, 0.96, 0.09, 0.1);
  mesh(parent, cylinder, "#d3c6a0", x, 0.82, z, 0.009, 0.5, 0.009);
}
function bridge(parent, world, b) {
  const group = new T.Group(),
    x = world.river.x,
    z = b.y;
  parent.add(group);
  for (let a = -0.2; a < world.river.width + 0.2; a += 0.15)
    block(group, "#c09a65", x + a, 0.15, z + 0.5, 0.142, 0.12, 0.79);
  for (const dz of [0.16, 0.84]) {
    for (let a = -0.2; a <= world.river.width + 0.2; a += 0.4)
      block(group, "#a4764c", x + a, 0.34, z + dz, 0.045, 0.47, 0.045);
    block(
      group,
      "#e0bc7e",
      x + world.river.width / 2,
      0.57,
      z + dz,
      world.river.width + 0.48,
      0.045,
      0.05,
    );
  }
  const gate = new T.Group();
  group.add(gate);
  for (const dz of [0.1, 0.9])
    block(
      gate,
      "#a77248",
      x + world.river.width / 2,
      0.5,
      z + dz,
      0.055,
      0.8,
      0.055,
    );
  block(
    gate,
    "#d67c55",
    x + world.river.width / 2,
    0.71,
    z + 0.5,
    0.07,
    0.13,
    0.93,
  );
  gate.visible = false;
  return { group, gate };
}
function tree(parent, t) {
  mesh(parent, cylinder, "#8b6b46", t.x, 0.38, t.y, 0.045, 0.76, 0.045);
  const colors = t.gold
    ? ["#a1ac61", "#bfc778", "#d7cf8c"]
    : ["#4a886c", "#6c9f79", "#91b48a"];
  for (const [dx, h, dz, size, c] of [
    [0.12, 0.92, 0, 0.42, 0],
    [-0.23, 1.03, 0.08, 0.39, 1],
    [0, 1.27, -0.04, 0.44, 2],
  ])
    mesh(
      parent,
      sphere,
      colors[c],
      t.x + dx * t.scale,
      h * t.scale,
      t.y + dz * t.scale,
      size * t.scale,
      size * t.scale * 0.9,
      size * t.scale,
    );
}
function roads(entry, routes, selected) {
  const stamp = routes;
  if (entry.routeStamp === stamp && entry.routeSelected === selected) return;
  entry.routeStamp = stamp;
  entry.routeSelected = selected;
  entry.roads.clear();
  const edges = new Map();
  for (const [id, route] of Object.entries(routes))
    for (let i = 1; i < (route?.length ?? 0); i++) {
      const a = route[i - 1],
        b = route[i],
        key = [`${a.x},${a.y}`, `${b.x},${b.y}`].sort().join("|");
      if (!edges.has(key) || id === selected)
        edges.set(key, { a, b, selected: id === selected });
    }
  for (const { a, b, selected: active } of edges.values())
    block(
      entry.roads,
      active ? "#ffe6a1" : "#e1c694",
      (a.x + b.x) / 2 + 0.5,
      0.04,
      (a.y + b.y) / 2 + 0.5,
      Math.abs(b.x - a.x) + 0.2,
      0.025,
      Math.abs(b.y - a.y) + 0.2,
    );
}
function makeScene(world, run, g) {
  const framing = boardCameraFrame(g, world);
  const scene = new T.Scene(),
    root = new T.Group();
  root.scale.y = framing.heightScale;
  scene.add(root);
  const camera = new T.OrthographicCamera(-15, 15, 12, -12, 0.1, 150);
  const target = new T.Vector3(...framing.target);
  camera.position.fromArray(framing.eye);
  camera.lookAt(target);
  scene.add(new T.HemisphereLight("#fff1d7", "#527e7c", 1.65));
  const sun = new T.DirectionalLight("#ffe4b5", 2.4);
  sun.position.set(-5, 22, -10);
  sun.target.position.copy(target);
  scene.add(sun, sun.target);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {
    left: -24,
    right: 24,
    top: 24,
    bottom: -24,
    near: 1,
    far: 70,
  });
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.025;
  sun.shadow.radius = 3;
  sun.shadow.autoUpdate = false;
  sun.shadow.needsUpdate = true;
  const fill = new T.DirectionalLight("#a7d0d1", 0.55);
  fill.position.set(20, 10, 20);
  scene.add(fill);
  block(
    root,
    "#7b6b50",
    world.width / 2,
    -0.37,
    world.height / 2,
    world.width,
    0.74,
    world.height,
  );
  block(
    root,
    "#b59a6b",
    world.width / 2,
    -0.78,
    world.height / 2,
    world.width,
    0.07,
    world.height,
  );
  block(
    root,
    "#718a60",
    world.width / 2,
    -0.04,
    world.height / 2,
    world.width,
    0.08,
    world.height,
  );
  for (let y = 0; y < world.height; y++)
    for (let x = 0; x < world.width; x++) {
      if (x >= world.river.x && x < world.river.x + world.river.width) continue;
      const n = (x * 17 + y * 31 + world.seed) % 4;
      const tile = block(
        root,
        ["#98b779", "#a2bc7d", "#92ac70", "#9bb47a"][n],
        x + 0.5,
        0.008,
        y + 0.5,
        0.995,
        0.02,
        0.995,
      );
      tile.castShadow = false;
    }
  const water = block(
    root,
    "#268b9f",
    world.river.x + world.river.width / 2,
    0.0,
    world.height / 2,
    world.river.width,
    0.035,
    world.height,
  );
  water.material = new T.MeshStandardMaterial({
    color: "#268b9f",
    roughness: 0.23,
    metalness: 0.12,
  });
  water.castShadow = false;
  for (const x of [
    world.river.x - 0.035,
    world.river.x + world.river.width + 0.035,
  ])
    block(
      root,
      "#cdbd87",
      x,
      0.025,
      world.height / 2,
      0.065,
      0.06,
      world.height,
    );
  const waves = new T.Group();
  root.add(waves);
  for (let i = 0; i < 28; i++)
    block(
      waves,
      "#a6e0d5",
      world.river.x + 0.25 + ((i * 0.71) % (world.river.width - 0.5)),
      0.027,
      (i * 0.43) % world.height,
      0.18 + (i % 3) * 0.08,
      0.006,
      0.016,
    );
  const roadsGroup = new T.Group();
  root.add(roadsGroup);
  for (const h of world.houses) house(root, h);
  well(root, world.source);
  const bridges = new Map(
    world.bridges.map((b) => [b.id, bridge(root, world, b)]),
  );
  for (const o of world.obstacles) {
    const stone = mesh(
      root,
      sphere,
      "#83958a",
      o.x + 0.5,
      0.22,
      o.y + 0.5,
      0.46,
      0.35,
      0.4,
    );
    stone.rotation.set(0.2, o.x * 0.2, 0.1);
  }
  for (const t of sceneryFor(world, run)) tree(root, t);
  const agents = run.frames[0].agents.map(() => {
    const group = new T.Group();
    root.add(group);
    const legs = [
      block(group, "#3b5149", -0.06, 0.13, 0, 0.07, 0.25, 0.08),
      block(group, "#3b5149", 0.06, 0.13, 0, 0.07, 0.25, 0.08),
    ];
    const body = mesh(group, cylinder, "#498e9a", 0, 0.36, 0, 0.12, 0.3, 0.1);
    mesh(group, sphere, "#e1b78d", 0, 0.61, 0, 0.11, 0.12, 0.11);
    mesh(group, cylinder, "#4e7860", 0, 0.7, 0, 0.14, 0.045, 0.14);
    const cargo = block(group, "#7cd0c9", 0.16, 0.35, 0, 0.13, 0.19, 0.13);
    return { group, body, legs, cargo };
  });
  const floor = new T.Mesh(
    new T.PlaneGeometry(80, 80),
    new T.ShadowMaterial({ opacity: 0.28 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(world.width / 2, -0.85, world.height / 2);
  floor.receiveShadow = true;
  scene.add(floor);
  const selectedRing = new T.Mesh(
    new T.RingGeometry(0.64, 0.68, 40),
    new T.MeshBasicMaterial({
      color: "#ffe2a0",
      side: T.DoubleSide,
      transparent: true,
      opacity: 0.9,
    }),
  );
  selectedRing.rotation.x = -Math.PI / 2;
  selectedRing.position.y = 0.045;
  root.add(selectedRing);
  waves.children.forEach((wave) => {
    wave.castShadow = false;
  });
  agents.forEach((agent) =>
    agent.group.traverse((part) => {
      if (part.isMesh) part.castShadow = false;
    }),
  );
  return {
    scene,
    camera,
    root,
    sun,
    agents,
    bridges,
    waves,
    selectedRing,
    roads: roadsGroup,
  };
}
export function drawDiorama3D(
  ctx,
  g,
  world,
  run,
  frame,
  next,
  mix,
  options = {},
) {
  if (unsupported) return false;
  try {
    if (!renderer) {
      renderer = new T.WebGLRenderer({
        alpha: true,
        antialias: true,
        preserveDrawingBuffer: true,
        powerPreference: "high-performance",
      });
      renderer.setClearColor(0, 0);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = T.PCFShadowMap;
      renderer.outputColorSpace = T.SRGBColorSpace;
      renderer.toneMapping = T.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.1;
      renderer.domElement.addEventListener("webglcontextlost", () => {
        unsupported = true;
      });
    }
    if (!scenes.has(run)) {
      scenes.set(run, makeScene(world, run, g));
      if (scenes.size > 4) {
        const old = scenes.keys().next().value;
        scenes.get(old).sun.shadow.map?.dispose();
        scenes.delete(old);
      }
    }
    const entry = scenes.get(run);
    const resolution =
      options.pixelRatio ??
      Math.min(2, Math.max(1.5, window.devicePixelRatio ?? 1));
    if (
      renderer.domElement.width !== Math.floor(g.width * resolution) ||
      renderer.domElement.height !== Math.floor(g.height * resolution)
    ) {
      renderer.setPixelRatio(resolution);
      renderer.setSize(g.width, g.height, false);
    }
    Object.assign(entry.camera, boardCameraFrame(g, world).frustum);
    entry.camera.updateProjectionMatrix();
    const time = options.ambientTime ?? options.tick * 0.14 ?? 0;
    entry.waves.children.forEach((wave, i) => {
      wave.position.z = (i * 0.43 + time * 0.16) % world.height;
    });
    for (const [id, b] of entry.bridges) {
      const closed = frame.closedBridgeIds?.includes(id) ?? false;
      if (b.gate.visible !== closed) entry.sun.shadow.needsUpdate = true;
      b.gate.visible = closed;
    }
    for (let i = 0; i < entry.agents.length; i++) {
      const a = frame.agents[i],
        b = next.agents.find((n) => n.id === a.id) ?? a,
        m = entry.agents[i];
      m.group.visible = a.state !== "idle";
      m.group.position.set(
        a.x + (b.x - a.x) * mix + 0.5 + ((i % 3) - 1) * 0.11,
        0,
        a.y + (b.y - a.y) * mix + 0.5 + (Math.floor(i / 3) - 1) * 0.08,
      );
      const walking = a.x !== b.x || a.y !== b.y;
      m.legs.forEach((leg, k) => {
        leg.rotation.x = walking
          ? Math.sin(mix * Math.PI * 2 + k * Math.PI) * 0.6
          : 0;
      });
      m.body.material = material(
        a.waiting ? "#cb963e" : a.state === "outbound" ? "#428d9b" : "#6a967b",
      );
      m.cargo.visible = a.state === "outbound";
    }
    const phase = run.routeChanges?.findLast(
      (p) => p.tick <= Math.floor(options.tick),
    );
    roads(entry, phase?.routes ?? run.routes, options.selected);
    const object = [world.source, ...world.houses, ...world.obstacles].find(
      (o) => o.id === options.selected,
    );
    entry.selectedRing.visible = Boolean(object);
    if (object)
      entry.selectedRing.position.set(object.x + 0.5, 0.045, object.y + 0.5);
    renderer.render(entry.scene, entry.camera);
    ctx.drawImage(renderer.domElement, 0, 0, g.width, g.height);
    return true;
  } catch (error) {
    unsupported = true;
    console.warn(
      "Using the canvas renderer because 3D is unavailable.",
      error.message,
    );
    return false;
  }
}
