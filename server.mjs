import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, resolve, sep } from "node:path";
import { readConfig } from "./src/config.mjs";
import { BudgetLedger } from "./src/budget.mjs";
import { MetaClient, scanTabletop } from "./src/meta.mjs";
import { runPlaytest } from "./src/agent.mjs";
import { validateWorld } from "./shared/world.js";
import { simulate } from "./shared/engine.js";

const root = dirname(fileURLToPath(import.meta.url));
const config = readConfig();
const ledger = new BudgetLedger(join(root, ".liveworld"), config);
const client = new MetaClient(config, ledger);
const port = Number(process.env.PORT ?? 4173);
let paidBusy = false;

function json(res, status, value) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(value));
}
async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 3_200_000) throw new Error("Request is too large.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
};

const server = createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
  const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!allowedHosts.includes(req.headers.host))
    return json(res, 403, { error: "Unrecognized local host." });
  if (
    req.headers.origin &&
    !allowedHosts.map((h) => `http://${h}`).includes(req.headers.origin)
  )
    return json(res, 403, { error: "Cross-origin requests are not allowed." });
  if (req.method !== "GET" && req.headers["sec-fetch-site"] === "cross-site")
    return json(res, 403, { error: "Cross-site requests are not allowed." });
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  try {
    if (req.method === "GET" && url.pathname === "/api/status")
      return json(res, 200, {
        configured: Boolean(config.key),
        model: config.model,
        budget: await ledger.summary(),
      });
    if (req.method === "POST" && url.pathname === "/api/simulate") {
      const body = await readBody(req);
      return json(res, 200, simulate(validateWorld(body.world)));
    }
    if (
      req.method === "POST" &&
      ["/api/playtest", "/api/scan"].includes(url.pathname)
    ) {
      if (paidBusy)
        return json(res, 409, {
          error: "Another Meta operation is running. Wait for it to finish.",
        });
      const body = await readBody(req);
      paidBusy = true;
      try {
        if (url.pathname === "/api/scan")
          return json(res, 200, await scanTabletop(client, body));
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-store",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        const send = (event) => {
          if (!res.destroyed) res.write(`data: ${JSON.stringify(event)}\n\n`);
        };
        const result = await runPlaytest(client, body, send);
        await mkdir(join(root, ".liveworld", "runs"), { recursive: true });
        await writeFile(
          join(root, ".liveworld", "runs", `${result.runId}.json`),
          JSON.stringify(result, null, 2),
          { mode: 0o600 },
        );
        send({ type: "complete", result, budget: await ledger.summary() });
        res.end();
      } finally {
        paidBusy = false;
      }
      return;
    }
    if (req.method !== "GET")
      return json(res, 405, { error: "Method not allowed." });
    const shared = url.pathname.startsWith("/shared/");
    const directory = join(root, shared ? "shared" : "public");
    const relative =
      url.pathname === "/"
        ? "index.html"
        : decodeURIComponent(url.pathname).replace(
            shared ? /^\/shared\// : /^\//,
            "",
          );
    const file = resolve(directory, relative);
    if (!file.startsWith(directory + sep) || !mime[extname(file)])
      return json(res, 404, { error: "Not found." });
    const content = await readFile(file);
    res.writeHead(200, {
      "Content-Type": mime[extname(file)],
      "Cache-Control": "no-cache",
    });
    res.end(content);
  } catch (error) {
    const message =
      error.code === "ENOENT"
        ? "Not found."
        : String(error.message).replaceAll(
            config.key || "__NO_SECRET__",
            "[redacted]",
          );
    if (res.headersSent) {
      if (!res.destroyed) {
        res.write(`data: ${JSON.stringify({ type: "error", message })}\n\n`);
        res.end();
      }
    } else json(res, error.code === "ENOENT" ? 404 : 400, { error: message });
  }
});

server.listen(port, "127.0.0.1", () =>
  console.log(`LiveWorld is ready at http://127.0.0.1:${port}`),
);
