import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const story = JSON.parse(
  await readFile(join(root, "demo/storyboard.json"), "utf8"),
);
const capture = resolve(
  process.argv[2] ?? join(root, ".liveworld/demo-capture"),
);
const out = join(root, "public/demo/liveworld-demo.mp4");
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: capture,
    encoding: "utf8",
    maxBuffer: 8_000_000,
    ...options,
  });
  if (result.status !== 0)
    throw new Error(
      `${command} failed: ${(result.stderr ?? result.error?.message ?? "").slice(-2500)}`,
    );
  return result.stdout;
};
const probe = (path) =>
  JSON.parse(
    run("ffprobe", [
      "-v",
      "error",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      path,
    ]),
  );
const stamp = (seconds) => {
  const ms = Math.round(seconds * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};
const wrap = (text, limit = 78) => {
  const lines = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (line && line.length + word.length + 1 > limit) {
      lines.push(line);
      line = word;
    } else line += (line ? " " : "") + word;
  }
  if (line) lines.push(line);
  return lines.join("\n");
};
await mkdir(join(capture, "render"), { recursive: true });
if (process.platform === "win32")
  await copyFile("C:/Windows/Fonts/segoeui.ttf", join(capture, "font.ttf"));
// A local font is only used to rasterize text into the video; it is not shipped.
const font = "fontfile=font.ttf";
let offset = 0;
const subtitles = [];
const manifest = [];
if (story.scenes.reduce((sum, s) => sum + s.seconds, 0) !== 180)
  throw new Error("Demo must be exactly 180 seconds.");
for (const scene of story.scenes) {
  if (!/^[0-9]{2}-[a-z-]+$/.test(scene.id))
    throw new Error("Invalid capture scene ID.");
  const timing = JSON.parse(
    await readFile(join(capture, scene.id, "frames.json"), "utf8"),
  );
  if (timing.frames.length < 1 || !timing.source.includes("CUA"))
    throw new Error(`Missing actual UI capture for ${scene.id}.`);
  const list = [];
  for (let i = 0; i < timing.frames.length; i++) {
    const frame = timing.frames[i];
    if (!/^frame-[0-9]{4}\.jpg$/.test(frame.file))
      throw new Error("Invalid frame path.");
    const next = timing.frames[i + 1]?.atMs ?? timing.elapsedMs;
    if (next <= frame.atMs)
      throw new Error("Capture timestamps must increase.");
    list.push(
      `file '${scene.id}/${frame.file}'`,
      `duration ${((next - frame.atMs) / 1000).toFixed(4)}`,
    );
  }
  list.push(`file '${scene.id}/${timing.frames.at(-1).file}'`);
  await writeFile(join(capture, scene.id + ".ffconcat"), list.join("\n"));
  await writeFile(join(capture, scene.id + "-heading.txt"), scene.heading);
  await writeFile(
    join(capture, scene.id + "-caption.txt"),
    wrap(scene.caption),
  );
  const audio = probe(scene.id + ".wav");
  const narrationSeconds = Number(audio.format.duration);
  if (!Number.isFinite(narrationSeconds) || narrationSeconds <= 0)
    throw new Error("Missing narration audio.");
  const tempo = Math.max(1, narrationSeconds / (scene.seconds - 0.7));
  if (tempo > 1.15)
    throw new Error(`Narration is too long for ${scene.id}; revise the text.`);
  const videoFilter = `scale=1760:820:force_original_aspect_ratio=decrease:flags=lanczos,pad=1920:1080:(ow-iw)/2:110:color=0xf3f2eb,setsar=1,fps=30,tpad=stop_mode=clone:stop_duration=${scene.seconds},trim=duration=${scene.seconds},drawtext=${font}:textfile=${scene.id}-heading.txt:fontsize=36:fontcolor=0x2e3c2e:x=80:y=44,drawtext=${font}:textfile=${scene.id}-caption.txt:fontsize=30:fontcolor=0x34543b:x=80:y=959:line_spacing=7,drawtext=${font}:text='LIVEWORLD / EDITED UI CAPTURE / SYNTHETIC INPUTS':fontsize=17:fontcolor=0x66725e:x=80:y=16`;
  run("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    scene.id + ".ffconcat",
    "-i",
    scene.id + ".wav",
    "-vf",
    videoFilter,
    "-af",
    `atempo=${tempo.toFixed(5)},apad,atrim=duration=${scene.seconds}`,
    "-t",
    String(scene.seconds),
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-ar",
    "48000",
    "-ac",
    "2",
    `render/${scene.id}.mp4`,
  ]);
  const words = scene.narration.split(/\s+/);
  const spoken = narrationSeconds / tempo;
  for (let i = 0; i < words.length; i += 14) {
    const end = Math.min(words.length, i + 14);
    subtitles.push(
      `${subtitles.length + 1}\n${stamp(offset + (spoken * i) / words.length)} --> ${stamp(offset + (spoken * end) / words.length)}\n${wrap(words.slice(i, end).join(" "), 52)}\n`,
    );
  }
  manifest.push({
    id: scene.id,
    seconds: scene.seconds,
    frames: timing.frames.length,
    captureSeconds: timing.elapsedMs / 1000,
    narrationSeconds,
    tempo,
  });
  offset += scene.seconds;
  console.log(
    `Rendered ${scene.id}: ${scene.seconds}s, ${timing.frames.length} actual UI frames.`,
  );
}
await writeFile(
  join(capture, "video.ffconcat"),
  story.scenes.map((s) => `file 'render/${s.id}.mp4'`).join("\n"),
);
await writeFile(join(root, "demo/liveworld-demo.srt"), subtitles.join("\n"));
run("ffmpeg", [
  "-hide_banner",
  "-loglevel",
  "error",
  "-y",
  "-f",
  "concat",
  "-safe",
  "0",
  "-i",
  "video.ffconcat",
  "-i",
  join(root, "demo/liveworld-demo.srt"),
  "-map",
  "0:v:0",
  "-map",
  "0:a:0",
  "-map",
  "1:0",
  "-c:v",
  "copy",
  "-c:a",
  "copy",
  "-c:s",
  "mov_text",
  "-metadata:s:s:0",
  "language=eng",
  "-t",
  "179.9",
  "-movflags",
  "+faststart",
  "-metadata",
  "title=LiveWorld — tabletop systems, verified",
  "-metadata",
  "artist=Tang Vu",
  "-metadata",
  "comment=Edited actual application capture. AI-generated input images. Synthetic narration. Recorded Meta runs are labelled.",
  out,
]);
const result = probe(out);
const video = result.streams.find((s) => s.codec_type === "video");
if (
  video.width !== 1920 ||
  video.height !== 1080 ||
  Number(result.format.duration) > 180 ||
  Number(result.format.duration) < 179.8 ||
  !result.streams.some((s) => s.codec_type === "audio") ||
  !result.streams.some((s) => s.codec_type === "subtitle")
)
  throw new Error(
    "The exported video failed duration, resolution or track checks.",
  );
await writeFile(
  join(root, "demo/render-manifest.json"),
  JSON.stringify(
    {
      format: "liveworld-demo-render-v1",
      durationSeconds: Number(result.format.duration),
      videoSha256: createHash("sha256")
        .update(await readFile(out))
        .digest("hex"),
      width: video.width,
      height: video.height,
      disclosures: story.disclosures,
      scenes: manifest,
    },
    null,
    2,
  ),
);
console.log(
  "Verified three-minute 1080p MP4 with audio and English subtitles.",
);
