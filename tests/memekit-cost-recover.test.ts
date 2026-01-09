import { describe, it, expect } from "bun:test";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  type VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { MemeKit } from "../src/core/MemeKit";
import { DLMMManager } from "../src/strategies/meteora";

function baseLaunchOptions() {
  return {
    name: "Test",
    symbol: "TST",
    image: "https://example.com/img.png",
  };
}

describe("MemeKit.estimateLaunchCost", () => {
  it("should estimate meteora (default) cost with default jito tip + buffer", () => {
    const cost = MemeKit.estimateLaunchCost({
      ...baseLaunchOptions(),
      liquidity: { solAmount: 1, tokenAmount: 100 },
      dex: "meteora:dlmm",
    });

    expect(cost).toBeCloseTo(0.025 + 1 + 0.01 + 0.005, 8);
  });

  it("should estimate raydium cpmm cost", () => {
    const cost = MemeKit.estimateLaunchCost({
      ...baseLaunchOptions(),
      solLiquidityAmount: 2,
      dex: "raydium:cpmm",
      jitoTip: 0.02,
    });

    expect(cost).toBeCloseTo(0.15 + 2 + 0.02 + 0.005, 8);
  });

  it("should estimate raydium amm low-cost by default", () => {
    const cost = MemeKit.estimateLaunchCost({
      ...baseLaunchOptions(),
      liquidity: { solAmount: 0.5, tokenAmount: 100 },
      dex: "raydium:amm",
    });

    expect(cost).toBeCloseTo(0.6 + 0.5 + 0.01 + 0.005, 8);
  });

  it("should estimate raydium amm standard when marketMode is standard", () => {
    const cost = MemeKit.estimateLaunchCost({
      ...baseLaunchOptions(),
      liquidity: { solAmount: 0.5, tokenAmount: 100 },
      dex: "raydium:amm",
      marketMode: "standard",
    });

    expect(cost).toBeCloseTo(3.2 + 0.5 + 0.01 + 0.005, 8);
  });

  it("should support strategy field mapping to dex", () => {
    const cost = MemeKit.estimateLaunchCost({
      ...baseLaunchOptions(),
      strategy: "raydium-cpmm",
      liquidity: { solAmount: 1, tokenAmount: 100 },
    });

    expect(cost).toBeCloseTo(0.15 + 1 + 0.01 + 0.005, 8);
  });
});

describe("MemeKit.launch (devnet)", () => {
  it("should skip Jito and use connection.sendTransaction even if jitoTip is provided", async () => {
    const payer = Keypair.generate();
    const pk = bs58.encode(payer.secretKey);

    const kit = new MemeKit({
      rpcUrl: "http://localhost:8899",
      privateKey: pk,
      network: "devnet",
    });

    const blockhash = Keypair.generate().publicKey.toBase58();
    const lastValidBlockHeight = 123;
    const signature = "devnet_sig";

    let sendTransactionCalled = 0;
    let sendBundleCalled = 0;

    // Prevent any real RPC interactions
    (kit as any).connection = {
      getLatestBlockhash: async () => ({ blockhash, lastValidBlockHeight }),
      sendTransaction: async () => {
        sendTransactionCalled++;
        return signature;
      },
      confirmTransaction: async () => ({ value: { err: null } }),
    };

    // Avoid real minting & authority revokes
    (kit as any).tokenManager = {
      createToken: async () => ({ mint: payer }),
      revokeAuthorities: async () => {},
    };

    // Force the strategy to return a dummy instruction
    (kit as any).liquidityManager = {};
    (kit as any).marketManager = {};
    (kit as any).jitoManager = {
      sendBundle: async () => {
        sendBundleCalled++;
        return "bundle";
      },
    };

    // Monkeypatch DLMMManager.initialize so MemeKit.launch doesn't touch RPC.
    const dummyIx = SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: payer.publicKey,
      lamports: 1,
    });

    const dummyIx2 = SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: payer.publicKey,
      lamports: 2,
    });

    const originalInitialize = DLMMManager.prototype.initialize;
    DLMMManager.prototype.initialize = async function () {
      return {
        poolId: payer.publicKey,
        instructions: [dummyIx, dummyIx2],
        instructionGroups: [[dummyIx], [dummyIx2]],
        signers: [],
      };
    };

    try {
      const res = await kit.launch({
        ...baseLaunchOptions(),
        liquidity: { solAmount: 1, tokenAmount: 1 },
        dex: "meteora",
        jitoTip: 0.01,
      } as any);

      expect(res.signature).toBe(signature);
      expect(sendTransactionCalled).toBe(2);
      expect(sendBundleCalled).toBe(0);
    } finally {
      DLMMManager.prototype.initialize = originalInitialize;
    }
  });
});

