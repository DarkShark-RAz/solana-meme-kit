import { describe, it, expect } from "bun:test";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import dotenv from "dotenv";
import { DLMMManager } from "../src/strategies/meteora/DLMMManager";

dotenv.config();

describe("Mainnet configuration (dry-run)", () => {
  it("should build Meteora DLMM mainnet instructions without devnet overrides", async () => {
    if (process.env.SKIP_MAINNET_TESTS === "true") return;

    const rpcUrl =
      process.env.MAINNET_RPC_URL ?? "https://api.mainnet-beta.solana.com";
    const connection = new Connection(rpcUrl, "confirmed");

    const wallet = Keypair.generate();
    const dlmm = new DLMMManager(connection, wallet, "mainnet-beta");

    const USDC_MAINNET = new PublicKey(
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
    );

    const result = await dlmm.initialize(
      {
        name: "Test",
        symbol: "TEST",
        image: "",
        liquidity: { solAmount: 0.01, tokenAmount: 10 },
        decimals: 6,
        meteora: { binStep: 100, width: 60 },
      },
      USDC_MAINNET
    );

    expect(result.poolId).toBeDefined();
    expect(result.instructions.length).toBeGreaterThan(0);
  });
});
