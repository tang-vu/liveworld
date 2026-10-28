# Three-minute local demo

The finished video is [`public/demo/liveworld-demo.mp4`](../public/demo/liveworld-demo.mp4). It is 1920×1080, approximately 180 seconds, with English narration and an embedded English subtitle track. After starting the app, open **http://127.0.0.1:4173/demo/** for the local player and optional English subtitles.

The movie combines actual application screenshots with native simulation replay exports encoded at 30 fps. Tabletop input images are generated and labelled synthetic. Segmentation uses an actual Muse Spark and SAM response. Playtests and the timed rule proposal use saved Meta outputs, with recording labels visible. Generic English narration was synthesized locally with an installed Windows voice.

| Start | Scene                                                   |
| ----- | ------------------------------------------------------- |
| 00:00 | One bridge change: 20/24 → 24/24 on time                |
| 00:12 | Generated tabletop input                                |
| 00:22 | Actual masks, role review and the resulting photo world |
| 00:36 | Switch to the authored valley: 20/24 on time            |
| 00:54 | Failed recorded hypothesis: balanced dispatch, 14/24    |
| 01:12 | Verified bridge repair: 24/24, with more waiting        |
| 01:36 | Timed rule: close the north crossing, 20/24 → 16/24     |
| 01:58 | Playtest under that closure: 16/24 → 22/24, not solved  |
| 02:16 | Save, reopen and share reproducible evidence            |
| 02:40 | Scope, attribution and the next validation step         |

The video demonstrates this fixed-grid prototype, rather than physical camera reliability, productivity gains or a general game engine. Model waiting time is omitted. The narrated measurements are scoped to the particular examples shown.

`example-project.json` is the actual six-courier UI export shown in the sharing scene. It retains two checkpoints, 22 trials and the selected 24/24 candidate. Open it in LiveWorld to recompute the results. `example-report.html` is the corresponding report exported after reopening that project. The same review kit is available from the local video page as downloadable project inputs and a styled report.

## Rebuild the edit

`storyboard.json` contains the timings, narration and summary captions. `liveworld-demo.srt` contains the English subtitles. `render-manifest.json` records the output dimensions, duration and source frame counts.

The original screenshots, native WebM exports, source hashes and narration WAVs remain in ignored `.liveworld/studio-film/`. These source captures are not required to run the app or watch the bundled movie. The renderer checks each source hash and checks that native replay inputs contain 30 fps video. The manifest identifies still images and native replays separately.

Rebuilding requires those original captures plus FFmpeg and FFprobe on `PATH` (or in `LIVEWORLD_FFMPEG_DIR`). On Windows, `scripts/render-demo-voice.ps1` creates the narration from an installed generic voice if the machine's existing script policy permits it. Do not change that policy for this task; existing WAVs or equivalent locally generated narration can be supplied. Run `node scripts/render-demo.mjs` to encode and verify the MP4. The capture directory defaults to `.liveworld/studio-film/` and can be passed as the first argument. A `font.ttf` in that directory is used, or the renderer copies Windows Segoe UI when available.

The renderer verifies duration, resolution and audio/subtitle tracks. Visual review still matters: inspect the model masks, A/B metrics, failed trial, verified fix and final evidence view before using the video in a submission.
