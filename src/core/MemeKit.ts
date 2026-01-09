import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { TokenManager } from "../managers/TokenManager";
import { MarketManager } from "../managers/MarketManager";
import { LiquidityManager } from "../managers/LiquidityManager";
import type {
  LaunchOptions,
  LiquidityStrategy,
} from "../strategies/LiquidityStrategy";
import { DLMMManager } from "../strategies/meteora";
import { CPMMManager, AMMManager } from "../strategies/raydium";
import { Logger, loadKeypairEnv, getExplorerLink } from "./utils";
import { JitoManager } from "../managers/JitoManager";
import { getJitoTipFloor } from "../utils/jitoTools";
import dotenv from "dotenv";
import bs58 from "bs58";

dotenv.config();

export class MemeKit {
  private connection: Connection;
  private wallet: Keypair;
  private cluster: "mainnet-beta" | "devnet";
  private network: "mainnet-beta" | "devnet";

  public tokenManager: TokenManager;
  public marketManager: MarketManager;
  public liquidityManager: LiquidityManager;
  public jitoManager: JitoManager;

  constructor(config: {
    rpcUrl: string;
    privateKey?: string;
    cluster?: "mainnet-beta" | "devnet";
    network?: "mainnet-beta" | "devnet";
  }) {
    this.connection = new Connection(config.rpcUrl, "confirmed");
    this.network = config.network ?? config.cluster ?? "mainnet-beta";
    this.cluster = this.network;

    // Load wallet
    if (config.privateKey) {
      this.wallet = Keypair.fromSecretKey(bs58.decode(config.privateKey));
    } else {
      const loaded = loadKeypairEnv();
      if (!loaded) throw new Error("No private key provided or found in env");
      this.wallet = loaded;
    }

    this.tokenManager = new TokenManager(this.connection, this.wallet);
    this.marketManager = new MarketManager(this.connection, this.wallet);
    this.liquidityManager = new LiquidityManager(
      this.connection,
      this.wallet,
      this.cluster
    );
    this.jitoManager = new JitoManager(
      this.connection,
      this.wallet,
      this.cluster
    );
  }

  static estimateLaunchCost(options: LaunchOptions): number {
    const solLiquidity =
      options.liquidity?.solAmount ?? options.solLiquidityAmount ?? 0;

    const selected =
      options.dex ??
      (options.strategy === "meteora"
        ? "meteora"
        : options.strategy === "raydium-cpmm"
        ? "raydium:cpmm"
        : options.strategy === "raydium-amm"
        ? "raydium:amm"
        : "meteora");
    const dex = selected === "meteora" ? "meteora:dlmm" : selected;

    let baseFees = 0;
    switch (dex) {
      case "meteora:dlmm":
        baseFees = 0.025;
        break;
      case "raydium:cpmm":
        baseFees = 0.15;
        break;
      case "raydium:amm":
        baseFees =
          (options.marketMode ?? "low-cost") === "low-cost" ? 0.6 : 3.2;
        break;
      default:
        baseFees = 0.025;
        break;
    }

    // LFG can involve a larger bin range which increases rent due to more bin arrays.
    // Keep the default (non-LFG) estimate unchanged, and add a small increment when the
    // estimated bin range exceeds the default width.
    const lfg = options.meteora?.lfg;
    if (
      dex === "meteora:dlmm" &&
      lfg?.minPrice !== undefined &&
      lfg?.maxPrice !== undefined
    ) {
      const binStep = options.meteora?.binStep ?? 100;
      const minPrice = Math.min(lfg.minPrice, lfg.maxPrice);
      const maxPrice = Math.max(lfg.minPrice, lfg.maxPrice);
      if (minPrice > 0 && maxPrice > 0 && binStep > 0) {
        const step = binStep / 10000;
        const ratio = maxPrice / minPrice;
        const binCount = Math.max(
          1,
          Math.floor(Math.log(ratio) / Math.log(1 + step)) + 1
        );

        const binsPerArray = 70;
        const defaultWidth = 80;
        const defaultBinArrays = Math.ceil(defaultWidth / binsPerArray);
        const binArrays = Math.ceil(binCount / binsPerArray);
        const extraBinArrays = Math.max(0, binArrays - defaultBinArrays);

        const rentPerExtraBinArraySol = 0.001;
        baseFees += extraBinArrays * rentPerExtraBinArraySol;
      }
    }

    const jitoTip =
      typeof options.jitoTip === "number" ? options.jitoTip : 0.01;
    const buffer = 0.005;

    return baseFees + solLiquidity + jitoTip + buffer;
  }

  static async getSmartTip(): Promise<number> {
    return getJitoTipFloor();
  }

