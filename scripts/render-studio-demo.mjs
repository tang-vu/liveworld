import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const capture = path.resolve(
  process.argv[2] ?? path.join(root, ".liveworld/creator-film"),
);
const story = JSON.parse(
  await fs.readFile(
    path.join(
      root,
      process.env.LIVEWORLD_STORYBOARD ?? "demo/creator-storyboard.json",
    ),
    "utf8",
  ),
);
const sources = JSON.parse(
  await fs.readFile(path.join(capture, "sources.json"), "utf8"),
);
const binary = (name) =>
  process.env.LIVEWORLD_FFMPEG_DIR
    ? path.join(
        process.env.LIVEWORLD_FFMPEG_DIR,
        process.platform === "win32" ? `${name}.exe` : name,
      )
    : name;
function run(command, args) {
  const r = spawnSync(binary(command), args, {
    cwd: capture,
    encoding: "utf8",
    maxBuffer: 4_000_000,
  });
  if (r.status !== 0)
    throw new Error(
      (r.stderr ?? r.error?.message ?? "Render failed").slice(-2200),
    );
  return r.stdout;
}
const probe = (file, count = false) =>
  JSON.parse(
    run("ffprobe", [
      "-v",
      "error",
      ...(count ? ["-count_frames"] : []),
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      file,
    ]),
  );
const sha = async (file) =>
  createHash("sha256")
    .update(await fs.readFile(file))
    .digest("hex");
const sourceTypes = [
  "native-replay-export",
  "CUA-screenshot",
  "app-screenshot",
  "engine-evidence-diagram",
];
async function verifyOrigin(name) {
  const origin = sources.sources[name.replace(/\.(webm|jpg)$/, "")];
  if (
    !origin ||
    !sourceTypes.includes(origin.type) ||
    (await sha(path.join(capture, name))) !== origin.sha256
  )
    throw new Error(`Missing or changed actual-source provenance: ${name}`);
  if (
    origin.type === "engine-evidence-diagram" &&
    origin.factsSha256 !==
      (await sha(path.join(capture, "evidence-facts.json")))
  )
    throw new Error(
      "Evidence diagram facts changed; regenerate diagrams and their registry.",
    );
  return origin;
}
const stamp = (seconds) => {
  const n = Math.round(seconds * 1000);
  return `${String(Math.floor(n / 3600000)).padStart(2, "0")}:${String(Math.floor(n / 60000) % 60).padStart(2, "0")}:${String(Math.floor(n / 1000) % 60).padStart(2, "0")},${String(n % 1000).padStart(3, "0")}`;
};
const wrap = (value, width = 70) => {
  const out = [];
  let line = "";
  for (const word of value.split(/\s+/)) {
    if (line && line.length + word.length + 1 > width) {
      out.push(line);
      line = word;
    } else line += (line ? " " : "") + word;
  }
  if (line) out.push(line);
  return out.join("\n");
};
if (story.scenes.reduce((n, s) => n + s.seconds, 0) !== 180)
  throw new Error("Storyboard must total 180 seconds.");
await fs.mkdir(path.join(capture, "render"), { recursive: true });
if (!existsSync(path.join(capture, "font.ttf"))) {
  if (!existsSync("C:/Windows/Fonts/segoeui.ttf"))
    throw new Error("Provide a local font.ttf in the capture directory.");
  await fs.copyFile(
    "C:/Windows/Fonts/segoeui.ttf",
    path.join(capture, "font.ttf"),
  );
}
// Validate all inputs before replacing the completed public movie.
for (const s of story.scenes)
  for (const name of s.shots ?? [s.source])
    await fs.access(path.join(capture, name));
let offset = 0;
const subtitles = [],
  manifest = [];
