import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function readRuntimeConfig(env = process.env) {
  const host = env.HOST ?? "127.0.0.1";
  const port = Number(env.PORT ?? 4173);
  if (!["127.0.0.1", "0.0.0.0"].includes(host))
    throw new Error("HOST must be 127.0.0.1 or 0.0.0.0.");
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be from 1 to 65535.");
  const code = env.LIVEWORLD_DEMO_ACCESS_CODE?.trim() ?? "";
  let publicOrigin = null;
  if (env.LIVEWORLD_PUBLIC_ORIGIN) {
    const url = new URL(env.LIVEWORLD_PUBLIC_ORIGIN);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error(
        "Set one HTTPS public origin, without a path or credentials.",
      );
    publicOrigin = url.origin;
  }
  if (host === "0.0.0.0" && !publicOrigin)
    throw new Error("A network listener requires LIVEWORLD_PUBLIC_ORIGIN.");
  if (publicOrigin && code.length < 24)
    throw new Error(
      "A public server needs a demo access code of at least 24 characters.",
    );
  return { host, port, publicOrigin, code };
}

const digest = (value) => createHash("sha256").update(value).digest();
export class DemoAccess {
  constructor(config, now = Date.now) {
    this.config = config;
    this.now = now;
    this.sessions = new Map();
    this.failed = [];
    this.codeHash = config.code ? digest(config.code) : null;
    this.cookieName = config.publicOrigin
      ? "__Host-liveworld"
      : "liveworld-local";
  }
  required() {
    return Boolean(this.codeHash);
  }
  trusted(req) {
    const localHosts = [
      `127.0.0.1:${this.config.port}`,
      `localhost:${this.config.port}`,
    ];
    const allowed = this.config.publicOrigin
      ? [new URL(this.config.publicOrigin).host]
      : localHosts;
    // The container health probe needs no browser access and cannot call Meta.
    if (
      req.method === "GET" &&
      req.url === "/healthz" &&
      localHosts.includes(req.headers.host)
    )
      return true;
    if (!allowed.includes(req.headers.host)) return false;
    const origins = this.config.publicOrigin
      ? [this.config.publicOrigin]
      : localHosts.map((h) => `http://${h}`);
    if (req.headers.origin && !origins.includes(req.headers.origin))
      return false;
    return (
      req.method === "GET" || req.headers["sec-fetch-site"] !== "cross-site"
    );
  }
  prune() {
    const now = this.now();
    for (const [key, expiry] of this.sessions)
      if (expiry <= now) this.sessions.delete(key);
    this.failed = this.failed.filter((time) => time > now - 600_000);
  }
  authorized(req) {
    if (!this.required()) return true;
    this.prune();
    const token = (req.headers.cookie ?? "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(this.cookieName + "="))
      ?.slice(this.cookieName.length + 1);
    return (
      typeof token === "string" &&
      /^[a-zA-Z0-9_-]{43}$/.test(token) &&
      this.sessions.has(digest(token).toString("hex"))
    );
  }
  unlock(code) {
    if (!this.required()) return { status: 200, cookie: null };
    this.prune();
    const valid =
      typeof code === "string" &&
      code.length <= 512 &&
      timingSafeEqual(digest(code), this.codeHash);
    if (!valid) {
      if (this.failed.length < 20) this.failed.push(this.now());
      return { status: this.failed.length >= 20 ? 429 : 401, cookie: null };
    }
    if (this.sessions.size >= 128)
      this.sessions.delete(this.sessions.keys().next().value);
    const token = randomBytes(32).toString("base64url");
    this.sessions.set(digest(token).toString("hex"), this.now() + 7_200_000);
    return {
      status: 200,
      cookie: `${this.cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=7200${this.config.publicOrigin ? "; Secure" : ""}`,
    };
  }
  logout(req) {
    const token = (req.headers.cookie ?? "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(this.cookieName + "="))
      ?.slice(this.cookieName.length + 1);
    if (token) this.sessions.delete(digest(token).toString("hex"));
    return `${this.cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${this.config.publicOrigin ? "; Secure" : ""}`;
  }
}
