import {
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  Transaction,
} from "@solana/web3.js";
import type { LiquidityStrategy, LaunchOptions } from "../LiquidityStrategy";
import DLMM, { deriveLbPair, LBCLMM_PROGRAM_IDS } from "@meteora-ag/dlmm";
import { BN } from "bn.js";
import { Logger } from "../../core/utils";

export class DLMMManager implements LiquidityStrategy {
  private static BIN_STEP = new BN(100); // Volatility setting for memecoins (100 is standard)
  private programId: PublicKey;

  constructor(
    private connection: Connection,
    private wallet: Keypair,
    private cluster: "devnet" | "mainnet-beta" = "mainnet-beta"
  ) {
    this.programId = new PublicKey(LBCLMM_PROGRAM_IDS[this.cluster]);
  }

  /**
   * Calculate the starting Bin ID from a price.
   * Price = solAmount / tokenAmount (adjusted for decimals)
   */
  private calculateActiveBinId(
    solAmount: number,
    tokenAmount: number,
    tokenDecimals: number = 6
  ): number {
    const solDecimals = 9;
    const adjustedPrice =
      (solAmount * Math.pow(10, tokenDecimals)) /
      (tokenAmount * Math.pow(10, solDecimals));
    const binStep = DLMMManager.BIN_STEP.toNumber();
    const base = 1 + binStep / 10000;
    const activeId = Math.round(Math.log(adjustedPrice) / Math.log(base));
    Logger.info(
      `Calculated Active Bin ID: ${activeId} for price ${adjustedPrice}`
    );
    return activeId;
  }

  async initialize(
    options: LaunchOptions,
    mint: PublicKey
  ): Promise<{ poolId: PublicKey; instructions: TransactionInstruction[] }> {
    Logger.info("Initializing Meteora DLMM Strategy...");

    const NATIVE_MINT = new PublicKey(
      "So11111111111111111111111111111111111111112"
    ); // WSOL

    // Token ordering
    const [tokenX, tokenY] =
      mint.toBuffer().compare(NATIVE_MINT.toBuffer()) < 0
        ? [mint, NATIVE_MINT]
        : [NATIVE_MINT, mint];

    Logger.info(
      `Token Order: X=${tokenX.toBase58().slice(0, 8)}..., Y=${tokenY
        .toBase58()
        .slice(0, 8)}...`
    );

    const solLiquidityAmount =
      options.liquidity?.solAmount ?? options.solLiquidityAmount ?? 0;
    const tokenLiquidityAmount =
      options.liquidity?.tokenAmount ?? options.tokenLiquidityAmount ?? 0;

    // Calculate Active Bin ID
    const activeId = this.calculateActiveBinId(
      solLiquidityAmount,
      tokenLiquidityAmount,
      options.decimals
    );

    // Derive Pool Address
    const [poolPubkey, _] = deriveLbPair(
      tokenX,
      tokenY,
      DLMMManager.BIN_STEP,
      this.programId
    );
    Logger.info(`Derived Pool Address: ${poolPubkey.toBase58()}`);

    // Create Pool Transaction using SDK
    // We use createCustomizablePermissionlessLbPair for anti-sniper features (activationPoint)
    const createTx = await DLMM.createCustomizablePermissionlessLbPair(
      this.connection,
      new BN(DLMMManager.BIN_STEP),
      tokenX,
      tokenY,
      new BN(activeId),
      new BN(100), // 1% base fee
      options.meteoraOptions?.activationType === "slot" ? 1 : 0, // 0 for Timestamp, 1 for Slot
      false, // hasAlphaVault (deferred)
      this.wallet.publicKey,
      options.meteoraOptions?.activationPoint
        ? new BN(options.meteoraOptions.activationPoint)
        : undefined
    );

    // Extract instructions from Transaction
    let instructions: TransactionInstruction[] = [];
    if (createTx instanceof Transaction) {
      instructions = createTx.instructions;
    } else if ((createTx as any).message) {
      // Probably a VersionedTransaction
      Logger.info("Detected VersionedTransaction from Meteora SDK");
      // This is tricky because we can't easily extract "TransactionInstruction" objects from a compiled message
      // without the account keys buffer. However, for bundling, we might need the whole transaction
      // or we might need to use a different SDK method that returns instructions.
    } else {
      Logger.warn("Unknown transaction type returned from Meteora SDK");
      console.log(createTx);
    }

    // Add Liquidity Instructions (Placeholder for now as SDK requires active DLMM instance)
    // In a real launch, we would use a Jito bundle to ensure Tx1 (Create) and Tx2 (Add Liquidity)
    // execute together. For this SDK, we provide the creation instructions.
    // Users can then use LiquidityManager or similar to add liquidity once pool exists.

    return {
      poolId: poolPubkey,
      instructions,
    };
  }
}
