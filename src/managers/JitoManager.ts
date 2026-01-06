import {
    Connection,
    PublicKey,
    SystemProgram,
    TransactionMessage,
    VersionedTransaction,
    Keypair,
} from '@solana/web3.js';
import { searcher } from 'jito-ts';
import { Bundle } from 'jito-ts/dist/sdk/block-engine/types';
import { Logger } from '../core/utils';

/**
 * Official Jito Tip Accounts
 */
export const JITO_TIP_ACCOUNTS = [
    '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
    'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
    'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
    'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
    'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
    'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
    '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
    'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
].map((a) => new PublicKey(a));

export class JitoManager {
    private client: any;

    constructor(
        private connection: Connection,
        private wallet: Keypair,
        private cluster: 'mainnet-beta' | 'devnet' = 'mainnet-beta'
    ) {
        const engineUrl = this.cluster === 'devnet' 
            ? 'ny.devnet.block-engine.jito.wtf' 
            : 'ny.mainnet.block-engine.jito.wtf';
        
        this.client = searcher.searcherClient(engineUrl);
    }

    /**
     * Sends a bundle of instructions with a Jito tip
     */
    async sendBundle(
        instructions: any[], // TransactionInstruction[]
        tipSol: number = 0.001
    ): Promise<string> {
        Logger.info(`Preparing Jito Bundle with tip: ${tipSol} SOL`);

        const tipAccount = JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)];
        const tipLamports = Math.floor(tipSol * 1e9);

        // Add tip instruction
        const bundleInstructions = [
            ...instructions,
            SystemProgram.transfer({
                fromPubkey: this.wallet.publicKey,
                toPubkey: tipAccount as PublicKey,
                lamports: tipLamports,
            }),
        ];

        const { blockhash } = await this.connection.getLatestBlockhash('confirmed');
        
        const messageV0 = new TransactionMessage({
            payerKey: this.wallet.publicKey,
            recentBlockhash: blockhash,
            instructions: bundleInstructions,
        }).compileToV0Message();

        const versionedTx = new VersionedTransaction(messageV0);
        versionedTx.sign([this.wallet]);
        
        const b = new Bundle([versionedTx], 5);
        
        try {
            const bundleId = await this.client.sendBundle(b);
            Logger.info(`Bundle submitted. ID: ${bundleId}`);
            return bundleId;
        } catch (error) {
            Logger.error("Failed to send Jito bundle", error);
            throw error;
        }
    }
}
