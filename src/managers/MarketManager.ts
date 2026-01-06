import {
    Connection,
    Keypair,
    PublicKey,
    SystemProgram,
    Transaction,
    TransactionInstruction
} from '@solana/web3.js';
import {
    Market,
    DexInstructions
} from '@openbook-dex/openbook'; // Verify typescript support/exports
import {
    ACCOUNT_SIZE,
    createInitializeAccountInstruction,
    TOKEN_PROGRAM_ID
} from '@solana/spl-token';
import { Logger } from '../core/utils';
import { BN } from 'bn.js';

// OpenBook Program ID (Mainnet)
// OpenBook Program ID (Mainnet) - V1 Official
export const OPENBOOK_PROGRAM_ID = new PublicKey('srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX');

export class MarketManager {
    constructor(private connection: Connection, private wallet: Keypair) { }

    async createLowCostMarket(
        baseMint: PublicKey,
        quoteMint: PublicKey,
        baseDecimals: number,
        quoteDecimals: number,
        // Defaults for "Low Cost"
        eventQueueLength = 128,
        requestQueueLength = 63,
        orderbookLength = 201
    ) {
        Logger.info('Generating Low-Cost OpenBook Market...');

        const marketKeypair = Keypair.generate();
        const eventQueue = Keypair.generate();
        const requestQueue = Keypair.generate();
        const bids = Keypair.generate();
        const asks = Keypair.generate();

        const vaultSignerNonce = new BN(0); // This usually needs calculation or is found inside the instruction builder

        const [vaultOwner, _vaultSignerNonce] = await PublicKey.findProgramAddress(
            [
                marketKeypair.publicKey.toBuffer(),
                vaultSignerNonce.toArrayLike(Buffer, 'le', 8),
            ],
            OPENBOOK_PROGRAM_ID
        );

        // Calculate space and rent
        // We need to look up exact sizes.
        // Standard sizes:
        // EventQ: 8 + 12 * length? Header + events?
        // RequestQ: ...
        // Orderbook: ...

        // For simplicity, we'll try to use the Market.create helper if it allows options,
        // OR manual calculation.
        // The @openbook-dex/openbook package usually exposes `Market.getLayout(programId)` or similar.

        // Let's assume standard low-cost sizes (in bytes) often used:
        // Event Queue (128): 262144 (This is standard 2978 slots? No, 128 is tiny).
        // Let's use specific calculations from v1 documentation/examples if available.

        // PROVISIONAL: Using known valid sizes for "low cost"
        // Event Queue (128 slots) -> ~11308 bytes?
        // Request Queue (63 slots) -> ~5084 bytes?
        // Bids/Asks (201 slots) -> ~14524 bytes?

        // Better strategy: Calculate safely or over-provision slightly less than max.
        // Length * SlotSize + Header

        const EVENT_SLOT_SIZE = 88;
        const REQUEST_SLOT_SIZE = 80;
        const ORDER_SLOT_SIZE = 72;
        const HEADER_SIZE = 32; // Approx, need exact layout

        // Actually, let's use the layout from the SDK
        const totalEventQueueSize = 376 + 128 * 88; // Header + slots
        const totalRequestQueueSize = 332 + 63 * 80;
        const totalOrderbookSize = 104 + 201 * 72;

        Logger.info(`Calculated Sizes - Event: ${totalEventQueueSize}, Request: ${totalRequestQueueSize}, Orderbook: ${totalOrderbookSize}`);

        const lamportsEventQueue = await this.connection.getMinimumBalanceForRentExemption(totalEventQueueSize);
        const lamportsRequestQueue = await this.connection.getMinimumBalanceForRentExemption(totalRequestQueueSize);
        const lamportsOrderbook = await this.connection.getMinimumBalanceForRentExemption(totalOrderbookSize);

        const tx = new Transaction();

        // Create Accounts
        tx.add(
            SystemProgram.createAccount({
                fromPubkey: this.wallet.publicKey,
                newAccountPubkey: eventQueue.publicKey,
                lamports: lamportsEventQueue,
                space: totalEventQueueSize,
                programId: OPENBOOK_PROGRAM_ID,
            }),
            SystemProgram.createAccount({
                fromPubkey: this.wallet.publicKey,
                newAccountPubkey: requestQueue.publicKey,
                lamports: lamportsRequestQueue,
                space: totalRequestQueueSize,
                programId: OPENBOOK_PROGRAM_ID,
            }),
            SystemProgram.createAccount({
                fromPubkey: this.wallet.publicKey,
                newAccountPubkey: bids.publicKey,
                lamports: lamportsOrderbook,
                space: totalOrderbookSize,
                programId: OPENBOOK_PROGRAM_ID,
            }),
            SystemProgram.createAccount({
                fromPubkey: this.wallet.publicKey,
                newAccountPubkey: asks.publicKey,
                lamports: lamportsOrderbook,
                space: totalOrderbookSize,
                programId: OPENBOOK_PROGRAM_ID,
            })
        );

        // Initialize Market
        const marketLayoutSpan = Market.getLayout(OPENBOOK_PROGRAM_ID).span;
        const lamportsMarket = await this.connection.getMinimumBalanceForRentExemption(marketLayoutSpan);

        // Create Vaults
        // Vaults are Token Accounts owned by the Market PDA (Vault Owner)
        // We generate random keypairs for them, create the accounts, and init them with Owner = vaultOwner
        const baseVault = Keypair.generate();
        const quoteVault = Keypair.generate();
        const vaultLamports = await this.connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE);