describe("MemeKit.recoverFunds", () => {
  it("should sweep balance minus fee buffer and return tx signature", async () => {
    const payer = Keypair.generate();
    const dest = Keypair.generate();

    const kit = new MemeKit({
      rpcUrl: "http://localhost:8899",
      privateKey: bs58.encode(payer.secretKey),
      cluster: "devnet",
    });

    const balanceLamports = 100_000;
    const blockhash = Keypair.generate().publicKey.toBase58();
    const lastValidBlockHeight = 123;
    const signature = "test_signature";

    let capturedTx: VersionedTransaction | undefined;
    let confirmedArgs: any;

    (kit as any).connection = {
      getBalance: async () => balanceLamports,
      getLatestBlockhash: async () => ({ blockhash, lastValidBlockHeight }),
      sendTransaction: async (tx: VersionedTransaction) => {
        capturedTx = tx;
        return signature;
      },
      confirmTransaction: async (args: any) => {
        confirmedArgs = args;
        return { value: { err: null } };
      },
    };

    const txid = await kit.recoverFunds(dest.publicKey.toBase58());
    expect(txid).toBe(signature);

    // Confirm was called with the correct signature.
    expect(confirmedArgs.signature).toBe(signature);

    // Decode the SystemProgram.transfer instruction from the compiled message.
    expect(capturedTx).toBeDefined();
    const msg: any = (capturedTx as any).message;
    const ix = msg.compiledInstructions[0];
    const keys: PublicKey[] = msg.staticAccountKeys;

    expect(ix).toBeDefined();
    expect(keys.length).toBeGreaterThan(0);

    const programId = keys[ix.programIdIndex]!;
    expect(programId).toBeDefined();
    expect(programId.toBase58()).toBe(SystemProgram.programId.toBase58());

    const data = Buffer.from(ix.data);
    const discriminator = data.readUInt32LE(0);
    // System program transfer discriminator is 2.
    expect(discriminator).toBe(2);

    const lamports = data.readBigUInt64LE(4);
    expect(lamports).toBe(BigInt(balanceLamports - 5000));

    expect(ix.accountKeyIndexes.length).toBeGreaterThanOrEqual(2);
    const fromPubkey = keys[ix.accountKeyIndexes[0]!]!;
    const toPubkey = keys[ix.accountKeyIndexes[1]!]!;
    expect(fromPubkey.toBase58()).toBe(payer.publicKey.toBase58());
    expect(toPubkey.toBase58()).toBe(dest.publicKey.toBase58());
  });

  it("should throw if there is nothing to sweep", async () => {
    const payer = Keypair.generate();
    const dest = Keypair.generate();

    const kit = new MemeKit({
      rpcUrl: "http://localhost:8899",
      privateKey: bs58.encode(payer.secretKey),
      cluster: "devnet",
    });

    const blockhash = Keypair.generate().publicKey.toBase58();

    (kit as any).connection = {
      getBalance: async () => 5000,
      getLatestBlockhash: async () => ({ blockhash, lastValidBlockHeight: 1 }),
      sendTransaction: async () => "unused",
      confirmTransaction: async () => ({ value: { err: null } }),
    };

    await expect(kit.recoverFunds(dest.publicKey.toBase58())).rejects.toThrow(
      "No funds available to recover"
    );
  });
});
