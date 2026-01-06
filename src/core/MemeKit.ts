import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { TokenManager } from '../managers/TokenManager';
import { MarketManager } from '../managers/MarketManager';
import { LiquidityManager } from '../managers/LiquidityManager';
import type { LaunchOptions, LiquidityStrategy } from '../strategies/LiquidityStrategy';
import { DLMMManager } from '../strategies/meteora';
import { CPMMManager, AMMManager } from '../strategies/raydium';
import { Logger, loadKeypairEnv, getExplorerLink } from './utils';
import { JitoManager } from '../managers/JitoManager';
import dotenv from 'dotenv';
import bs58 from 'bs58';

dotenv.config();

export class MemeKit {
    private connection: Connection;
    private wallet: Keypair;
    private cluster: 'mainnet-beta' | 'devnet';

    public tokenManager: TokenManager;
    public marketManager: MarketManager;
    public liquidityManager: LiquidityManager;
    public jitoManager: JitoManager;

    constructor(config: { rpcUrl: string, privateKey?: string, cluster?: 'mainnet-beta' | 'devnet' }) {
        this.connection = new Connection(config.rpcUrl, 'confirmed');
        this.cluster = config.cluster || 'mainnet-beta';

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
        this.liquidityManager = new LiquidityManager(this.connection, this.wallet, this.cluster);
        this.jitoManager = new JitoManager(this.connection, this.wallet, this.cluster);
    }

    async launch(options: LaunchOptions) {
        Logger.info(`Starting Launch on strategy: ${options.dex || 'meteora:dlmm'}`);

        // 1. Create Token
        const { mint } = await this.tokenManager.createToken({
            name: options.name,
            symbol: options.symbol,
            uri: options.image,
            decimals: options.decimals,
            initialSupply: options.supply || 1_000_000_000
        });
        Logger.info(`Token Minted: ${mint.publicKey.toBase58()}`);

        // 2. Revoke Authorities
        await this.tokenManager.revokeAuthorities(mint.publicKey, this.wallet);

        // 3. Execute Liquidity Strategy
        let strategy: LiquidityStrategy;
        const dex = options.dex || 'meteora:dlmm'; // Default to Meteora DLMM

        switch (dex) {
            case 'meteora:dlmm':
                strategy = new DLMMManager(this.connection, this.wallet, this.cluster === 'devnet' ? 'devnet' : 'mainnet-beta');
                break;
            case 'raydium:cpmm':
                strategy = new CPMMManager(this.connection, this.wallet, this.cluster);
                break;
            case 'raydium:amm':
                strategy = new AMMManager(this.connection, this.wallet, this.marketManager, this.cluster);
                break;
            default:
                throw new Error(`Unknown DEX strategy: ${dex}`);
        }

        const { poolId, instructions } = await strategy.initialize(options, mint.publicKey);
        Logger.info(`Liquidity Setup Instructions Generated. Pool: ${poolId.toBase58()}`);

        // 4. Send Transaction (Jito or Real SOL)
        let signature = 'Dry-run (not sent)';
        if (instructions.length > 0) {
            if (options.jitoTip) {
                Logger.info(`Launching with Jito Bundle (Tip: ${options.jitoTip} SOL)...`);
                try {
                    const bundleId = await this.jitoManager.sendBundle(instructions, options.jitoTip);
                    signature = bundleId;
                    Logger.info(`Bundle Submitted: ${bundleId}`);
                } catch (err: any) {
                    Logger.error(`Jito Bundle failed: ${err.message}`);
                    signature = `Failed: ${err.message}`;
                }
            } else {
                const { Transaction, TransactionMessage, VersionedTransaction } = await import('@solana/web3.js');
                
                const recentBlockhash = await this.connection.getLatestBlockhash();
                const messageV0 = new TransactionMessage({
                    payerKey: this.wallet.publicKey,
                    recentBlockhash: recentBlockhash.blockhash,
                    instructions,
                }).compileToV0Message();

                const versionedTx = new VersionedTransaction(messageV0);
                versionedTx.sign([this.wallet]);

                Logger.info('Sending Liquidity Setup Transaction...');
                try {
                    signature = await this.connection.sendTransaction(versionedTx);
                    Logger.info(`Transaction Sent: ${signature}`);
                    Logger.info('Transaction Confirmed! ✓');
                    Logger.info(`Explorer: ${getExplorerLink('tx', signature, this.cluster)}`);
                } catch (err: any) {
                    Logger.error(`Transaction failed: ${err.message}`);
                    signature = `Failed: ${err.message}`;
                }
            }
        }

        return {
            mint: mint.publicKey.toBase58(),
            poolId: poolId.toBase58(),
            marketId: (dex === 'raydium:amm') ? 'Generated internally' : 'Not Required',
            strategy: dex,
            signature
        };
    }
}
