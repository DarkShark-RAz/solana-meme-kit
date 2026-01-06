import { describe, it, expect } from 'bun:test';
import { Connection, Keypair } from '@solana/web3.js';
import { Logger, loadKeypairEnv } from '../src/core/utils';
import { AMMManager } from '../src/strategies/raydium';
import { MarketManager } from '../src/managers/MarketManager';
import dotenv from 'dotenv';

dotenv.config();

describe('Raydium AMM (Legacy) Strategy', () => {
    it('should load Raydium SDK and verify market integration (Dry-run)', async () => {
        const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
        const wallet = loadKeypairEnv();
        
        if (!wallet) return;

        const marketManager = new MarketManager(connection, wallet);
        const amm = new AMMManager(connection, wallet, marketManager, 'devnet');
        const dummyMint = Keypair.generate().publicKey;
        
        const result = await amm.initialize({
            name: 'Test',
            symbol: 'TST',
            image: '',
            solLiquidityAmount: 1,
            tokenLiquidityAmount: 100,
            dex: 'raydium:amm'
        }, dummyMint);

        expect(result).toBeDefined();
        expect(result.poolId).toBeDefined();
        Logger.info('Raydium AMM SDK loading verified.');
    });
});