for (const s of story.scenes) {
  if (!/^[0-9]{2}-[a-z-]+$/.test(s.id)) throw new Error("Invalid scene ID.");
  const source = path.join(capture, s.source),
    input = probe(source, s.kind === "native");
  const video = input.streams.find((v) => v.codec_type === "video");
  const origin = await verifyOrigin(s.source);
  for (const name of s.shots ?? []) {
    const shot = await verifyOrigin(name);
    if (
      !["CUA-screenshot", "app-screenshot", "engine-evidence-diagram"].includes(
        shot.type,
      )
    )
      throw new Error(`Invalid still source: ${name}`);
  }
  if (
    s.kind === "native" &&
    (video.avg_frame_rate !== "30/1" || Number(video.nb_read_frames) < 300)
  )
    throw new Error("Native replay must contain verified 30 fps motion.");
  const audio = probe(s.id + ".wav"),
    speech = Number(audio.format.duration);
  const tempo = Math.max(1, speech / (s.seconds - 0.5));
  if (tempo > 1.16)
    throw new Error(
      `Narration too long: ${s.id}, ${speech}s. Revise the script.`,
    );
  await fs.writeFile(path.join(capture, s.id + "-heading.txt"), s.heading);
  await fs.writeFile(
    path.join(capture, s.id + "-caption.txt"),
    wrap(s.caption, 100),
  );
  let filter;
  const font = "fontfile=font.ttf";
  if (s.kind === "native")
    filter = `scale=1920:1080:flags=lanczos,setsar=1,fps=30,tpad=stop_mode=clone:stop_duration=${s.seconds},trim=duration=${s.seconds},drawbox=x=0:y=1033:w=1920:h=47:color=0x153c2d@0.96:t=fill,drawtext=${font}:textfile=${s.id}-caption.txt:fontsize=22:fontcolor=0xf5f4e9:x=56:y=1044`;
  else if (s.kind === "evidence")
    filter = `scale=1920:1080:flags=lanczos,setsar=1,fps=30`;
  else
    filter = `scale=1760:820:force_original_aspect_ratio=decrease:flags=lanczos,pad=1920:1080:(ow-iw)/2:126:color=0xf3f2e9,setsar=1,fps=30,drawtext=${font}:textfile=${s.id}-heading.txt:fontsize=37:fontcolor=0x173d2c:x=80:y=48,drawtext=${font}:textfile=${s.id}-caption.txt:fontsize=25:fontcolor=0x37563e:x=80:y=980`;
  let inputArgs =
    s.kind === "native" ? ["-i", s.source] : ["-loop", "1", "-i", s.source];
  if (s.shots?.length) {
    // A changing JPEG resolution reinitializes ffmpeg's filter graph and can
    // discard the preceding frames. Normalize before concatenating screenshots
    // with evidence diagrams; all derived stills share one image geometry.
    const prepared = [];
    for (const [index, name] of s.shots.entries()) {
      const normalized = `render/${s.id}-shot-${index}.jpg`;
      run("ffmpeg", [
        "-v",
        "error",
        "-y",
        "-i",
        name,
        "-vf",
        "scale=1760:820:force_original_aspect_ratio=decrease:flags=lanczos,pad=1760:820:(ow-iw)/2:(oh-ih)/2:color=0xf3f2e9",
        "-frames:v",
        "1",
        normalized,
      ]);
      prepared.push(normalized);
    }
    const shotList = prepared.flatMap((name) => [
      `file '${name}'`,
      `duration ${s.seconds / s.shots.length}`,
    ]);
    shotList.push(`file '${prepared.at(-1)}'`);
    await fs.writeFile(
      path.join(capture, s.id + "-shots.ffconcat"),
      shotList.join("\n"),
    );
    inputArgs = ["-f", "concat", "-safe", "0", "-i", s.id + "-shots.ffconcat"];
  }
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    ...inputArgs,
    "-i",
    s.id + ".wav",
    "-vf",
    filter,
    "-af",
    `atempo=${tempo.toFixed(6)},apad,atrim=duration=${s.seconds}`,
    "-t",
    String(s.seconds),
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
    `render/${s.id}.mp4`,
  ];
  run("ffmpeg", args);
  const words = s.narration.split(/\s+/),
    spoken = speech / tempo;
  for (let i = 0; i < words.length; i += 13) {
    const end = Math.min(words.length, i + 13);
    subtitles.push(
      `${subtitles.length + 1}\n${stamp(offset + (spoken * i) / words.length)} --> ${stamp(offset + (spoken * end) / words.length)}\n${wrap(words.slice(i, end).join(" "), 53)}\n`,
    );
  }
  manifest.push({
    id: s.id,
    seconds: s.seconds,
    source: s.source,
    shots: s.shots ?? null,
    shotTypes:
      s.shots?.map(
        (name) => sources.sources[name.replace(/\.(webm|jpg)$/, "")].type,
      ) ?? null,
    sourceType: origin.type,
    sourceSha256: origin.sha256,
    evidenceFactsSha256: origin.factsSha256 ?? null,
    sourceFrames:
      s.kind === "native"
        ? Number(video.nb_read_frames)
        : (s.shots?.length ?? 1),
    sourceFrameRate: video.avg_frame_rate,
    narrationSeconds: speech,
    tempo,
  });
  offset += s.seconds;
  console.log(`Rendered ${s.id}: ${s.seconds}s, ${origin.type}.`);
}
const srt = subtitles.join("\n");
await fs.writeFile(path.join(root, "demo/liveworld-demo.srt"), srt);
await fs.writeFile(
  path.join(root, "public/demo/liveworld-demo.vtt"),
  "WEBVTT\n\n" +
    srt.replace(/^\d+\n/gm, "").replace(/(\d\d:\d\d:\d\d),(\d\d\d)/g, "$1.$2"),
);
await fs.writeFile(
  path.join(capture, "movie.ffconcat"),
  story.scenes.map((s) => `file 'render/${s.id}.mp4'`).join("\n"),
);
const out = path.join(capture, "render/liveworld-demo.mp4");
const publishedVideo = path.join(root, "public/demo/liveworld-demo.mp4");
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
  "movie.ffconcat",
  "-i",
  path.join(root, "demo/liveworld-demo.srt"),
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
  "title=LiveWorld — Small world. Big what if.",
  "-metadata",
  "artist=Tang Vu",
  "-metadata",
  "comment=Actual UI captures, native simulation replays and the exported report. Synthetic inputs and narration. Recorded Meta outputs labelled.",
  out,
]);
const result = probe(out, true),
  v = result.streams.find((s) => s.codec_type === "video");
