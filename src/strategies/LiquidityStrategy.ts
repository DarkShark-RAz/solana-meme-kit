import {
  Connection,
  Keypair,
  TransactionInstruction,
  PublicKey,
} from "@solana/web3.js";
import type { BlockEngineRegion } from "../utils/jitoTools";
import type { StrategyType } from "@meteora-ag/dlmm";

export interface LaunchOptions {
  name: string;
  symbol: string;
  description?: string;
  image: string; // URL or File path (handled by TokenManager)
  decimals?: number;
  supply?: number;

  // Liquidity
  solLiquidityAmount?: number;
  tokenLiquidityAmount?: number;
  liquidity?: {
    solAmount: number;
    tokenAmount: number;
  };

  // Strategy Config
  dex?: "meteora:dlmm" | "raydium:cpmm" | "raydium:amm";
  strategy?: "meteora" | "raydium-cpmm" | "raydium-amm";

  // Anti-Snipe (mainnet only)
  devBuySolAmount?: number;
  jitoTip?: number | "auto"; // Tip in SOL for bundling
  blockEngine?: BlockEngineRegion;

  meteoraOptions?: {
    activationPoint?: number; // Timestamp or slot
    activationType?: "timestamp" | "slot";
  };

  meteora?: {
    binStep?: number;
    width?: number;
    strategyType?: StrategyType;

    feeBps?: number;
    baseFactor?: number;
  };

  marketMode?: "low-cost" | "standard"; // For Raydium AMM

  // Legacy / Specifics
}

export interface LiquidityStrategy {
  initialize(
    options: LaunchOptions,
    mint: PublicKey
  ): Promise<{
    poolId: PublicKey;
    instructions: TransactionInstruction[];
    signers?: Keypair[];
  }>;
}
