import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { TokenManager } from './TokenManager';
import { MarketManager } from './MarketManager';
import { LiquidityManager } from './LiquidityManager';
import { Logger, loadKeypairEnv } from './utils';
import dotenv from 'dotenv';
import bs58 from 'bs58';

dotenv.config();

export interface LaunchOptions {
    // Token Details
    name: string;
    symbol: string;
    image: string; // URI or path? We'll assume URI for now or path handled by caller
    decimals?: number;
    supply?: number;

    // Market Details
    marketMode?: 'default' | 'low-cost'; // Default 'low-cost'

    // Liquidity Details
    solLiquidityAmount: number;
    tokenLiquidityAmount: number;

    // Anti-Snipe Details
    devBuySolAmount?: number;
    jitoTipAmount?: number;
}

export class MemeKit {
    private connection: Connection;
    private wallet: Keypair;

    public tokenManager: TokenManager;
    public marketManager: MarketManager;
    public liquidityManager: LiquidityManager;

    constructor(config: { rpcUrl: string, privateKey?: string, cluster?: 'mainnet' | 'devnet' }) {
        this.connection = new Connection(config.rpcUrl, 'confirmed');
        const cluster = config.cluster || 'mainnet';

        // Load wallet
        if (config.privateKey) {
            this.wallet = Keypair.fromSecretKey(bs58.decode(config.privateKey));
        } else {
            const loaded = loadKeypairEnv();
            if (!loaded) throw new Error('No private key provided or found in env');
            this.wallet = loaded;
        }

        this.tokenManager = new TokenManager(this.connection, this.wallet);
        this.marketManager = new MarketManager(this.connection, this.wallet);
        this.liquidityManager = new LiquidityManager(this.connection, this.wallet, cluster);
    }

    async launch(options: LaunchOptions) {
        Logger.info('Starting Meme Launch...');

        // 1. Create Token
        const { mint } = await this.tokenManager.createToken({
            name: options.name,
            symbol: options.symbol,
            uri: options.image,
            decimals: options.decimals,
            initialSupply: options.supply || 1_000_000_000,
        });

        Logger.info(`Token Minted: ${mint.publicKey.toString()}`);

        // 2. Revoke Authorities
        await this.tokenManager.revokeAuthorities(mint.publicKey, this.wallet);

        // 3. Create Market
        // We assume standard decimals for now (9 for SOL, 6 for Token usually, or derived from mint)
        const quoteMint = new PublicKey('So11111111111111111111111111111111111111112'); // WSOL

        const marketRes = await this.marketManager.createLowCostMarket(
            mint.publicKey,
            quoteMint,
            options.decimals || 6,
            9 // SOL decimals
        );

        Logger.info(`Market Ready: ${marketRes.marketId}`);

        // 4. Liquidity & Bundle
        // Only proceed if Jito logic is ready or we are on mainnet.
        // For now, we'll try to execute the bundle logic.

        const bundleRes = await this.liquidityManager.createPoolBundle(
            mint.publicKey,
            quoteMint,
            new PublicKey(marketRes.marketId),
            options.tokenLiquidityAmount,
            options.solLiquidityAmount,
            options.devBuySolAmount || 0,
            options.jitoTipAmount || 0.001,
            options.decimals || 6,
            9
        );

        Logger.info(`Launch Complete! Bundle ID: ${bundleRes.bundleId}`);

        return {
            mint: mint.publicKey.toString(),
            marketId: marketRes.marketId,
            bundleId: bundleRes.bundleId
        };
    }
}
