import { describe, it, expect } from 'bun:test';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { Logger, loadKeypairEnv } from '../src/core/utils';
import { CPMMManager } from '../src/strategies/raydium';
import dotenv from 'dotenv';

dotenv.config();

describe('Raydium CPMM Strategy', () => {
    it('should load Raydium SDK and verify connectivity (Dry-run)', async () => {
        const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
        const wallet = loadKeypairEnv();
        
        if (!wallet) return;

        const cpmm = new CPMMManager(connection, wallet, 'devnet');
        const dummyMint = Keypair.generate().publicKey;
        
        const result = await cpmm.initialize({
            name: 'Test',
            symbol: 'TST',
            image: '',
            solLiquidityAmount: 1,
            tokenLiquidityAmount: 100,
            dex: 'raydium:cpmm'
        }, dummyMint);

        expect(result).toBeDefined();
        expect(result.poolId).toBeDefined();
        Logger.info('Raydium CPMM SDK loading verified.');
    });
});
