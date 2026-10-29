import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
const read = async (name) =>
  JSON.parse(await readFile(new URL("../" + name, import.meta.url), "utf8"));
const story = await read("demo/creator-storyboard.json"),
  manifest = await read("demo/render-manifest.json");
const video = new URL("../public/demo/liveworld-demo.mp4", import.meta.url);
const hash = createHash("sha256")
  .update(await readFile(video))
  .digest("hex");
assert.equal(hash, manifest.videoSha256);
assert.equal(manifest.storyboard, "demo/creator-storyboard.json");
assert.equal(
  story.scenes.reduce((n, s) => n + s.seconds, 0),
  180,
);
assert.equal(manifest.scenes.length, story.scenes.length);
assert.equal(manifest.frames, 5399);
assert.equal(manifest.frameRate, "30/1");
assert.ok(manifest.durationSeconds > 179.8 && manifest.durationSeconds <= 180);
const captions = (
  await readFile(new URL("../demo/liveworld-demo.srt", import.meta.url), "utf8")
)
  .split(/\r?\n/)
  .filter(
    (line) => line.trim() && !/^\d+$/.test(line) && !line.includes(" --> "),
  )
  .join(" ")
  .replace(/\s+/g, " ")
  .trim();
assert.equal(
  captions,
  story.scenes
    .map((s) => s.narration)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim(),
);
const player = await readFile(
  new URL("../public/demo/index.html", import.meta.url),
  "utf8",
);
const chapters = [...player.matchAll(/data-seconds="(\d+)"/g)].map((x) =>
  Number(x[1]),
);
let start = 0;
assert.deepEqual(
  chapters,
  story.scenes.map((s) => {
    const n = start;
    start += s.seconds;
    return n;
  }),
);
const screenshotTypes = new Set(["CUA-screenshot", "app-screenshot"]);
let diagramScenes = 0;
for (let i = 0; i < story.scenes.length; i++) {
  assert.equal(manifest.scenes[i].id, story.scenes[i].id);
  assert.equal(manifest.scenes[i].seconds, story.scenes[i].seconds);
  if (story.scenes[i].kind === "evidence") {
    diagramScenes += 1;
    assert.equal(manifest.scenes[i].sourceType, "engine-evidence-diagram");
  }
  if (story.scenes[i].kind === "ui")
    assert.ok(screenshotTypes.has(manifest.scenes[i].sourceType));
}
assert.equal(
  story.disclosures.some((line) => /diagram/i.test(line)),
  diagramScenes > 0,
);
if (process.argv.includes("--contact")) {
  const ffmpeg = process.env.LIVEWORLD_FFMPEG_DIR
    ? join(
        process.env.LIVEWORLD_FFMPEG_DIR,
        process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
      )
    : "ffmpeg";
  const directory = new URL(
    "../.liveworld/creator-film/review/",
    import.meta.url,
  );
  await mkdir(directory, { recursive: true });
  const { fileURLToPath } = await import("node:url");
  const run = (args) => {
    const r = spawnSync(ffmpeg, ["-v", "error", "-y", ...args], {
      encoding: "utf8",
    });
    assert.equal(r.status, 0, r.stderr);
  };
  for (const [i, time] of [6, 22, 38, 60, 79, 101, 122, 151, 169].entries())
    run([
      "-ss",
      String(time),
      "-i",
      fileURLToPath(video),
      "-vf",
      "scale=640:360",
      "-frames:v",
      "1",
      fileURLToPath(new URL(`frame-${i + 1}.jpg`, directory)),
    ]);
  run([
    "-framerate",
    "1",
    "-i",
    join(fileURLToPath(directory), "frame-%d.jpg"),
    "-vf",
    "tile=3x3",
    "-frames:v",
    "1",
    fileURLToPath(new URL("contact.jpg", directory)),
  ]);
}
console.log(
  JSON.stringify({
    videoHashMatches: true,
    frames: manifest.frames,
    frameRate: manifest.frameRate,
    duration: manifest.durationSeconds,
    chapters: chapters.length,
    transcriptMatches: true,
    diagramScenes,
  }),
);
