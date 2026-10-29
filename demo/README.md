# Three-minute local demo

The current film is [public/demo/liveworld-demo.mp4](../public/demo/liveworld-demo.mp4): 1920×1080, 30 fps, 179.988 seconds, with English synthetic narration and embedded subtitles. Start the app and open **http://127.0.0.1:4173/demo/** for the chapter player.

The film follows **one synthetic tabletop world** through a creator's fairness brief, a failed moved-stick rescan, verified balanced dispatch, delivery receipts, sensitivity and project handoff. Its result is **20/24 on time, seven waiting turns, and at least three on time at every home**. Four units still arrive late. It does not borrow the authored valley's 24/24 result.

The edit combines actual studio screenshots, native simulation replay exports and the exported measurement report. Household comparison, delivery receipts, the turn-84 replay and the stress test are captured from the running local studio. Input images are generated; Meta outputs are recorded and recomputed. Inference waiting is omitted. This authored showcase is not a physical-camera test, held-out benchmark or creator productivity study.

| Start | Scene                                                                |
| ----- | -------------------------------------------------------------------- |
| 00:00 | Same total; minimum home on-time changes 0 → 3                       |
| 00:12 | Generated tabletop and confirmed fixed-grid world                    |
| 00:30 | Meta translation into the creator's 20/3/10 brief                    |
| 00:48 | Moved stick reduces waiting but transfers four late units            |
| 01:08 | Studio delivery receipt, then the turn-84 replay with its courier    |
| 01:30 | Recorded Meta playtest: balanced dispatch meets the brief            |
| 01:52 | Studio stress test: nominal passes, both neighboring placements fail |
| 02:12 | Save, reopen, and the exported report: A fails the brief, B passes   |
| 02:40 | Scope, authorship and next validation                                |

`creator-storyboard.json` is the current edit. `storyboard.json` records the earlier valley film. `creator-example-project.json` preserves the exact UI download used in the sharing scene; it was opened again in the actual app. `public/examples/creator-brief-project.json` is the reproducible recorded-study package. The corresponding report is available as standalone `creator-brief-report.html` and as public HTML/CSS under `public/examples/` for the app's strict content policy. Imported results are recalculated and source labels do not authenticate provider activity.

## Rebuild and verify

The current raw sources, registry, narration WAVs and prepared scenes are in ignored `.liveworld/creator-film/`. Older valley captures remain separately in `.liveworld/studio-film/`. These private source captures are not required to run the app or watch the bundled MP4.

`scripts/render-creator-evidence.mjs` recomputes the diagram facts and calls the Pillow renderer. It requires a local Segoe UI font on the recording machine; that font file is not shipped in the repository. The native 1080p clips were rendered and downloaded through the actual replay-export UI. Each still and replay has a source hash; diagram records also retain their facts hash.

The film renderer checks source hashes, native frame timing, narration length, final duration, dimensions and tracks. Mixed-resolution stills are normalized before concatenation so ffmpeg cannot drop a preceding shot when its filter graph reinitializes. The final MP4 is copied to the public player only after verification.

```powershell
$env:LIVEWORLD_FFMPEG_DIR = 'D:\Apps\FFmpeg-9.0.2\bin'
node scripts/render-demo.mjs
node scripts/check-creator-film.mjs --contact
```

`render-demo.mjs` defaults to the current creator storyboard and capture directory. Set `LIVEWORLD_STORYBOARD=demo/storyboard.json` and pass `.liveworld/studio-film` only to rebuild the older edit. `render-demo-voice.ps1` supports a storyboard and capture directory; do not change execution policy to run it. The current WAVs were synthesized locally with the installed generic Microsoft Zira voice.

`render-manifest.json` records the final hash, frame counts and source types. `liveworld-demo.srt` and the public VTT match the narration. Review the contact sheet and representative frames before using the movie in a submission.
