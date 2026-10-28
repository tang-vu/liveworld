# Submission draft

Owner: Tang Vu. Track: Indie Developer. Theme: Build for Your World.

## Project description

LiveWorld turns objects on a desk into a small playable logistics world. A cup can become a water source, blocks become homes and wooden sticks become bridges. I built it for game creators who want to investigate the effect of a layout or rule change without editing simulation code for every experiment.

Muse Spark proposes object roles and locations; SAM 3.1 supplies the segmentation masks. The creator reviews those suggestions. Muse Spark also translates supported rule instructions into validated proposals and acts as a playtester, inspecting traces and running constrained experiments. A deterministic simulator computes every delivery, missed deadline and queue. The model cannot certify its own success.

Creators can rescan a changed tabletop, schedule a bridge closure or production pause, compare A and B, apply a candidate, return to checkpoints and save a portable project. Imported trials are recomputed. Evidence exports retain the inputs and measurements; the studio can also render a 1080p replay clip with its reproducible inputs.

This prototype has not been validated in a creator study. Its photo mapping uses a fixed grid and heuristic object matching, rather than metric reconstruction. The included generated images are labelled synthetic; they are not real camera tests.

## What was built during the event

This repository began on October 27, 2026. The world format, simulator, studio, orthographic 3D renderer and canvas fallback, photo-to-grid mapping, object tracking, Meta API integration, agent tools, timed mechanics, rule validation, project persistence, evidence exports, replay composition and budget controls were developed for LiveWorld during the event. No Keryx application code is included.

Meta provides Muse Spark, SAM 3.1 and the official `@meta-sam/parser` dependency. The tabletop example images are generated test assets; their prompts and limitations are recorded in `public/examples/generated-inputs.json`. Replay media packaging uses Mediabunny; 3D rendering uses Three.js. These unmodified libraries are identified in `THIRD_PARTY_NOTICES.md`. Existing models and dependencies are not original project contributions.

## Reproducible examples

1. **Authored valley playtest.** Replay the recorded Meta run. Balanced dispatch is a failed proposal: 14 of 24 units arrive on time, compared with 20 originally. Moving the south bridge to zero-based row 6 produces 24 of 24 on time. Bridge waiting increases from 16 to 22 turns. The app retains that tradeoff.
2. **Generated photo A/B.** Capture dialog → Replay recorded A/B capture. The saved outputs came from real Muse Spark and SAM requests on generated inputs. All 11 identities are retained, ten grid positions are unchanged and one bridge moves from row 10 to row 7. On-time delivery remains 20/24; waiting falls from 22 to 10 turns and completion from 99 to 91. This is an improvement in waiting, not a deadline success.
3. **Timed rule design.** Write a game rule → Explore a recorded rule experiment. Muse Spark compiled “Close the north bridge from turn 25 through turn 50.” Only B gains that schedule. On-time delivery falls from 20/24 to 16/24; this is a creator design change, not a repair. The recorded playtest under the closure reaches 22/24 with the same schedule, and remains not solved. Open `public/examples/closed-crossing-repairs-project.json` to inspect it.
4. **Rule interpretation check.** Six predeclared English requests on renamed authored layouts, one attempt each: all six matched the expected semantics or refused the unsupported/ambiguous request. The saved evaluation includes cases for retaining an existing schedule, removing one event, and overriding a named home. This is a small integration evaluation, not a general accuracy benchmark.

The recorded runs are explicitly labelled and do not call Meta again. Use the live buttons to run new inference. Each paid operation goes through the same local budget ledger.

## What the reviewer can inspect

- The original and proposed worlds replay in sync, with full-run outcomes distinguished from current-turn deliveries.
- Failed proposals remain visible. Success is calculated by code, and a limited search is not called globally optimal.
- `search_one_edit` is a systematic simulation search. Meta interprets design intent and orchestrates the supported tools; the solver's contribution is explicit.
- A project file can be opened without a key; imported success claims are discarded and recomputed.
- Local budget accounting reserves before inference, retains usage across restarts and stops after an uncertain charge. It does not replace the provider's billing controls.

The recording follows a complete design/playtest loop. Its exact scenes and timings are in `demo/storyboard.json`; native replay frames and actual UI screenshots are identified separately in the render manifest.

## Items required before submission

- The [three-minute video](../public/demo/liveworld-demo.mp4) is available with [recording details](../demo/README.md); review it before submitting.
- Verify the full Official Rules, including any required tool or asset disclosures. On October 28, the participant details URL redirected to CV login, so those full terms could not be inspected in this browser session.
- Run a physical tabletop capture test if presenting physical interaction as demonstrated.
- Local delivery was selected. If a hosted review URL is later required, approve a target and deploy the prepared backend; no public URL has been created.
- Ensure the final public commit and its checks are accessible.
- Fill in final video/live links, confirm the participant list and submit through the event platform before the deadline.

Repository: https://github.com/tang-vu/liveworld

Submission deadline from the supplied participant guide: November 4, 2026 at 9:00 PM Eastern Time, equivalent to November 5 at 9:00 AM in Vietnam. Confirm the event page for changes before submitting.
