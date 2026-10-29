import { judgeKept } from "/shared/kept.js";

const WIDTH = 360;
const HEIGHT = 640;
const CONTROL = { x: 48, y: 470, width: 264, height: 64 };
const SURFACE = { x: 24, y: 250, width: 312, height: 320 };
const BUTTON = [20, 92, 74];
const CARD = [243, 239, 228];

function paint(canvas, button) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  ctx.fillStyle = "#f6f1e7";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = `rgb(${CARD.join(",")})`;
  round(ctx, 24, 168, 312, 420, 28);
  ctx.fill();
  ctx.fillStyle = "#8d8374";
  ctx.font = "16px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText("NORTH MARKET", 48, 220);
  ctx.fillStyle = "#1c2430";
  ctx.font = "28px Georgia, serif";
  ctx.fillText("Two loaves, one jar", 48, 268);
  ctx.fillStyle = "#5c6570";
  ctx.font = "18px Georgia, serif";
  ctx.fillText("Delivery tomorrow", 48, 304);
  ctx.fillStyle = "#1c2430";
  ctx.font = "42px Georgia, serif";
  ctx.fillText("$48", 48, 390);
  ctx.fillStyle = `rgb(${button.join(",")})`;
  round(ctx, CONTROL.x, CONTROL.y, CONTROL.width, CONTROL.height, 16);
  ctx.fill();
  ctx.fillStyle = contrastText(button);
  ctx.font = "22px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText("Pay $48", 132, 510);
}

function round(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function contrastText(rgb) {
  const luminance = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  return luminance > 160 ? "#1c2430" : "#f8f4ea";
}

function mount(title, button, note) {
  const card = document.createElement("article");
  card.className = "card";
  const heading = document.createElement("h2");
  heading.textContent = title;
  const canvas = document.createElement("canvas");
  paint(canvas, button);
  const image = canvas.getContext("2d").getImageData(0, 0, WIDTH, HEIGHT);
  const verdict = judgeKept(
    { data: image.data, width: WIDTH, height: HEIGHT },
    { control: CONTROL, surface: SURFACE, reference: BUTTON },
  );
  const result = document.createElement("p");
  result.className = `verdict ${verdict.passed ? "pass" : "fail"}`;
  result.textContent = `${verdict.passed ? "PASS" : "FAIL"} · ${verdict.checks
    .map((check) => `${check.label}: ${check.actual}`)
    .join(" · ")}`;
  const caption = document.createElement("p");
  caption.textContent = note;
  card.append(heading, canvas, result, caption);
  return card;
}

document
  .getElementById("pair")
  .append(
    mount(
      "The screen you protected",
      BUTTON,
      "Drawn locally. The Pay button is the protected rectangle.",
    ),
    mount(
      "A calmer screen that breaks the rule",
      CARD,
      "Also drawn locally, so you can see the check before spending an image call. This is not a Muse image.",
    ),
  );

async function redesign(mode) {
  const status = document.getElementById("live-status");
  const buttons = [...document.querySelectorAll(".live button")];
  buttons.forEach((button) => (button.disabled = true));
  status.textContent = "Muse Image is redesigning the original screen…";
  try {
    const canvas = document.createElement("canvas");
    paint(canvas, BUTTON);
    const response = await fetch("/api/kept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode,
        imageDataUrl: canvas.toDataURL("image/png"),
      }),
    });
    const body = await response.json();
    if (!response.ok)
      throw new Error(body.error || "The redesign was refused.");
    await showResult(body.imageDataUrl, body.costUsd);
  } catch (error) {
    status.textContent = error.message;
  } finally {
    buttons.forEach((button) => (button.disabled = false));
  }
}

async function showResult(dataUrl, cost, statusText) {
  const image = await load(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, image.width, image.height);
  const scale = (box) => ({
    x: Math.round((box.x / WIDTH) * image.width),
    y: Math.round((box.y / HEIGHT) * image.height),
    width: Math.max(1, Math.round((box.width / WIDTH) * image.width)),
    height: Math.max(1, Math.round((box.height / HEIGHT) * image.height)),
  });
  const control = scale(CONTROL);
  const surface = scale(SURFACE);
  control.width = Math.min(control.width, image.width - control.x);
  control.height = Math.min(control.height, image.height - control.y);
  surface.width = Math.min(surface.width, image.width - surface.x);
  surface.height = Math.min(surface.height, image.height - surface.y);
  const verdict = judgeKept(
    { data: pixels.data, width: image.width, height: image.height },
    { control, surface },
  );
  const slot = document.getElementById("live-slot");
  slot.replaceChildren();
  const view = new Image();
  view.src = dataUrl;
  view.alt = "Muse Image redesign of the checkout";
  const result = document.createElement("p");
  result.className = `verdict ${verdict.passed ? "pass" : "fail"}`;
  result.textContent = `${verdict.passed ? "PASS" : "FAIL"} · contrast ${verdict.checks[0].actual}${
    Number.isFinite(cost) ? ` · $${cost.toFixed(2)}` : ""
  }`;
  slot.append(view, result);
  document.getElementById("live-status").textContent =
    statusText ??
    "Scored from the returned pixels. The protected rectangle was scaled to the image Muse Image actually returned.";
}

function load(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error("The returned image could not be read."));
    image.src = src;
  });
}

document
  .getElementById("calm")
  .addEventListener("click", () => redesign("calm"));
document
  .getElementById("keep")
  .addEventListener("click", () => redesign("keep"));

showResult(
  "/kept/calm.png",
  null,
  "Recorded Muse Image edit. The browser scored these pixels again. No new API call.",
);
