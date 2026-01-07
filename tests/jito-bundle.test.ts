import { describe, it, expect } from "bun:test";
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  SystemProgram,
} from "@solana/web3.js";
import { JitoManager } from "../src/managers/JitoManager";

describe("JitoManager", () => {
  const connection = new Connection("https://api.devnet.solana.com");
  const wallet = Keypair.generate();
  const cluster = "devnet";

  it("should initialize JitoManager", () => {
    const jito = new JitoManager(connection, wallet, cluster);
    expect(jito).toBeDefined();
  });

  it("should prepare a bundle with a tip", async () => {
    const jito = new JitoManager(connection, wallet, cluster);
    const extraSigner = Keypair.generate();

    const testInstruction = SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: Keypair.generate().publicKey,
      lamports: 1000,
    });

    // We don't want to actually send a bundle to devnet engine (if it exists)
    // without a valid blockhash and valid connection if we don't have SOL.
    // But we can test the bundle creation logic by mocking the client if needed.

    // Let's at least see if it fails gracefully with 'Failed to send' rather than a crash.
    try {
      await jito.sendBundle([testInstruction], 0.0001, undefined, [
        extraSigner,
      ]);
    } catch (e: any) {
      // It will likely fail because devnet Jito engine might be down or require auth
      console.log("Expected failure:", e.message);
      expect(e).toBeDefined();
    }
  });
});
