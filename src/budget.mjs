import {
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const micro = (usd) => Math.ceil(usd * 1_000_000);
export const SPARK_INPUT_USD = 1.25 / 1_000_000;
export const SPARK_OUTPUT_USD = 4.25 / 1_000_000;
export const SAM_IMAGE_USD = 2.5 / 1000;
// Reserve a full context window rather than guessing an image's token count.
export const sparkReservation = (maxOutput) =>
  1_048_576 * SPARK_INPUT_USD + maxOutput * SPARK_OUTPUT_USD;

export class BudgetLedger {
  constructor(directory, policy) {
    this.directory = directory;
    this.policy = policy;
    this.path = join(directory, "usage.json");
    this.lockPath = join(directory, "usage.lock");
  }
  async read() {
    let data;
    try {
      data = JSON.parse(await readFile(this.path, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT")
        return { version: 1, entries: [], blocked: null };
      throw new Error(
        "Usage ledger cannot be verified. Paid requests are disabled.",
      );
    }
    if (
      data.version !== 1 ||
      !Array.isArray(data.entries) ||
      data.entries.some(
        (e) =>
          !Number.isSafeInteger(e.reservedMicros) ||
          e.reservedMicros < 0 ||
          !Number.isSafeInteger(e.chargedMicros) ||
          e.chargedMicros < 0 ||
          !["reserved", "settled", "uncertain"].includes(e.status),
      )
    )
      throw new Error("Invalid usage ledger. Paid requests are disabled.");
    return data;
  }
  async transaction(fn) {
    await mkdir(this.directory, { recursive: true });
    let lock;
    try {
      lock = await open(this.lockPath, "wx");
    } catch {
      throw new Error("Usage ledger is locked. No paid request was started.");
    }
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      const state = await this.read();
      const result = fn(state);
      await writeFile(temporary, JSON.stringify(state, null, 2), {
        mode: 0o600,
      });
      await rename(temporary, this.path);
      return result;
    } finally {
      await lock.close();
      await unlink(this.lockPath);
      await unlink(temporary).catch(() => {});
    }
  }
  totals(state) {
    const spent = state.entries.reduce((sum, e) => sum + e.chargedMicros, 0);
    const held = state.entries
      .filter((e) => e.status === "reserved")
      .reduce((sum, e) => sum + e.reservedMicros, 0);
    return { spent, held };
  }
  async reserve(kind, usd, metadata = {}) {
    if (!Number.isFinite(usd) || usd <= 0)
      throw new Error("Invalid cost reservation.");
    return this.transaction((state) => {
      if (state.blocked)
        throw new Error(
          "Paid requests are paused pending review of an uncertain API charge.",
        );
      const { spent, held } = this.totals(state);
      const amount = micro(usd);
      const cap = micro(
        Math.min(this.policy.phase, this.policy.total - this.policy.reserve),
      );
      if (spent + held + amount > cap)
        throw new Error(
          "The current API budget would be exceeded. No request was sent.",
        );
      const id = randomUUID();
      state.entries.push({
        id,
        kind,
        status: "reserved",
        reservedMicros: amount,
        chargedMicros: 0,
        createdAt: new Date().toISOString(),
        ...metadata,
      });
      return id;
    });
  }
  async settle(id, usd, usage = null) {
    return this.transaction((state) => {
      const entry = state.entries.find((e) => e.id === id);
      if (!entry || entry.status !== "reserved")
        throw new Error("Unknown or already settled reservation.");
      const known = Number.isFinite(usd) && usd >= 0;
      entry.status = known ? "settled" : "uncertain";
      entry.chargedMicros = known ? micro(usd) : entry.reservedMicros;
      entry.settledAt = new Date().toISOString();
      entry.usage = usage;
      if (!known || entry.chargedMicros > entry.reservedMicros)
        state.blocked = "An API charge needs review before further requests.";
    });
  }
  async summary() {
    const state = await this.read();
    const { spent, held } = this.totals(state);
    return {
      spentUsd: spent / 1e6,
      heldUsd: held / 1e6,
      phaseBudgetUsd: this.policy.phase,
      totalBudgetUsd: this.policy.total,
      reserveUsd: this.policy.reserve,
      requests: state.entries.length,
      blocked: state.blocked,
      scope: "Calls made by this local app; not the provider account balance.",
    };
  }
}
