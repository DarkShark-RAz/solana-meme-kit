import { Connection, Keypair, PublicKey, TransactionInstruction, Transaction } from '@solana/web3.js';
import type { LiquidityStrategy, LaunchOptions } from '../LiquidityStrategy';
import { Logger } from '../../core/utils';
import { Raydium, TxVersion, getCpmmPdaPoolId, CREATE_CPMM_POOL_PROGRAM } from '@raydium-io/raydium-sdk-v2';
import { BN } from 'bn.js';

const WSOL = new PublicKey('So11111111111111111111111111111111111111112');

/**
 * Raydium CPMM (Constant Product Market Maker) Strategy
 * Uses the newer CP-Swap program - no OpenBook market required
 * Cost: ~0.15 SOL
 */
export class CPMMManager implements LiquidityStrategy {
    private raydium: Raydium | null = null;
    
    constructor(
        private connection: Connection, 
        private wallet: Keypair,
        private cluster: 'mainnet' | 'devnet' = 'mainnet'
    ) { }

    private async loadSdk(): Promise<Raydium> {
        if (!this.raydium) {
            Logger.info('Loading Raydium SDK...');
            this.raydium = await Raydium.load({
                connection: this.connection,
                owner: this.wallet,
                cluster: this.cluster,
                disableLoadToken: true,
            });
            Logger.info(`Raydium SDK loaded for cluster: ${this.cluster}`);
        }
        return this.raydium;
    }

    async initialize(options: LaunchOptions, mint: PublicKey): Promise<{ poolId: PublicKey; instructions: TransactionInstruction[]; }> {
        Logger.info('Initializing Raydium CPMM Strategy...');
        
        // Load SDK to verify it works
        const raydium = await this.loadSdk();
        
        // Token amounts with proper decimals
        const mintAAmount = new BN(options.tokenLiquidityAmount * Math.pow(10, options.decimals || 6));
        const mintBAmount = new BN(options.solLiquidityAmount * Math.pow(10, 9));
        
        Logger.info(`CPMM Pool Config:`);
        Logger.info(`  Token: ${mint.toBase58().slice(0,8)}...`);
        Logger.info(`  Quote: WSOL`);
        Logger.info(`  Token Amount: ${options.tokenLiquidityAmount}`);
        Logger.info(`  SOL Amount: ${options.solLiquidityAmount}`);
        Logger.info(`  Cluster: ${this.cluster}`);
        
        // Derive pool ID (deterministic from mints and config)
        const programId = this.cluster === 'devnet' 
            ? new PublicKey('CPMDWBwJDtYax9qW7AyRuVC19Cc4L4Vcy4n2BHAbHkCW')
            : CREATE_CPMM_POOL_PROGRAM;
        
        // Get default config ID for the program
        // In production, this would use the actual SDK createPool method
        // For dry-run testing, we demonstrate the SDK loads and can derive addresses
        
        try {
            // Create pool using Raydium SDK V2
            const { execute, extInfo } = await raydium.cpmm.createPool({
                programId: raydium.cluster === 'devnet' 
                    ? new PublicKey('CPMDWBwJDtYax9qW7AyRuVC19Cc4L4Vcy4n2BHAbHkCW')
                    : new PublicKey('CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C'),
                poolFeeAccount: raydium.cluster === 'devnet'
                    ? new PublicKey('G11FKBRaAkHAKuLCgLM6K6NUc9rTjPAznRCjZifrTQe2') // Devnet fee account
                    : new PublicKey('DNXgeM9EiiaAbaWvwjHj9fQQLAX5ZsfHyGHZot1r29vn'), // Mainnet fee account
                mintA: {
                    address: mint.toBase58(),
                    decimals: options.decimals || 6,
                    programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
                },
                mintB: {
                    address: WSOL.toBase58(),
                    decimals: 9,
                    programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
                },
                mintAAmount,
                mintBAmount,
                startTime: new BN(0),
                ownerInfo: {
                    useSOLBalance: true,
                },
                associatedOnly: false,
                txVersion: TxVersion.LEGACY,
                feeConfig: {
                    id: raydium.cluster === 'devnet'
                        ? new PublicKey('CPMDWBwJDtYax9qW7AyRuVC19Cc4L4Vcy4n2BHAbHkCW').toBase58() // Placeholder or fetch
                        : new PublicKey('CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C').toBase58(),
                    index: 0,
                    tradeFeeRate: 25,
                    protocolFeeRate: 10000,
                    fundFeeRate: 0,
                    createPoolFee: "0",
                    creatorFeeRate: 0,
                } as any, // Cast to any to bypass strict SDK V2 internal interface mismatch if needed
            });
            
            const poolId = new PublicKey(extInfo.address.poolId);
            Logger.info(`CPMM Pool ID: ${poolId.toBase58()}`);
            
            // Get transaction data
            const txres = await execute({ sendAndConfirm: false });
            
            // Extract instructions from transaction
            let instructions: TransactionInstruction[] = [];
            // Handle multiple potential return types from SDK V2 execute
            const signedTx = (txres as any).signedTx;
            if (signedTx instanceof Transaction) {
                instructions = signedTx.instructions;
            }
            
            Logger.info(`CPMM Pool Creation: ${instructions.length} instructions generated.`);
            
            return {
                poolId,
                instructions
            };
        } catch (error: any) {
            Logger.warn(`CPMM error: ${error.message}`);
            return {
                poolId: PublicKey.default,
                instructions: []
            };
        }
    }
}
