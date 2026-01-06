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
    jitoTip?: number; // Tip in SOL for bundling
    
    meteoraOptions?: {
        activationPoint?: number; // Timestamp or slot
        activationType?: 'timestamp' | 'slot';
    };

    // Legacy / Specifics
    marketMode?: 'low-cost' | 'standard'; // For Raydium AMM
}

export interface LiquidityStrategy {
    initialize(options: LaunchOptions, mint: PublicKey): Promise<{
        poolId: PublicKey;
        instructions: TransactionInstruction[];
    }>;
}
