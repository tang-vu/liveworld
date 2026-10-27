import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

export function readConfig() {
  try {
    loadEnvFile(fileURLToPath(new URL("../.env.local", import.meta.url)));
  } catch (error) {
    if (error.code !== "ENOENT")
      throw new Error("Cannot load local configuration.");
  }
  const usd = (name, fallback) => {
    const raw = process.env[name] ?? String(fallback);
    const value = Number(raw);
    if (!raw.trim() || !Number.isFinite(value) || value < 0)
      throw new Error(`Invalid ${name}.`);
    return value;
  };
  const total = usd("LIVEWORLD_TOTAL_BUDGET_USD", 150);
  const phase = usd("LIVEWORLD_PHASE_BUDGET_USD", 10);
  const reserve = usd("LIVEWORLD_RESERVE_USD", 50);
  if (total <= 0 || total > 150 || phase <= 0 || phase + reserve > total)
    throw new Error(
      "Budget configuration must respect the $150 total and reserve.",
    );
  if (
    (process.env.META_API_BASE_URL ?? "https://api.meta.ai/v1") !==
    "https://api.meta.ai/v1"
  )
    throw new Error("Use the official Meta API endpoint.");
  if (
    (process.env.META_REASONING_MODEL ?? "muse-spark-1.3") !== "muse-spark-1.3"
  )
    throw new Error(
      "Only muse-spark-1.3 has a verified price in this version.",
    );
  if ((process.env.META_SEGMENTATION_MODEL ?? "sam-3.1") !== "sam-3.1")
    throw new Error("Only sam-3.1 has a verified price in this version.");
  return {
    key: process.env.MODEL_API_KEY?.trim() ?? "",
    total,
    phase,
    reserve,
    baseURL: "https://api.meta.ai/v1",
    model: "muse-spark-1.3",
    samModel: "sam-3.1",
  };
}
