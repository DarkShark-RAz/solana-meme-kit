import {
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import type {
  LiquidityStrategy,
  LaunchOptions,
  MeteoraOptions,
} from "../LiquidityStrategy";
import DLMM, {
  binIdToBinArrayIndex,
  createProgram,
  deriveCustomizablePermissionlessLbPair,
  deriveBinArray,
  deriveBinArrayBitmapExtension,
  deriveEventAuthority,
  deriveOracle,
  deriveReserve,
  MEMO_PROGRAM_ID,
  getBinArrayAccountMetasCoverage,
  getBinArrayIndexesCoverage,
  isOverflowDefaultBinArrayBitmap,
  LBCLMM_PROGRAM_IDS,
  StrategyType,
  toStrategyParameters,
} from "@meteora-ag/dlmm";
import BN from "bn.js";
import { Logger } from "../../core/utils";
import { LaunchStyles, MeteoraPresets } from "./presets";
import {
  createAssociatedTokenAccountIdempotentInstruction,
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
  private static MAX_LFG_BINS_SINGLE_TX = 26;
  private static DLMM_DEFAULT_BIN_PER_POSITION = 70;
  private static MEMEKIT_POSITION_WIDTH_CAP = 60;
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
    const price = invert ? tokenAmount / solAmount : solAmount / tokenAmount;
    const pricePerLamport = DLMM.getPricePerLamport(
      invert ? solDecimals : tokenDecimals,
      invert ? tokenDecimals : solDecimals,
      price
    );
    const activeId = DLMM.getBinIdFromPrice(pricePerLamport, binStep, false);
    Logger.info(`Calculated Active Bin ID: ${activeId} for price ${price}`);
    return activeId;
  }

  private priceToBinId(
    price: number,
    tokenDecimals: number = 6,
    binStep: number,
    invert: boolean
  ): number {
    const solDecimals = 9;
    const p = invert ? 1 / price : price;
    const pricePerLamport = DLMM.getPricePerLamport(
      invert ? solDecimals : tokenDecimals,
      invert ? tokenDecimals : solDecimals,
      p
    );
    return DLMM.getBinIdFromPrice(pricePerLamport, binStep, false);
  }

  private calculateLfgDistribution(params: {
    activeBinId: number;
    lowerBinId: number;
    upperBinId: number;
    curvature: number;
  }): { binId: number; weight: number }[] {
    const { activeBinId, lowerBinId, upperBinId, curvature } = params;

    const safeCurvature = Math.max(0, Math.min(1, curvature));
    const binCount = upperBinId - lowerBinId + 1;
    if (binCount <= 0) return [];

    const center = Math.max(lowerBinId, Math.min(upperBinId, activeBinId));
    const alpha = 1 + safeCurvature * 12;
    const maxDist = Math.max(
      1,
      Math.max(center - lowerBinId, upperBinId - center)
    );

    const raw: number[] = [];
    let total = 0;
    for (let binId = lowerBinId; binId <= upperBinId; binId++) {
      const dist = Math.abs(binId - center) / maxDist;
      const w = Math.exp(-alpha * dist);
      raw.push(w);
      total += w;
    }

    const targetSum = 10000;
    const weights: number[] = [];
    let running = 0;
    for (let i = 0; i < raw.length; i++) {
      const w = Math.max(1, Math.floor((raw[i]! / total) * targetSum));
      weights.push(w);
      running += w;
    }
    const diff = targetSum - running;
    weights[weights.length - 1] = Math.max(
      1,
      weights[weights.length - 1]! + diff
    );

    return weights.map((weight, i) => ({
      binId: lowerBinId + i,
      weight,
    }));
  }

  async initialize(
    options: LaunchOptions,
    mint: PublicKey
  ): Promise<{
    poolId: PublicKey;
    instructions: TransactionInstruction[];
    instructionGroups?: TransactionInstruction[][];
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

    const meteora: MeteoraOptions = options.meteora ?? LaunchStyles.VIRAL;

    const strategyTypeFromString = (s?: string) => {
      switch (s) {
        case "Curve":
          return StrategyType.Curve;
        case "BidAsk":
          return StrategyType.BidAsk;
        case "Spot":
        default:
          return StrategyType.Spot;
      }
    };

    let binStep = meteora.binStep ?? LaunchStyles.VIRAL.binStep;
    const width = Math.min(
      meteora.width ?? LaunchStyles.VIRAL.width,
      DLMMManager.MEMEKIT_POSITION_WIDTH_CAP
    );

    const baseFactor = meteora.baseFactor ?? DLMMManager.DEFAULT_BASE_FACTOR;
    let feeBpsNumber =
      meteora.feeBps ?? Math.floor((baseFactor * binStep) / 10000);

    if (this.cluster === "devnet") {
      Logger.info(
        "Devnet detected: forcing Meteora factory preset binStep=10 and feeBps=1000"
      );
      binStep = 10;
      feeBpsNumber = 1000;
    }

    const config = {
      binStep,
      width,
      strategyType:
        meteora.strategyType ??
        strategyTypeFromString(meteora.strategy ?? LaunchStyles.VIRAL.strategy),
      includeAlphaVault: meteora.includeAlphaVault ?? false,
    };

    const feeBps = new BN(feeBpsNumber);

    const solLiquidityAmount =
      options.liquidity?.solAmount ?? options.solLiquidityAmount ?? 0;
    const tokenLiquidityAmount =
      options.liquidity?.tokenAmount ?? options.tokenLiquidityAmount ?? 0;
    const buyAmountSol = options.liquidity?.buyAmountSol ?? 0;

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
      options.decimals ?? 6,
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

    let activationType =
      options.meteoraOptions?.activationType === "slot" ? 0 : 1;
    let activationPoint: BN | undefined;
    const activationDate =
      meteora.activationDate ?? options.meteoraOptions?.activationDate;

    if (activationDate) {
      activationType = 1;
      activationPoint = new BN(Math.floor(activationDate.getTime() / 1000));

      if (activationDate.getTime() > Date.now()) {
        Logger.info(
          `Pool created. Trading starts at ${activationDate.toISOString()}.`
        );
      }
    } else if (options.meteoraOptions?.activationPoint !== undefined) {
      activationPoint = new BN(options.meteoraOptions.activationPoint);
    } else {
      activationPoint = undefined;
    }

    const createTx = await DLMM.createCustomizablePermissionlessLbPair2(
      this.connection,
      new BN(config.binStep),
      tokenX,
      tokenY,
      new BN(activeId),
      feeBps,
      activationType,
      config.includeAlphaVault,
      this.wallet.publicKey,
      activationPoint,
      false,
      { cluster: this.cluster }
    );

    const lfg = meteora.lfg;
    const hasLfg =
      lfg?.minPrice !== undefined &&
      lfg?.maxPrice !== undefined &&
      (lfg?.curvature !== undefined || lfg !== undefined);
    let lowerBinId: number;
    let upperBinId: number;
    if (lfg) {
      if (lfg.minPrice === undefined || lfg.maxPrice === undefined) {
        throw new Error("meteora.lfg requires minPrice and maxPrice");
      }
      const curvature = lfg.curvature ?? 0.6;
      if (lfg.minPrice <= 0 || lfg.maxPrice <= 0) {
        throw new Error("meteora.lfg minPrice/maxPrice must be > 0");
      }
      const minPrice = Math.min(lfg.minPrice, lfg.maxPrice);
      const maxPrice = Math.max(lfg.minPrice, lfg.maxPrice);
      const minBinId = this.priceToBinId(
        minPrice,
        options.decimals ?? 6,
        config.binStep,
        invertPrice
      );
      const maxBinId = this.priceToBinId(
        maxPrice,
        options.decimals ?? 6,
        config.binStep,
        invertPrice
      );
      lowerBinId = Math.min(minBinId, maxBinId);
      upperBinId = Math.max(minBinId, maxBinId);
    } else {
      const width = Math.min(
        config.width,
        DLMMManager.DLMM_DEFAULT_BIN_PER_POSITION
      );
      lowerBinId = activeId - Math.floor(width / 2);
      upperBinId = lowerBinId + width - 1;
    }

    const binCount = upperBinId - lowerBinId + 1;
    if (binCount > DLMMManager.DLMM_DEFAULT_BIN_PER_POSITION) {
      throw new Error(
        `Meteora DLMM position width too large (${binCount}). Max supported is ${DLMMManager.DLMM_DEFAULT_BIN_PER_POSITION}. Reduce meteora.width or meteora.lfg range.`
      );
    }
    const shouldUseLfgWeights =
      hasLfg && binCount <= DLMMManager.MAX_LFG_BINS_SINGLE_TX;

    const binArrayIndexes = getBinArrayIndexesCoverage(
      new BN(lowerBinId),
      new BN(upperBinId)
    );

    const instructionGroups: TransactionInstruction[][] = [];
    const createGroup: TransactionInstruction[] = [];
    const liquidityGroup: TransactionInstruction[] = [];
    const swapGroup: TransactionInstruction[] = [];

    createGroup.push(...createTx.instructions);

    // For a brand new pool, bin arrays won't exist yet. Build init instructions deterministically
    // without relying on RPC state (important for atomic create+seed flows).
    for (const idx of binArrayIndexes) {
      const binArray = deriveBinArray(poolPubkey, idx, this.programId)[0];
      const ix = await program.methods
        .initializeBinArray(idx)
        .accountsPartial({
          binArray,
          funder: this.wallet.publicKey,
          lbPair: poolPubkey,
        })
        .instruction();
      createGroup.push(ix);
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
    createGroup.push(initPositionIx);

    const userTokenX = getAssociatedTokenAddressSync(
      tokenX,
      this.wallet.publicKey
    );
    const userTokenY = getAssociatedTokenAddressSync(
      tokenY,
      this.wallet.publicKey
    );

    createGroup.push(
      createAssociatedTokenAccountIdempotentInstruction(
        this.wallet.publicKey,
        userTokenX,
        this.wallet.publicKey,
        tokenX
      )
    );
    createGroup.push(
      createAssociatedTokenAccountIdempotentInstruction(
        this.wallet.publicKey,
        userTokenY,
        this.wallet.publicKey,
        tokenY
      )
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
      liquidityGroup.push(
        SystemProgram.transfer({
          fromPubkey: this.wallet.publicKey,
          toPubkey: userTokenX,
          lamports: Number(xAmountLamports.toString()),
        })
      );
      liquidityGroup.push(createSyncNativeInstruction(userTokenX));
      wsolCloseIxs.push(
        createCloseAccountInstruction(
          userTokenX,
          this.wallet.publicKey,
          this.wallet.publicKey
        )
      );
    }
    if (tokenY.equals(WSOL_MINT) && yAmountLamports.gt(new BN(0))) {
      liquidityGroup.push(
        SystemProgram.transfer({
          fromPubkey: this.wallet.publicKey,
          toPubkey: userTokenY,
          lamports: Number(yAmountLamports.toString()),
        })
      );
      liquidityGroup.push(createSyncNativeInstruction(userTokenY));
      wsolCloseIxs.push(
        createCloseAccountInstruction(
          userTokenY,
          this.wallet.publicKey,
          this.wallet.publicKey
        )
      );
    }

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

    if (shouldUseLfgWeights) {
      const curvature = lfg!.curvature ?? 0.6;
      const dist = this.calculateLfgDistribution({
        activeBinId: activeId,
        lowerBinId,
        upperBinId,
        curvature,
      });
      if (dist.length === 0) {
        throw new Error("Failed to compute LFG distribution");
      }

      const lowerBinArray = deriveBinArray(
        poolPubkey,
        minBinArrayIndex,
        this.programId
      )[0];
      const upperBinArray = deriveBinArray(
        poolPubkey,
        maxBinArrayIndex,
        this.programId
      )[0];

      const liquidityParamByWeight = {
        amountX: xAmountLamports,
        amountY: yAmountLamports,
        activeId,
        maxActiveBinSlippage: 1,
        binLiquidityDist: dist,
      };

      const addLiquidityIx = await (program.methods as any)
        .addLiquidityByWeight(liquidityParamByWeight)
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
          binArrayLower: lowerBinArray,
          binArrayUpper: upperBinArray,
          sender: this.wallet.publicKey,
          tokenXProgram: TOKEN_PROGRAM_ID,
          tokenYProgram: TOKEN_PROGRAM_ID,
          eventAuthority: deriveEventAuthority(this.programId)[0],
          program: this.programId,
        } as any)
        .remainingAccounts(binArrayAccountMetas)
        .instruction();
      liquidityGroup.push(addLiquidityIx);
    } else {
      const strategyParameters = toStrategyParameters({
        minBinId: lowerBinId,
        maxBinId: upperBinId,
        strategyType: hasLfg ? StrategyType.Spot : config.strategyType,
      });

      const liquidityParam = {
        amountX: xAmountLamports,
        amountY: yAmountLamports,
        activeId,
        maxActiveBinSlippage: 1,
        strategyParameters,
      };

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
      liquidityGroup.push(addLiquidityIx);
    }

    if (buyAmountSol > 0) {
      if (!Number.isFinite(buyAmountSol) || buyAmountSol <= 0) {
        throw new Error("liquidity.buyAmountSol must be a finite number > 0");
      }

      const buyLamports = Math.floor(buyAmountSol * 1e9);
      const buyAmountLamports = new BN(buyLamports);

      const inToken = WSOL_MINT;
      const outToken = mint;

      const userTokenIn = inToken.equals(tokenX) ? userTokenX : userTokenY;
      const userTokenOut = outToken.equals(tokenX) ? userTokenX : userTokenY;

      // Top-up WSOL for the buy (we already wrapped enough for initial liquidity)
      swapGroup.push(
        SystemProgram.transfer({
          fromPubkey: this.wallet.publicKey,
          toPubkey: userTokenIn,
          lamports: buyLamports,
        })
      );
      swapGroup.push(createSyncNativeInstruction(userTokenIn));

      const swapIx = await (program.methods as any)
        .swap2(buyAmountLamports, new BN(0), { slices: [] })
        .accountsPartial({
          lbPair: poolPubkey,
          reserveX,
          reserveY,
          tokenXMint: tokenX,
          tokenYMint: tokenY,
          tokenXProgram: TOKEN_PROGRAM_ID,
          tokenYProgram: TOKEN_PROGRAM_ID,
          user: this.wallet.publicKey,
          userTokenIn,
          userTokenOut,
          binArrayBitmapExtension,
          oracle: deriveOracle(poolPubkey, this.programId)[0],
          hostFeeIn: null,
          memoProgram: MEMO_PROGRAM_ID,
        })
        .remainingAccounts(binArrayAccountMetas)
        .instruction();

      swapGroup.push(swapIx);
    }

    // Close WSOL at the end of the last group that needs it.
    if (buyAmountSol > 0) {
      swapGroup.push(...wsolCloseIxs);
    } else {
      liquidityGroup.push(...wsolCloseIxs);
    }

    instructionGroups.push(createGroup);
    instructionGroups.push(liquidityGroup);
    if (swapGroup.length > 0) {
      instructionGroups.push(swapGroup);
    }

    const instructions = instructionGroups.flat();

    return {
      poolId: poolPubkey,
      instructions,
      instructionGroups,
      signers: [positionKeypair],
    };
  }
}
