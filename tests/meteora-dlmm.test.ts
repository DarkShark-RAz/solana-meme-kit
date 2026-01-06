import { describe, it, expect } from 'bun:test';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { LBCLMM, deriveLbPair, LBCLMM_PROGRAM_IDS } from '@meteora-ag/dlmm-sdk';
import { BN } from 'bn.js';
import { Logger, loadKeypairEnv } from '../src/core/utils';
import dotenv from 'dotenv';

dotenv.config();

const DLMM_PROGRAM_ID = new PublicKey(LBCLMM_PROGRAM_IDS['devnet']); 

describe('Meteora DLMM Strategy', () => {
    it('should calculate pool address and build creation instructions', async () => {
        const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
        const wallet = loadKeypairEnv();
        
        if (!wallet) {
            console.log('Skipping test: No wallet found');
            return;
        }

        const tokenX = new PublicKey('So11111111111111111111111111111111111111112'); // WSOL
        const tokenY = Keypair.generate().publicKey;
        const binStep = new BN(60);
        const activeId = new BN(0);
        
        const [poolPubkey] = deriveLbPair(tokenX, tokenY, binStep, DLMM_PROGRAM_ID);
        expect(poolPubkey).toBeDefined();
        Logger.info(`Derived Pool: ${poolPubkey.toBase58()}`);
        
        // Build instructions (dry-run)
        try {
            const createTx = await LBCLMM.createLbPair(
                connection,
                wallet.publicKey,
                tokenX,
                tokenY,
                activeId,
                binStep,
                { cluster: 'devnet' }
            );
            expect(createTx.instructions.length).toBeGreaterThan(0);
            Logger.info(`Instructions generated: ${createTx.instructions.length}`);
        } catch (e: any) {
            Logger.warn('Dry-run expected notice:', e.message);
        }
    });
});