  async recoverFunds(destinationAddress: string): Promise<string> {
    const destination = new PublicKey(destinationAddress);
    const balance = await this.connection.getBalance(
      this.wallet.publicKey,
      "confirmed"
    );

    const transactionFeeLamports = 5000;
    const maxTransfer = balance - transactionFeeLamports;
    if (maxTransfer <= 0) {
      throw new Error("No funds available to recover");
    }

    const { blockhash, lastValidBlockHeight } =
      await this.connection.getLatestBlockhash("confirmed");

    const messageV0 = new TransactionMessage({
      payerKey: this.wallet.publicKey,
      recentBlockhash: blockhash,
      instructions: [
        SystemProgram.transfer({
          fromPubkey: this.wallet.publicKey,
          toPubkey: destination,
          lamports: maxTransfer,
        }),
      ],
    }).compileToV0Message();

    const versionedTx = new VersionedTransaction(messageV0);
    versionedTx.sign([this.wallet]);

    const signature = await this.connection.sendTransaction(versionedTx);
    await this.connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      "confirmed"
    );
    return signature;
  }

  async launch(options: LaunchOptions) {
    const selected =
      options.dex ??
      (options.strategy === "meteora"
        ? "meteora"
        : options.strategy === "raydium-cpmm"
        ? "raydium:cpmm"
        : options.strategy === "raydium-amm"
        ? "raydium:amm"
        : "meteora");
    const dex = selected === "meteora" ? "meteora:dlmm" : selected;

    Logger.info(`Starting Launch on strategy: ${dex}`);

    const sendOptions = options.txOptions
      ? {
          skipPreflight: options.txOptions.skipPreflight,
          minContextSlot: options.txOptions.minContextSlot,
          maxRetries: options.txOptions.maxRetries,
        }
      : undefined;

    // 1. Create Token
    const { mint } = await this.tokenManager.createToken(
      {
        name: options.name,
        symbol: options.symbol,
        uri: options.image,
        decimals: options.decimals,
        initialSupply: options.supply || 1_000_000_000,
      },
      options.txOptions
    );
    Logger.info(`Token Minted: ${mint.publicKey.toBase58()}`);

    // 2. Revoke Authorities
    await this.tokenManager.revokeAuthorities(
      mint.publicKey,
      this.wallet,
      options.txOptions
    );

    // 3. Execute Liquidity Strategy
    let strategy: LiquidityStrategy;
    switch (dex) {
      case "meteora:dlmm":
        strategy = new DLMMManager(
          this.connection,
          this.wallet,
          this.cluster === "devnet" ? "devnet" : "mainnet-beta"
        );
        break;
      case "raydium:cpmm":
        strategy = new CPMMManager(this.connection, this.wallet, this.cluster);
        break;
      case "raydium:amm":
        strategy = new AMMManager(
          this.connection,
          this.wallet,
          this.marketManager,
          this.cluster
        );
        break;
      default:
        throw new Error(`Unknown DEX strategy: ${dex}`);
    }

    const { poolId, instructions, instructionGroups, signers } =
      await strategy.initialize(options, mint.publicKey);
    Logger.info(
      `Liquidity Setup Instructions Generated. Pool: ${poolId.toBase58()}`
    );

    // 4. Send Transaction (Jito or Real SOL)
    let signature = "Dry-run (not sent)";
    if (instructions.length > 0) {
      const groups =
        instructionGroups && instructionGroups.length > 0
          ? instructionGroups
          : [instructions];

      if (this.network === "devnet") {
        Logger.info("Running on Devnet. Jito Bundling skipped.");

        try {
          for (const group of groups) {
            const recentBlockhash = await this.connection.getLatestBlockhash();
            const messageV0 = new TransactionMessage({
              payerKey: this.wallet.publicKey,
              recentBlockhash: recentBlockhash.blockhash,
              instructions: group,
            }).compileToV0Message();

            const versionedTx = new VersionedTransaction(messageV0);

            // Filter signers to only those required by this group's message
            const requiredSignerKeys = new Set(
              messageV0.staticAccountKeys
                .slice(0, messageV0.header.numRequiredSignatures)
                .map((k) => k.toBase58())
            );
            const groupSigners = [
              this.wallet,
              ...(signers ?? []).filter((s) =>
                requiredSignerKeys.has(s.publicKey.toBase58())
              ),
            ];
            versionedTx.sign(groupSigners);

            Logger.info("Sending Liquidity Setup Transaction...");
            signature = await this.connection.sendTransaction(
              versionedTx,
              sendOptions
            );
            const logTxFailure = async () => {
              try {
                const tx = await this.connection.getTransaction(signature, {
                  commitment: "confirmed",
                  maxSupportedTransactionVersion: 0,
                });
                if (tx?.meta?.logMessages) {
                  Logger.error(`On-chain logs for ${signature}:`);
                  for (const l of tx.meta.logMessages) Logger.error(l);
                }
                if (tx?.meta?.err) {
                  Logger.error(
                    `On-chain error for ${signature}: ${JSON.stringify(
                      tx.meta.err
                    )}`
                  );
                }
              } catch {
                // ignore
              }
            };

            let confirmation:
              | Awaited<ReturnType<typeof this.connection.confirmTransaction>>
              | undefined;
            try {
              confirmation = await this.connection.confirmTransaction(
                {
                  signature,
                  blockhash: recentBlockhash.blockhash,
                  lastValidBlockHeight: recentBlockhash.lastValidBlockHeight,
                },
                "confirmed"
              );
            } catch (e: any) {
              await logTxFailure();
              const msg =
                e instanceof Error
                  ? e.message
                  : typeof e === "string"
                  ? e
                  : JSON.stringify(e);
              throw new Error(
                `confirmTransaction threw (sig=${signature}): ${msg}`
              );
            }
            if (confirmation?.value?.err) {
              await logTxFailure();
              throw new Error(
                `Transaction reverted on-chain (sig=${signature}): ${JSON.stringify(
                  confirmation.value.err
                )}`
              );
            }
            Logger.info(`Transaction Confirmed: ${signature}`);
            Logger.info("Transaction Confirmed! ✓");
            Logger.info(
              `Explorer: ${getExplorerLink("tx", signature, this.cluster)}`
            );
          }
        } catch (err: any) {
          const msg =
            err instanceof Error
              ? err.message
              : typeof err === "string"
              ? err
              : JSON.stringify(err);
          Logger.error(`Transaction failed: ${msg}`);
          throw err;
        }
      } else if (options.jitoTip !== undefined) {
        const tipSol =
          options.jitoTip === "auto"
            ? await getJitoTipFloor()
            : (options.jitoTip as number);

        if (options.jitoTip === "auto") {
          Logger.info(`Using Smart Tip: ${tipSol} SOL`);
        }

        Logger.info(`Launching with Jito Bundle (Tip: ${tipSol} SOL)...`);
        try {
          const bundleId =
            groups.length > 1
              ? await this.jitoManager.sendBundleGroups(
                  groups,
                  tipSol,
                  options.blockEngine,
                  signers ?? []
                )
              : await this.jitoManager.sendBundle(
                  instructions,
                  tipSol,
                  options.blockEngine,
                  signers ?? []
                );
          signature = bundleId;
          Logger.info(`Bundle Submitted: ${bundleId}`);
        } catch (err: any) {
          Logger.error(`Jito Bundle failed: ${err.message}`);
          throw err;
        }
      } else {
        const recentBlockhash = await this.connection.getLatestBlockhash();
        const messageV0 = new TransactionMessage({
          payerKey: this.wallet.publicKey,
          recentBlockhash: recentBlockhash.blockhash,
          instructions,
        }).compileToV0Message();

        const versionedTx = new VersionedTransaction(messageV0);

        // Filter signers to only those required by the message
        const requiredSignerKeys = new Set(
          messageV0.staticAccountKeys
            .slice(0, messageV0.header.numRequiredSignatures)
            .map((k) => k.toBase58())
        );
        const txSigners = [
          this.wallet,
          ...(signers ?? []).filter((s) =>
            requiredSignerKeys.has(s.publicKey.toBase58())
          ),
        ];
        versionedTx.sign(txSigners);

        Logger.info("Sending Liquidity Setup Transaction...");
        try {
          signature = await this.connection.sendTransaction(
            versionedTx,
            sendOptions
          );
          const logTxFailure = async () => {
            try {
              const tx = await this.connection.getTransaction(signature, {
                commitment: "confirmed",
                maxSupportedTransactionVersion: 0,
              });
              if (tx?.meta?.logMessages) {
                Logger.error(`On-chain logs for ${signature}:`);
                for (const l of tx.meta.logMessages) Logger.error(l);
              }
              if (tx?.meta?.err) {
                Logger.error(
                  `On-chain error for ${signature}: ${JSON.stringify(
                    tx.meta.err
                  )}`
                );
              }
            } catch {
              // ignore
            }
          };

          let confirmation:
            | Awaited<ReturnType<typeof this.connection.confirmTransaction>>
            | undefined;
          try {
            confirmation = await this.connection.confirmTransaction(
              {
                signature,
                blockhash: recentBlockhash.blockhash,
                lastValidBlockHeight: recentBlockhash.lastValidBlockHeight,
              },
              "confirmed"
            );
          } catch (e: any) {
            await logTxFailure();
            const msg =
              e instanceof Error
                ? e.message
                : typeof e === "string"
                ? e
                : JSON.stringify(e);
            throw new Error(
              `confirmTransaction threw (sig=${signature}): ${msg}`
            );
          }

          if (confirmation?.value?.err) {
            await logTxFailure();
            throw new Error(
              `Transaction reverted on-chain (sig=${signature}): ${JSON.stringify(
                confirmation.value.err
              )}`
            );
          }

          Logger.info(`Transaction Confirmed: ${signature}`);
          Logger.info("Transaction Confirmed! ✓");
          Logger.info(
            `Explorer: ${getExplorerLink("tx", signature, this.cluster)}`
          );
        } catch (err: any) {
          const msg =
            err instanceof Error
              ? err.message
              : typeof err === "string"
              ? err
              : JSON.stringify(err);
          Logger.error(`Transaction failed: ${msg}`);
          throw err;
        }
      }
    }

    return {
      mint: mint.publicKey.toBase58(),
      poolId: poolId.toBase58(),
      marketId: dex === "raydium:amm" ? "Generated internally" : "Not Required",
      strategy: dex,
      signature,
    };
  }
}
