# LiveWorld

**Build a world on your desk. Find what breaks. Test the fix.**

LiveWorld is a tabletop prototyping and playtesting workbench for small logistics games. Arrange ordinary objects, confirm their roles, and turn them into a playable 2D world. Ask a Meta-powered agent to investigate missed deadlines, test constrained changes, and compare the results from the same starting state.

Built by Tang Vu for the Meta Global AI Developer Hackathon 2026, Indie Developer track.

![LiveWorld workbench showing a recorded Meta playtest and a verified A/B comparison](docs/workbench.jpg)

## Run locally

Requires Node.js 24 or later. No GPU or database is required.

```sh
npm install
npm start
```

Open **http://127.0.0.1:4173**. The included example worlds, replay, dragging, and **Try local changes** work without a key and make no model calls.

To enable Meta, copy `.env.example` to `.env.local` and set `MODEL_API_KEY`. On Windows PowerShell:

```powershell
Copy-Item .env.example .env.local
npm.cmd start
```

If a configured `.env.local` already exists, preserve it rather than copying over it. Restart the server after changing environment settings. The key is read only by the local backend. Never put it in browser code or commit it.

## Try the first experiment

1. Open **The little valley**. All six homes are connected, but some water deliveries miss their deadlines.
2. Play or scrub the replay. Select a home to highlight its route; replay a deadline event to inspect the relevant turn.
3. Select **Find & test a fix** for a real Muse Spark playtest, or **Try local changes** for an explicitly labelled deterministic search without API usage.
4. Compare a tested candidate against the original. Every trial starts from the original world; changes do not accumulate between trials.
5. Export the experiment to retain the world, measurements, tested changes, and verification result.

**Replay a recorded Meta run** loads an actual Muse Spark experiment without making new API calls. Every trial's measurements are recomputed in the browser before display. It is explicitly labelled as a recording; it is not presented as a live model call.

The default scene is an authored example, not a general benchmark. Changing the dispatch policy to balanced service is a plausible failed proposal. Moving the south bridge to zero-based row 6 meets the example's deadlines while increasing bridge waiting time: the comparison preserves that tradeoff.

## Use your own table

Choose **Capture your table**, select a photo or capture a camera frame, and then select **Find objects**. This sends the resized image to Meta:

- **Muse Spark 1.3** proposes object locations and tentative source / house / bridge / obstacle roles using structured output.
- **SAM 3.1** segments the proposed objects using box prompts. Actual returned masks are drawn over the photo; missing masks are not presented as successful segmentations.
- You review the roles before building the world.

This prototype uses image-relative coordinates snapped to a fixed 18×12 grid with a predefined river. Bridge anchors map to the river, and overlapping objects move to nearby valid cells. Review those placements. This is not metric reconstruction or a physics model. Rescans match nearby objects of the same confirmed role heuristically; inspect the result, especially after large moves or occlusion.

## Agent and verification

Muse Spark can inspect baseline events, call `test_change` for a hypothesis, and use `search_one_edit` to systematically search bridge positions or dispatch policies. Each trial may change **one dispatch policy or move one existing bridge**. Couriers, production, households, demand, deadlines, and bridge capacity are locked during playtesting. This initial version checks the explicit objective of delivering every unit by its household deadline; it does not compile arbitrary game mechanics.

The simulator independently computes paths, movement, bridge queues, water accounting, deliveries, deadlines, and the final verdict. A model's written claim cannot change the verified success flag. The best candidate means the best among evaluated candidates, not a globally optimal solution. An unsuccessful limited search is not proof of impossibility.

The agent uses at most 6 model turns and 32 distinct simulated candidates per run. A bounded search reports whether it covered its selected search space. Local simulation does not use API credits.

## Budget controls

- Project total: **$150**; initial cumulative development phase: **$10**; protected reserve: **$50**.
- Before each Spark call, the backend reserves the published cost of a full 1,048,576-token input context plus its capped output. It settles against reported token usage afterward, conservatively ignoring input-cache discounts.
- SAM image requests reserve the published per-image cost.
- The local ledger survives restarts and uses an exclusive lock for updates. Pending calls keep their reservations.
- There are no automatic model retries. Missing usage or uncertain transport failures pause further paid requests for review.
- The ledger counts calls made by this app. It does not know the Meta account balance or spending by another application. Pricing must be rechecked if models or provider prices change.

Local records are in ignored `.liveworld/`: `usage.json` contains reservations and usage receipts; `runs/` contains completed playtests. Do not delete the ledger to bypass a limit. Billing shown by Meta remains authoritative.

## Checks

```sh
npm test
npm run evaluate
npm run check:config
```

These commands make no paid requests. Tests cover deterministic replays, resource conservation, bridge capacity, disconnected worlds, impossible deadlines, patch constraints, independent verification, and budget failure cases.

`node scripts/smoke-meta.mjs` is a separate, explicitly paid one-request connectivity check, using the same budget gate.

`node scripts/check-local.mjs` checks a running local server, including private-file isolation and cross-origin request rejection, without paid API calls. `node scripts/check-scan.mjs` is an explicitly paid Spark + SAM integration check using an original synthetic test image, not a real camera evaluation.

## Repository map

- `shared/`: world validation, constrained patches, pathfinding, simulation, measurements.
- `src/`: Meta integration, agent loop, persistent budget ledger.
- `public/`: workbench, canvas renderer, capture and role review.
- `server.mjs`: loopback-only HTTP backend. It does not serve environment files or private usage records.
- `tests/`: offline tests; no real API key required.
- `scripts/`: evaluation and configuration checks.

## Event scope and references

This repository was started during the hackathon on October 27, 2026. Its simulator, workbench, budget controls, and agent integration were developed for this project. It does not reuse Keryx code. Existing platform capabilities are Meta's models and the official `@meta-sam/parser` dependency; generated segmentation masks are model outputs.

The verification design was informed by Meta's [legal-agent workshop](https://github.com/meta-models/legal-agent-workshop), particularly checks outside agent control and replayable experiments. Workshop application code and legal-case assets are not copied here.

Technical references: [Meta tool calling](https://dev.meta.ai/docs/tool-calling), [structured output](https://dev.meta.ai/docs/structured-output), [SAM client libraries](https://dev.meta.ai/docs/sam/client-libraries), and [published pricing](https://dev.meta.ai/docs/pricing-rate-limits).

This is an early local prototype, not a finished hackathon submission. Real tabletop capture, latency, usability, and playtest performance need broader evaluation. No user study or general performance improvement is claimed.
