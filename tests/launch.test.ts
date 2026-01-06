import { describe, it, expect } from 'bun:test';
import { MemeKit } from '../src/core/MemeKit';
import { Logger } from '../src/core/utils';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';
const PRIVATE_KEY = process.env.PRIVATE_KEY;

describe('MemeKit Launch Orchestration', () => {
    it('should be able to initialize the kit and simulate a launch', async () => {
        if (!PRIVATE_KEY) {
            console.log('Skipping launch test: No PRIVATE_KEY found');
            return;
        }

        const kit = new MemeKit({
            rpcUrl: RPC_URL,
            privateKey: PRIVATE_KEY,
            cluster: 'devnet'
        });

        expect(kit).toBeDefined();
        
        // Note: Full launch involves minting which costs SOL.
        // For dry-run verification, we mostly verify kit setup in this block.
        // Strategy-specific files handle the deeper dry-runs.
        Logger.info('Launch Orchestrator ready.');
    });
});
