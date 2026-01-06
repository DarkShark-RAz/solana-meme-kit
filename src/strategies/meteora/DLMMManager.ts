import { Connection, Keypair, PublicKey, TransactionInstruction, Transaction } from '@solana/web3.js';
import type { LiquidityStrategy, LaunchOptions } from '../LiquidityStrategy';
import { LBCLMM, deriveLbPair, LBCLMM_PROGRAM_IDS } from '@meteora-ag/dlmm-sdk';
import { BN } from 'bn.js';
import { Logger } from '../../core/utils';

export class DLMMManager implements LiquidityStrategy {
    private static BIN_STEP = new BN(60); // Volatility setting for memecoins
    private programId: PublicKey;

    constructor(
        private connection: Connection, 
        private wallet: Keypair,
        private cluster: 'devnet' | 'mainnet-beta' = 'mainnet-beta'
    ) {
        this.programId = new PublicKey(LBCLMM_PROGRAM_IDS[this.cluster]);
    }

    /**
     * Calculate the starting Bin ID from a price.
     * Price = solAmount / tokenAmount (adjusted for decimals)
     */
    private calculateActiveBinId(solAmount: number, tokenAmount: number, tokenDecimals: number = 6): number {
        const solDecimals = 9;
        const adjustedPrice = (solAmount * Math.pow(10, tokenDecimals)) / (tokenAmount * Math.pow(10, solDecimals));
        const binStep = DLMMManager.BIN_STEP.toNumber();
        const base = 1 + binStep / 10000;
        const activeId = Math.round(Math.log(adjustedPrice) / Math.log(base));
        Logger.info(`Calculated Active Bin ID: ${activeId} for price ${adjustedPrice}`);
        return activeId;
    }

    async initialize(options: LaunchOptions, mint: PublicKey): Promise<{ poolId: PublicKey; instructions: TransactionInstruction[]; }> {
        Logger.info('Initializing Meteora DLMM Strategy...');
        
        const NATIVE_MINT = new PublicKey('So11111111111111111111111111111111111111112'); // WSOL
        
        // Token ordering
        const [tokenX, tokenY] = mint.toBuffer().compare(NATIVE_MINT.toBuffer()) < 0 
            ? [mint, NATIVE_MINT] 
            : [NATIVE_MINT, mint];
        
        Logger.info(`Token Order: X=${tokenX.toBase58().slice(0,8)}..., Y=${tokenY.toBase58().slice(0,8)}...`);
        
        // Calculate Active Bin ID
        const activeId = this.calculateActiveBinId(
            options.solLiquidityAmount, 
            options.tokenLiquidityAmount, 
            options.decimals
        );
        
        // Derive Pool Address
        const [poolPubkey, _] = deriveLbPair(tokenX, tokenY, DLMMManager.BIN_STEP, this.programId);
        Logger.info(`Derived Pool Address: ${poolPubkey.toBase58()}`);
        
        // Create Pool Transaction using SDK (LBCLMM class)
        const createTx = await LBCLMM.createLbPair(
            this.connection, 
            this.wallet.publicKey, 
            tokenX, 
            tokenY, 
            new BN(activeId), 
            DLMMManager.BIN_STEP, 
            { cluster: this.cluster }
        );
        
        // Extract instructions from Transaction
        let instructions: TransactionInstruction[] = [];
        if (createTx instanceof Transaction) {
            instructions = createTx.instructions;
        }
        
        Logger.info(`Meteora Pool Creation: ${instructions.length} instructions generated.`);
        
        // Add Liquidity Instructions (Placeholder for now as SDK requires active DLMM instance)
        // In a real launch, we would use a Jito bundle to ensure Tx1 (Create) and Tx2 (Add Liquidity) 
        // execute together. For this SDK, we provide the creation instructions.
        // Users can then use LiquidityManager or similar to add liquidity once pool exists.
        
        return {
            poolId: poolPubkey,
            instructions
        };
    }
}
