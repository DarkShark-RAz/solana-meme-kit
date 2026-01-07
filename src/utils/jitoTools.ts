import { PublicKey } from "@solana/web3.js";

export type BlockEngineRegion =
  | "default"
  | "ny"
  | "amsterdam"
  | "frankfurt"
  | "tokyo"
  | "slc";

export const JITO_TIP_ACCOUNT_STRINGS = [
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
  "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
  "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
  "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
  "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
  "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
  "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
];

export const JITO_TIP_ACCOUNTS = JITO_TIP_ACCOUNT_STRINGS.map(
  (a) => new PublicKey(a)
);

export function getRandomTipAccount(): PublicKey {
  return JITO_TIP_ACCOUNTS[
    Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)
  ]!;
}

export function getBlockEngineHost(
  cluster: "mainnet-beta" | "devnet",
  region: BlockEngineRegion = "default"
): string {
  if (cluster === "devnet") {
    return "ny.devnet.block-engine.jito.wtf";
  }

  switch (region) {
    case "ny":
      return "ny.mainnet.block-engine.jito.wtf";
    case "amsterdam":
      return "amsterdam.mainnet.block-engine.jito.wtf";
    case "frankfurt":
      return "frankfurt.mainnet.block-engine.jito.wtf";
    case "tokyo":
      return "tokyo.mainnet.block-engine.jito.wtf";
    case "slc":
      return "slc.mainnet.block-engine.jito.wtf";
    case "default":
    default:
      return "mainnet.block-engine.jito.wtf";
  }
}

export type JitoTipFloorPercentile = 25 | 50 | 75 | 95 | 99;

export interface GetJitoTipFloorOptions {
  percentile?: JitoTipFloorPercentile;
  fallbackSol?: number;
  timeoutMs?: number;
}

function normalizeTipToSol(value: number): number {
  if (!Number.isFinite(value)) return NaN;
  if (value <= 1) return value;
  if (value > 1e11) return value / 1e15;
  return value / 1e9;
}

export async function getJitoTipFloor(
  options: GetJitoTipFloorOptions = {}
): Promise<number> {
  const percentile: JitoTipFloorPercentile = options.percentile ?? 95;
  const fallbackSol = options.fallbackSol ?? 0.001;
  const timeoutMs = options.timeoutMs ?? 2500;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(
      "https://bundles.jito.wtf/api/v1/bundles/tip_floor",
      {
        signal: controller.signal,
      }
    );

    if (!res.ok) {
      throw new Error(`tip_floor failed: ${res.status} ${res.statusText}`);
    }

    const json: unknown = await res.json();
    const row = Array.isArray(json) ? (json[0] as any) : (json as any);

    const key = `landed_tips_${percentile}th_percentile`;
    const raw = row?.[key];
    if (typeof raw !== "number") {
      throw new Error(`tip_floor missing field: ${key}`);
    }

    const sol = normalizeTipToSol(raw);
    if (!Number.isFinite(sol) || sol <= 0) {
      throw new Error("tip_floor returned invalid value");
    }

    return sol;
  } catch {
    return fallbackSol;
  } finally {
    clearTimeout(timeout);
  }
}
