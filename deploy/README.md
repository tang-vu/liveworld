# Review deployment

The project remains local until deployment is explicitly approved. The prepared target is a single Node.js process behind an HTTPS reverse proxy, preserving the working backend and its ledger. No hosting purchase or public deployment is performed by these files.

## Runtime contract

- Public pages, authored examples, recorded Meta replays and local simulations do not need a code.
- Live photo analysis, rule compilation and agent playtests require the builder's separate demo access code. The code is not the Meta key. It creates a two-hour HttpOnly, Secure, SameSite=Strict cookie. Sessions expire on restart; the usage ledger survives.
- `LIVEWORLD_PUBLIC_ORIGIN` must be one HTTPS origin. The backend rejects other Host and Origin headers. A network listener without this origin is refused.
- Public mode needs an access code of at least 24 characters. Use a randomly generated code and supply it privately to reviewers.
- The Meta key is server-side only. `.env.deploy` is ignored and never copied into the image. Code and keys must not appear in screenshots, videos, URLs or project exports.
- Keep one app process with one persistent `.liveworld` directory. Do not run separate paid copies with independent ledgers. An exclusive file lock protects reservations across processes, but the operation gate and reviewer sessions are process-local.

## Preparation

1. Choose the HTTPS hostname and prepare its reverse-proxy configuration. `Caddyfile.example` preserves streaming responses. Check the target's existing proxy before changing it.
2. Build the Docker image from this repository. Only runtime source, dependencies and public assets enter the image; credentials, usage records, captures and Git metadata are excluded.
3. In the deployment checkout, create ignored `.env.deploy` with `MODEL_API_KEY`, `LIVEWORLD_PUBLIC_ORIGIN`, `LIVEWORLD_DEMO_ACCESS_CODE`, and the three budget settings from `.env.example`. Docker supplies `HOST=0.0.0.0`, `PORT=4173` and `LIVEWORLD_DATA_DIR=/data`.
4. Stop the development backend before migrating its ledger. Confirm no pending reservation or uncertain charge. Copy the **existing** `.liveworld` directory to the target using an authorized private channel. Preserve `usage.json`; do not initialize an empty ledger for the same account. Set ownership so the container's unprivileged Node user can update it.
5. `compose.yaml` mounts that directory at `/data`, binds the application port to the host's loopback interface and runs with a read-only root filesystem. The proxy is the public entry point. Keep the Meta account's other spending separate when checking remaining credit.
6. A public server with a Meta key refuses startup if the ledger is missing or malformed. This catches an empty or incorrect volume mount before inference can occur.

After approval, the intended command in the prepared checkout is `docker compose up -d --build`. This is a deployment action, not part of routine editing or tests.

## Verification after deployment

From a clean browser, verify the starting world, recorded A/B comparison, save/open project and evidence export. A live action must request the demo code. Incorrect codes must make no model requests; the correct code must unlock the browser, and locking must revoke it. Then perform one budgeted live Meta call and confirm its usage receipt. Reconcile account billing with the local estimate.

The health probe is `GET /healthz`. It reports process readiness, not the Meta account balance or model availability. Restart the app and confirm the recorded spend is retained and the old reviewer session is invalid. Verify that private files remain inaccessible. Do not delete lock or usage files to bypass a budget stop; investigate the recorded condition first.

## Rollback

Keep the previous image and source commit. Stop the new app, restore the previous image, and retain the latest verified ledger directory. Do not roll the ledger back with the application: that could forget spending. No automatic deployment hooks are configured.

References: [Docker build guidance](https://docs.docker.com/build/building/best-practices/), [Caddy reverse proxy and streaming](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).
