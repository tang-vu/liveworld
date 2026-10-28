# Three-minute local demo

The finished video is [`public/demo/liveworld-demo.mp4`](../public/demo/liveworld-demo.mp4). It is 1920×1080, approximately 180 seconds, with English narration and an embedded English subtitle track. After starting the app, open **http://127.0.0.1:4173/demo/** for the local player and optional English subtitles.

This is an edited capture of the actual application. Tabletop input images are generated and labelled synthetic. The segmentation scene uses an actual Meta response. The valley playtest scenes replay the saved Meta run and are labelled as recordings. The rule instruction scene uses a new live Meta proposal. Generic synthetic narration was generated locally with an installed Windows voice; it is not a recording or imitation of the builder's voice.

| Start | Scene                                                  |
| ----- | ------------------------------------------------------ |
| 00:00 | Generated tabletop input and role confirmation         |
| 00:15 | Actual Muse Spark + SAM segmentation                   |
| 00:35 | Deterministic world replay                             |
| 00:51 | Recorded photo A/B comparison; deadlines still missed  |
| 01:10 | Authored valley baseline: 20/24 on time                |
| 01:25 | Failed recorded Meta proposal: 14/24                   |
| 01:40 | Verified recorded bridge fix: 24/24, with more waiting |
| 02:00 | Plain-language creator rule instruction                |
| 02:10 | Validated six-to-eight courier preview                 |
| 02:23 | Apply a candidate and retain checkpoints               |
| 02:38 | Save and reopen a project; measurements recomputed     |
| 02:50 | Export review evidence                                 |

The video demonstrates this fixed-grid prototype, rather than physical camera reliability, productivity gains or a general game engine. Model waiting time is omitted. The narrated measurements are scoped to the particular examples shown.

`example-project.json` is an actual UI export with eight-courier rules, checkpoints and 22 local trials. Open it in LiveWorld to recompute the results. `example-report.html` is the corresponding report exported from the application after reopening that project. These examples are separate from the six-courier recorded Meta challenge shown earlier in the video.

## Rebuild the edit

`storyboard.json` contains the timings, narration and summary captions. `liveworld-demo.srt` contains the English subtitles. `render-manifest.json` records the output dimensions, duration and source frame counts.

The original interface captures remain in ignored `.liveworld/demo-capture/`; they were taken through the browser's computer-use screenshot API. No invented screenshot or generated UI frame is used. Rebuilding the edit requires those captures, FFmpeg/FFprobe on `PATH`, and narration WAV files. On Windows, `powershell -NoProfile -File scripts/render-demo-voice.ps1` creates the narration locally from the installed generic voice. Then run `node scripts/render-demo.mjs` to encode and verify the final MP4. Other platforms can supply equivalent local WAV files and a local `font.ttf` in the capture directory.

The renderer verifies duration, resolution and audio/subtitle tracks. Visual review still matters: inspect the model masks, A/B metrics, failed trial, verified fix and final evidence view before using the video in a submission.
