import { describe, it, expect } from "bun:test";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { DLMMManager } from "../src/strategies/meteora/DLMMManager";
import type { LaunchOptions } from "../src/strategies/LiquidityStrategy";

describe("DLMMManager Anti-Snipe", () => {
  const connection = new Connection("https://api.devnet.solana.com");
  const wallet = Keypair.generate();
  const mint = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"); // Devnet USDC

  const readSystemTransferLamports = (ixData: Buffer) => {
    if (ixData.length < 12) return null;
    const discriminator = ixData.readUInt32LE(0);
    if (discriminator !== 2) return null;
    return Number(ixData.readBigUInt64LE(4));
  };

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

  it("should append dev-buy instructions before WSOL close when buyAmountSol is set", async () => {
    const dlmm = new DLMMManager(connection, wallet, "devnet");

    const buyAmountSol = 0.001;
    const buyLamports = Math.floor(buyAmountSol * 1e9);

    const options: LaunchOptions = {
      name: "Test",
      symbol: "TEST",
      image: "",
      liquidity: { solAmount: 1, tokenAmount: 1000000, buyAmountSol },
      decimals: 6,
    };

    const result = await dlmm.initialize(options, mint);
    expect(result.instructions.length).toBeGreaterThan(0);

    expect(result.instructionGroups?.length).toBeGreaterThan(0);

    // Find the buy transfer (SystemProgram.transfer uses discriminator 2)
    const buyTransferIndex = result.instructions.findIndex((ix) => {
      if (ix.programId.toBase58() !== "11111111111111111111111111111111") {
        return false;
      }
      const lamports = readSystemTransferLamports(Buffer.from(ix.data));
      return lamports === buyLamports;
    });
    expect(buyTransferIndex).toBeGreaterThanOrEqual(0);

    // Assert the final instructions include a WSOL close (SPL Token closeAccount = 9)
    const closeIndexes = result.instructions
      .map((ix, idx) => ({ ix, idx }))
      .filter(
        ({ ix }) =>
          ix.programId.equals(TOKEN_PROGRAM_ID) &&
          Buffer.from(ix.data).length > 0 &&
          Buffer.from(ix.data)[0] === 9
      )
      .map(({ idx }) => idx);

    expect(closeIndexes.length).toBeGreaterThan(0);
    const lastCloseIxIndex = Math.max(...closeIndexes);

    // Buy transfer must occur before WSOL close
    expect(buyTransferIndex).toBeLessThan(lastCloseIxIndex);
  });
});
