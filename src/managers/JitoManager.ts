import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  Keypair,
} from "@solana/web3.js";
import { searcher } from "jito-ts";
import { Bundle } from "jito-ts/dist/sdk/block-engine/types";
import { Logger } from "../core/utils";
import type { BlockEngineRegion } from "../utils/jitoTools";
import { getBlockEngineHost, getRandomTipAccount } from "../utils/jitoTools";

export class JitoManager {
  private client: any;
  private region: BlockEngineRegion;

  constructor(
    private connection: Connection,
    private wallet: Keypair,
    private cluster: "mainnet-beta" | "devnet" = "mainnet-beta",
    region: BlockEngineRegion = "ny"
  ) {
    this.region = region;
    this.client = searcher.searcherClient(
      getBlockEngineHost(this.cluster, this.region)
    );
  }

  private setRegion(region: BlockEngineRegion) {
    if (region === this.region) return;
    this.region = region;
    this.client = searcher.searcherClient(
      getBlockEngineHost(this.cluster, this.region)
    );
  }

  /**
   * Sends a bundle of instructions with a Jito tip
   */
  async sendBundle(
    instructions: any[], // TransactionInstruction[]
    tipSol: number = 0.001,
    region?: BlockEngineRegion,
    extraSigners: Keypair[] = []
  ): Promise<string> {
    if (region) this.setRegion(region);
    Logger.info(`Preparing Jito Bundle with tip: ${tipSol} SOL`);

    const tipAccount = getRandomTipAccount();
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

    const { blockhash } = await this.connection.getLatestBlockhash("confirmed");

    const messageV0 = new TransactionMessage({
      payerKey: this.wallet.publicKey,
      recentBlockhash: blockhash,
      instructions: bundleInstructions,
    }).compileToV0Message();

    const versionedTx = new VersionedTransaction(messageV0);
    versionedTx.sign([this.wallet, ...extraSigners]);

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

  /**
   * Sends a bundle that contains multiple transactions.
   * The tip instruction is appended to the last transaction.
   */
  async sendBundleGroups(
    instructionGroups: any[][], // TransactionInstruction[][]
    tipSol: number = 0.001,
    region?: BlockEngineRegion,
    extraSigners: Keypair[] = []
  ): Promise<string> {
    if (region) this.setRegion(region);
    Logger.info(`Preparing Jito Bundle with tip: ${tipSol} SOL`);

    if (!Array.isArray(instructionGroups) || instructionGroups.length === 0) {
      throw new Error("instructionGroups must be a non-empty array");
    }

    const tipAccount = getRandomTipAccount();
    const tipLamports = Math.floor(tipSol * 1e9);

    const { blockhash } = await this.connection.getLatestBlockhash("confirmed");

    const txs = instructionGroups.map((group, idx) => {
      const isLast = idx === instructionGroups.length - 1;
      const groupInstructions = isLast
        ? [
            ...group,
            SystemProgram.transfer({
              fromPubkey: this.wallet.publicKey,
              toPubkey: tipAccount as PublicKey,
              lamports: tipLamports,
            }),
          ]
        : group;

      const messageV0 = new TransactionMessage({
        payerKey: this.wallet.publicKey,
        recentBlockhash: blockhash,
        instructions: groupInstructions,
      }).compileToV0Message();

      const versionedTx = new VersionedTransaction(messageV0);
      versionedTx.sign([this.wallet, ...extraSigners]);
      return versionedTx;
    });

    const b = new Bundle(txs, 5);

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
