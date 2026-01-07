import { StrategyType } from "@meteora-ag/dlmm";

export interface MeteoraConfig {
  binStep: number;
  width: number;
  strategyType: StrategyType;

  feeBps?: number;
}

export const MeteoraPresets = {
  MEMECOIN_VOLATILE: {
    binStep: 100,
    width: 80,
    strategyType: StrategyType.Spot,
  } as MeteoraConfig,

  ANTI_SNIPE_FEE: {
    binStep: 100,
    width: 80,
    strategyType: StrategyType.Spot,
    feeBps: 500,
  } as MeteoraConfig,

  COMMUNITY_TOKEN: {
    binStep: 25,
    width: 60,
    strategyType: StrategyType.Spot,
  } as MeteoraConfig,

  STABLE_PEGGED: {
    binStep: 5,
    width: 10,
    strategyType: StrategyType.BidAsk,
  } as MeteoraConfig,
} as const;
