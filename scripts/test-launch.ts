import { MemeKit } from '../src/MemeKit';
import { Logger } from '../src/utils';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Verify connection
const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';
const PRIVATE_KEY = process.env.PRIVATE_KEY;

if (!PRIVATE_KEY) {
    Logger.error('Please set PRIVATE_KEY in .env');
    process.exit(1);
}

const kit = new MemeKit({
    rpcUrl: RPC_URL,
    privateKey: PRIVATE_KEY,
});

async function main() {
    try {
        const pubkey = kit.marketManager['wallet'].publicKey; // Accessing via manager or need public access.
        // Let's create a connection locally to check balance/airdrop
        const { Connection, PublicKey, LAMPORTS_PER_SOL } = await import('@solana/web3.js');
        const connection = new Connection(RPC_URL, 'confirmed');

        // Check balance
        // We need the wallet public key. kit.wallet is private.
        // Let's rely on TokenManager.umi.identity.publicKey or just derive it from env again.
        const { Keypair } = await import('@solana/web3.js');
        const bs58 = (await import('bs58')).default;
        const wallet = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY!));

        const balance = await connection.getBalance(wallet.publicKey);
        Logger.info(`Wallet Balance: ${balance / LAMPORTS_PER_SOL} SOL`);

        if (balance < 2 * LAMPORTS_PER_SOL) {
            Logger.info('Requesting Airdrop of 1 SOL...');
            try {
                const sig = await connection.requestAirdrop(wallet.publicKey, 1 * LAMPORTS_PER_SOL);
                await connection.confirmTransaction(sig);
                Logger.info('Airdrop successful');
            } catch (e) {
                Logger.warn('Airdrop failed (rate limit?):', e);
            }
        }

        const res = await kit.launch({
            name: 'Test Meme',
            symbol: 'TMEME',
            image: 'https://arweave.net/1234',
            supply: 1_000_000,
            solLiquidityAmount: 0.01,
            tokenLiquidityAmount: 500_000,
            marketMode: 'low-cost',
        });
        Logger.info('Result:', res);
    } catch (e) {
        Logger.error('Launch failed', e);
    }
}

main();
