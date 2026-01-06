import { Connection, Keypair, PublicKey, TransactionInstruction, Transaction } from '@solana/web3.js';
import type { LiquidityStrategy, LaunchOptions } from '../LiquidityStrategy';
import { Logger } from '../../core/utils';
import { MarketManager } from '../../managers/MarketManager';
import { Raydium, TxVersion } from '@raydium-io/raydium-sdk-v2';
import { BN } from 'bn.js';

const WSOL = new PublicKey('So11111111111111111111111111111111111111112');

/**
 * Raydium AMM (Legacy V4) Strategy
 */
export class AMMManager implements LiquidityStrategy {
    private raydium: Raydium | null = null;
    
    constructor(
        private connection: Connection, 
        private wallet: Keypair,
        private marketManager: MarketManager,
        private cluster: 'mainnet-beta' | 'devnet' = 'mainnet-beta'
    ) { }

    private async loadSdk(): Promise<Raydium> {
        if (!this.raydium) {
            this.raydium = await Raydium.load({
                connection: this.connection,
                owner: this.wallet,
                cluster: this.cluster === 'mainnet-beta' ? 'mainnet' : this.cluster,
                disableLoadToken: true,
            });
        }
        return this.raydium;
    }

    async initialize(options: LaunchOptions, mint: PublicKey): Promise<{ poolId: PublicKey; instructions: TransactionInstruction[]; }> {
        Logger.info('Initializing Raydium AMM (Legacy V4) Strategy...');
        
        try {
            // 1. Create OpenBook Market
            Logger.info('Step 1: Creating OpenBook Market...');
            const marketRes = await this.marketManager.createLowCostMarket(
                mint, 
                WSOL, 
                options.decimals || 6, 
                9
            );
            const marketId = new PublicKey(marketRes.marketId);
            Logger.info(`OpenBook Market Created: ${marketId.toBase58()}`);

            // 2. Load Raydium SDK
            const raydium = await this.loadSdk();
            
            // Token amounts with proper decimals
            const baseAmount = new BN(options.tokenLiquidityAmount * Math.pow(10, options.decimals || 6));
            const quoteAmount = new BN(options.solLiquidityAmount * Math.pow(10, 9));
            
            Logger.info(`Creating AMM Pool for Market: ${marketId.toBase58().slice(0,8)}...`);
            
            // 3. Create AMM Pool using Raydium SDK V2
            const { execute, extInfo } = await raydium.liquidity.createPoolV4({
                programId: raydium.cluster === 'devnet'
                    ? new PublicKey('HWy1jotHpo6UqeQxx49dpYYdQB8wj9Qk9MdxwjLvDHB8')
                    : new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8'),
                marketId,
                baseMintInfo: {
                    mint,
                    decimals: options.decimals || 6,
                },
                quoteMintInfo: {
                    mint: WSOL,
                    decimals: 9,
                },
                baseAmount,
                quoteAmount,
                startTime: new BN(0),
                ownerInfo: {
                    useSOLBalance: true,
                },
                associatedOnly: false,
                txVersion: TxVersion.LEGACY,
                feePayer: this.wallet.publicKey,
            } as any);
            
            const poolId = new PublicKey((extInfo as any).address.ammId || (extInfo as any).address.poolId);
            Logger.info(`AMM Pool ID: ${poolId.toBase58()}`);
            
            const txres = await execute({ sendAndConfirm: false });
            
            let instructions: TransactionInstruction[] = [];
            const signedTx = (txres as any).signedTx;
            if (signedTx instanceof Transaction) {
                instructions = signedTx.instructions;
            }
            
            Logger.info(`AMM Pool Creation: ${instructions.length} instructions generated.`);
            
            return {
                poolId,
                instructions
            };
        } catch (error: any) {
            Logger.warn(`AMM error: ${error.message}`);
            return {
                poolId: PublicKey.default,
                instructions: []
            };
        }
    }
}
