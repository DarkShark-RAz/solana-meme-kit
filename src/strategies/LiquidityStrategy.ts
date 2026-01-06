import { Connection, Keypair, TransactionInstruction, PublicKey } from '@solana/web3.js';

export interface LaunchOptions {
    name: string;
    symbol: string;
    description?: string;
    image: string; // URL or File path (handled by TokenManager)
    decimals?: number;
    supply?: number;

    // Liquidity
    solLiquidityAmount: number;
    tokenLiquidityAmount: number;

    // Strategy Config
    dex?: 'meteora:dlmm' | 'raydium:cpmm' | 'raydium:amm';

    // Anti-Snipe (mainnet only)
    devBuySolAmount?: number;
    jitoTipAmount?: number;

    // Legacy / Specifics
    marketMode?: 'low-cost' | 'standard'; // For Raydium AMM
}

export interface LiquidityStrategy {
    initialize(options: LaunchOptions, mint: PublicKey): Promise<{
        poolId: PublicKey;
        instructions: TransactionInstruction[];
    }>;
}
