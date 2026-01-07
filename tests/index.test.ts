import { describe, it, expect } from "bun:test";
import { MemeKit, MeteoraPresets } from "../src";

describe("MemeKit SDK", () => {
  it("should export MemeKit class", () => {
    expect(MemeKit).toBeDefined();
  });

  it("should export MeteoraPresets", () => {
    expect(MeteoraPresets).toBeDefined();
    expect(MeteoraPresets.MEMECOIN_VOLATILE).toBeDefined();
    expect(MeteoraPresets.ANTI_SNIPE_FEE).toBeDefined();
  });

  it("should instantiate with config", () => {
    // Mock private key for testing
    const mockKey =
      "4Z7cXSyeFR8wNGTVXGcfAp5h4vJ4Yh5h5h5h5h5h5h5h5h5h5h5h5h5h5h5h5h5h5h5h5h5h5h5h5h5h5h5h5h";
    // Need valid 58 chars or just use a generated one
    const { Keypair } = require("@solana/web3.js");
    const bs58 = require("bs58").default || require("bs58");

    // Create a dummy keypair
    const kp = Keypair.generate();
    const pk = bs58.encode(kp.secretKey);

    const kit = new MemeKit({
      rpcUrl: "https://api.devnet.solana.com",
      privateKey: pk,
      cluster: "devnet",
    });

    expect(kit).toBeInstanceOf(MemeKit);
    expect(kit.tokenManager).toBeDefined();
    expect(kit.marketManager).toBeDefined();
    expect(kit.liquidityManager).toBeDefined();
  });
});
