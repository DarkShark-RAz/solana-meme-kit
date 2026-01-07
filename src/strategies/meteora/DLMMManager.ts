import {
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import type { LiquidityStrategy, LaunchOptions } from "../LiquidityStrategy";
import DLMM, {
  binIdToBinArrayIndex,
  createProgram,
  deriveCustomizablePermissionlessLbPair,
  deriveBinArray,
  deriveBinArrayBitmapExtension,
  deriveEventAuthority,
  deriveReserve,
  getBinArrayAccountMetasCoverage,
  getBinArrayIndexesCoverage,
  isOverflowDefaultBinArrayBitmap,
  LBCLMM_PROGRAM_IDS,
  StrategyType,
  toStrategyParameters,
} from "@meteora-ag/dlmm";
import { BN } from "bn.js";
import { Logger } from "../../core/utils";
import { MeteoraPresets } from "./presets";
import {
  createCloseAccountInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { SYSVAR_RENT_PUBKEY, SystemProgram } from "@solana/web3.js";

export class DLMMManager implements LiquidityStrategy {
  private static DEFAULT_BASE_FACTOR = 10000;
  private static U16_MAX = 65535;
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
    tokenDecimals: number = 6,
    binStep: number,
    invert: boolean
  ): number {
    const solDecimals = 9;
    const adjustedPrice =
      (solAmount * Math.pow(10, tokenDecimals)) /
      (tokenAmount * Math.pow(10, solDecimals));
    const price = invert ? 1 / adjustedPrice : adjustedPrice;
    const pricePerLamport = DLMM.getPricePerLamport(
      invert ? solDecimals : tokenDecimals,
      invert ? tokenDecimals : solDecimals,
      price
    );
    const activeId = DLMM.getBinIdFromPrice(pricePerLamport, binStep, false);
    Logger.info(
      `Calculated Active Bin ID: ${activeId} for price ${adjustedPrice}`
    );
    return activeId;
  }

  async initialize(
    options: LaunchOptions,
    mint: PublicKey
  ): Promise<{
    poolId: PublicKey;
    instructions: TransactionInstruction[];
    signers?: Keypair[];
  }> {
    Logger.info("Initializing Meteora DLMM Strategy...");

    const WSOL_MINT = NATIVE_MINT;

    // Token ordering
    const [tokenX, tokenY] =
      mint.toBuffer().compare(WSOL_MINT.toBuffer()) < 0
        ? [mint, WSOL_MINT]
        : [WSOL_MINT, mint];

    Logger.info(
      `Token Order: X=${tokenX.toBase58().slice(0, 8)}..., Y=${tokenY
        .toBase58()
        .slice(0, 8)}...`
    );

    const config = {
      binStep:
        options.meteora?.binStep ?? MeteoraPresets.MEMECOIN_VOLATILE.binStep,
      width: options.meteora?.width ?? MeteoraPresets.MEMECOIN_VOLATILE.width,
      strategyType:
        options.meteora?.strategyType ??
        MeteoraPresets.MEMECOIN_VOLATILE.strategyType,
    };

    const baseFactor =
      options.meteora?.baseFactor ?? DLMMManager.DEFAULT_BASE_FACTOR;
    const feeBpsNumber =
      options.meteora?.feeBps ??
      Math.floor((baseFactor * config.binStep) / 10000);

    const maxFeeBps = Math.floor(
      (DLMMManager.U16_MAX * config.binStep) / 10000
    );
    if (feeBpsNumber <= 0 || feeBpsNumber > maxFeeBps) {
      throw new Error(
        `Invalid Meteora feeBps: ${feeBpsNumber}. Max for binStep=${config.binStep} is ${maxFeeBps}.`
      );
    }

    const feeBps = new BN(feeBpsNumber);

    const solLiquidityAmount =
      options.liquidity?.solAmount ?? options.solLiquidityAmount ?? 0;
    const tokenLiquidityAmount =
      options.liquidity?.tokenAmount ?? options.tokenLiquidityAmount ?? 0;

    if (solLiquidityAmount <= 0 || tokenLiquidityAmount <= 0) {
      throw new Error(
        "Meteora DLMM requires both solAmount and tokenAmount to seed initial liquidity"
      );
    }

    // Calculate Active Bin ID
    const invertPrice = tokenX.equals(WSOL_MINT);
    const activeId = this.calculateActiveBinId(
      solLiquidityAmount,
      tokenLiquidityAmount,
      options.decimals,
      config.binStep,
      invertPrice
    );

    // Derive Pool Address
    const [poolPubkey] = deriveCustomizablePermissionlessLbPair(
      tokenX,
      tokenY,
      this.programId
    );
    Logger.info(`Derived Pool Address: ${poolPubkey.toBase58()}`);

    const program = createProgram(this.connection, { cluster: this.cluster });

    const activationType =
      options.meteoraOptions?.activationType === "slot" ? 0 : 1;
    const createTx = await DLMM.createCustomizablePermissionlessLbPair(
      this.connection,
      new BN(config.binStep),
      tokenX,
      tokenY,
      new BN(activeId),
      feeBps,
      activationType,
      false,
      this.wallet.publicKey,
      options.meteoraOptions?.activationPoint
        ? new BN(options.meteoraOptions.activationPoint)
        : undefined,
      false,
      { cluster: this.cluster, skipSolWrappingOperation: true }
    );

    const width = config.width;
    const lowerBinId = activeId - Math.floor(width / 2);
    const upperBinId = lowerBinId + width - 1;

    const binArrayIndexes = getBinArrayIndexesCoverage(
      new BN(lowerBinId),
      new BN(upperBinId)
    );

    const instructions: TransactionInstruction[] = [];

    instructions.push(...createTx.instructions);

    const binArrayPubkeys = binArrayIndexes.map((idx) => {
      return deriveBinArray(poolPubkey, idx, this.programId)[0];
    });

    const binArrayAccounts = await this.connection.getMultipleAccountsInfo(
      binArrayPubkeys,
      "confirmed"
    );

    for (let i = 0; i < binArrayIndexes.length; i++) {
      if (binArrayAccounts[i] !== null) continue;

      const idx = binArrayIndexes[i]!;
      const binArray = binArrayPubkeys[i]!;
      const ix = await program.methods
        .initializeBinArray(idx)
        .accountsPartial({
          binArray,
          funder: this.wallet.publicKey,
          lbPair: poolPubkey,
        })
        .instruction();
      instructions.push(ix);
    }

    const positionKeypair = Keypair.generate();
    const initPositionIx = await program.methods
      .initializePosition(lowerBinId, upperBinId - lowerBinId + 1)
      .accountsPartial({
        payer: this.wallet.publicKey,
        position: positionKeypair.publicKey,
        lbPair: poolPubkey,
        owner: this.wallet.publicKey,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .instruction();
    instructions.push(initPositionIx);

    const userTokenX = getAssociatedTokenAddressSync(
      tokenX,
      this.wallet.publicKey
    );
    const userTokenY = getAssociatedTokenAddressSync(
      tokenY,
      this.wallet.publicKey
    );

    const xDecimals = tokenX.equals(WSOL_MINT) ? 9 : options.decimals || 6;
    const yDecimals = tokenY.equals(WSOL_MINT) ? 9 : options.decimals || 6;

    const xAmountLamports = new BN(
      Math.floor(
        (tokenX.equals(WSOL_MINT) ? solLiquidityAmount : tokenLiquidityAmount) *
          Math.pow(10, xDecimals)
      )
    );
    const yAmountLamports = new BN(
      Math.floor(
        (tokenY.equals(WSOL_MINT) ? solLiquidityAmount : tokenLiquidityAmount) *
          Math.pow(10, yDecimals)
      )
    );

    const wsolCloseIxs: TransactionInstruction[] = [];
    if (tokenX.equals(WSOL_MINT) && xAmountLamports.gt(new BN(0))) {
      instructions.push(
        SystemProgram.transfer({
          fromPubkey: this.wallet.publicKey,
          toPubkey: userTokenX,
          lamports: Number(xAmountLamports.toString()),
        })
      );
      instructions.push(createSyncNativeInstruction(userTokenX));
      wsolCloseIxs.push(
        createCloseAccountInstruction(
          userTokenX,
          this.wallet.publicKey,
          this.wallet.publicKey
        )
      );
    }
    if (tokenY.equals(WSOL_MINT) && yAmountLamports.gt(new BN(0))) {
      instructions.push(
        SystemProgram.transfer({
          fromPubkey: this.wallet.publicKey,
          toPubkey: userTokenY,
          lamports: Number(yAmountLamports.toString()),
        })
      );
      instructions.push(createSyncNativeInstruction(userTokenY));
      wsolCloseIxs.push(
        createCloseAccountInstruction(
          userTokenY,
          this.wallet.publicKey,
          this.wallet.publicKey
        )
      );
    }

    const strategyParameters = toStrategyParameters({
      minBinId: lowerBinId,
      maxBinId: upperBinId,
      strategyType: config.strategyType,
    });

    const liquidityParam = {
      amountX: xAmountLamports,
      amountY: yAmountLamports,
      activeId,
      maxActiveBinSlippage: 1,
      strategyParameters,
    };

    const minBinArrayIndex = binIdToBinArrayIndex(new BN(lowerBinId));
    const maxBinArrayIndex = binIdToBinArrayIndex(new BN(upperBinId));
    const useExtension =
      isOverflowDefaultBinArrayBitmap(minBinArrayIndex) ||
      isOverflowDefaultBinArrayBitmap(maxBinArrayIndex);
    const binArrayBitmapExtension = useExtension
      ? deriveBinArrayBitmapExtension(poolPubkey, this.programId)[0]
      : null;

    const [reserveX] = deriveReserve(tokenX, poolPubkey, this.programId);
    const [reserveY] = deriveReserve(tokenY, poolPubkey, this.programId);

    const binArrayAccountMetas = getBinArrayAccountMetasCoverage(
      new BN(lowerBinId),
      new BN(upperBinId),
      poolPubkey,
      this.programId
    );

    const addLiquidityIx = await program.methods
      .addLiquidityByStrategy2(liquidityParam, { slices: [] })
      .accounts({
        position: positionKeypair.publicKey,
        lbPair: poolPubkey,
        binArrayBitmapExtension,
        userTokenX,
        userTokenY,
        reserveX,
        reserveY,
        tokenXMint: tokenX,
        tokenYMint: tokenY,
        sender: this.wallet.publicKey,
        tokenXProgram: TOKEN_PROGRAM_ID,
        tokenYProgram: TOKEN_PROGRAM_ID,
        eventAuthority: deriveEventAuthority(this.programId)[0],
        program: this.programId,
      } as any)
      .remainingAccounts(binArrayAccountMetas)
      .instruction();
    instructions.push(addLiquidityIx);

    instructions.push(...wsolCloseIxs);

    return {
      poolId: poolPubkey,
      instructions,
      signers: [positionKeypair],
    };
  }
}