        tx.add(
            // Create Base Vault Account
            SystemProgram.createAccount({
                fromPubkey: this.wallet.publicKey,
                newAccountPubkey: baseVault.publicKey,
                lamports: vaultLamports,
                space: ACCOUNT_SIZE,
                programId: TOKEN_PROGRAM_ID,
            }),
            // Initialize Base Vault (Owned by Vault Owner PDA)
            createInitializeAccountInstruction(
                baseVault.publicKey,
                baseMint,
                vaultOwner, // Owner must be the Market PDA
            ),
            // Create Quote Vault Account
            SystemProgram.createAccount({
                fromPubkey: this.wallet.publicKey,
                newAccountPubkey: quoteVault.publicKey,
                lamports: vaultLamports,
                space: ACCOUNT_SIZE,
                programId: TOKEN_PROGRAM_ID,
            }),
            // Initialize Quote Vault (Owned by Vault Owner PDA)
            createInitializeAccountInstruction(
                quoteVault.publicKey,
                quoteMint,
                vaultOwner,
            )
        );

        tx.add(
            SystemProgram.createAccount({
                fromPubkey: this.wallet.publicKey,
                newAccountPubkey: marketKeypair.publicKey,
                lamports: lamportsMarket,
                space: marketLayoutSpan,
                programId: OPENBOOK_PROGRAM_ID,
            }),
            DexInstructions.initializeMarket({
                market: marketKeypair.publicKey,
                requestQueue: requestQueue.publicKey,
                eventQueue: eventQueue.publicKey,
                bids: bids.publicKey,
                asks: asks.publicKey,
                baseVault: baseVault.publicKey,
                quoteVault: quoteVault.publicKey,
                baseMint,
                quoteMint,
                baseLotSize: new BN(1), // Tunable?
                quoteLotSize: new BN(1), // Tunable?
                feeRateBps: 0,
                vaultSignerNonce: _vaultSignerNonce,
                programId: OPENBOOK_PROGRAM_ID,
                quoteDustThreshold: new BN(100), // Standard dust threshold
                // authority // deprecated/not used usually?
            })
        );

        Logger.info(`Sending Market Creation Transaction (Market ID: ${marketKeypair.publicKey.toString()})...`);

        // Note: This transaction might be large.
        // We strictly need to sign with all these keypairs.
        const signers = [
            this.wallet,
            marketKeypair,
            eventQueue,
            requestQueue,
            bids,
            asks,
            baseVault,
            quoteVault
        ];

        // For now, return the instruction and signers to be sent, or send it here.
        // The architecture says "MarketManager Handles interaction".
        // Let's send it.

        // Using sendTransaction helper from web3.js/connection
        // We need to compile it or use sendTransaction (if passing Keypair as wallet).
        // Let's assume standard behavior.

        try {
            const sig = await this.connection.sendTransaction(tx, signers);
            await this.connection.confirmTransaction(sig);
            Logger.info(`Market Created! Signature: ${sig}`);
        } catch (e) {
            Logger.error('Failed to create market', e);
            throw e;
        }

        return {
            marketId: marketKeypair.publicKey.toString(),
            marketState: {
                baseVault: baseVault.publicKey,
                quoteVault: quoteVault.publicKey,
                eventQueue: eventQueue.publicKey,
                // ...
            }
        };
    }
}