if (
  v.width !== 1920 ||
  v.height !== 1080 ||
  v.avg_frame_rate !== "30/1" ||
  Number(result.format.duration) > 180 ||
  Number(result.format.duration) < 179.8 ||
  !result.streams.some((s) => s.codec_type === "audio") ||
  !result.streams.some((s) => s.codec_type === "subtitle")
)
  throw new Error("Final video failed dimensions, timing or track checks.");
await fs.copyFile(out, publishedVideo);
await fs.writeFile(
  path.join(root, "demo/render-manifest.json"),
  JSON.stringify(
    {
      format: "liveworld-demo-render-v3",
      storyboard:
        process.env.LIVEWORLD_STORYBOARD ?? "demo/creator-storyboard.json",
      durationSeconds: Number(result.format.duration),
      width: v.width,
      height: v.height,
      frameRate: v.avg_frame_rate,
      frames: Number(v.nb_read_frames),
      videoSha256: await sha(out),
      disclosures: story.disclosures,
      scenes: manifest,
    },
    null,
    2,
  ) + "\n",
);
spawnSync(
  process.execPath,
  [
    path.join(root, "node_modules/prettier/bin/prettier.cjs"),
    "--write",
    path.join(root, "demo/render-manifest.json"),
  ],
  { stdio: "inherit" },
);
run("ffmpeg", [
  "-v",
  "error",
  "-y",
  "-ss",
  "6",
  "-i",
  out,
  "-frames:v",
  "1",
  path.join(root, "public/demo/poster.jpg"),
]);
console.log(
  JSON.stringify({
    video: publishedVideo,
    durationSeconds: result.format.duration,
    frameRate: v.avg_frame_rate,
    frames: v.nb_read_frames,
    bytes: (await fs.stat(out)).size,
  }),
);
