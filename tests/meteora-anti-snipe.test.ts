import { describe, it, expect } from "bun:test";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { DLMMManager } from "../src/strategies/meteora/DLMMManager";
import type { LaunchOptions } from "../src/strategies/LiquidityStrategy";

describe("DLMMManager Anti-Snipe", () => {
  const connection = new Connection("https://api.devnet.solana.com");
  const wallet = Keypair.generate();
  const mint = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"); // Devnet USDC

  it("should generate instructions with activation point", async () => {
    const dlmm = new DLMMManager(connection, wallet, "devnet");

    const options: LaunchOptions = {
      name: "Test",
      symbol: "TEST",
      image: "",
      liquidity: { solAmount: 1, tokenAmount: 1000000 },
      decimals: 6,
      meteoraOptions: {
        activationPoint: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
        activationType: "timestamp",
      },
    };

    const result = await dlmm.initialize(options, mint);

    expect(result.poolId).toBeDefined();
    expect(result.instructions.length).toBeGreaterThan(0);
    expect(result.signers?.length).toBeGreaterThan(0);

    console.log(`Pool Address: ${result.poolId.toBase58()}`);
    console.log(`Generated ${result.instructions.length} instructions.`);
  });
});
