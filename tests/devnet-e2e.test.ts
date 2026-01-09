import { describe, it, expect } from "bun:test";
import { Connection, Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { MemeKit } from "../src/core/MemeKit";
import { Logger } from "../src/core/utils";

const run = process.env.RUN_DEVNET_E2E === "1";
const maybeDescribe = run ? describe : describe.skip;

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timeout: any;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(
      () => reject(new Error("E2E attempt timed out")),
      timeoutMs
    );
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForBalanceAtLeast(
  connection: Connection,
  pubkey: any,
  minLamports: number,
  timeoutMs: number
) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const bal = await safeGetBalance(connection, pubkey);
    if (typeof bal === "number" && bal >= minLamports) return bal;
    await sleep(1000);
  }
  const bal = await safeGetBalance(connection, pubkey);
  throw new Error(
    `Timed out waiting for funding. balance=${
      bal ?? "?"
    } lamports, required=${minLamports}`
  );
}

async function safeGetSlot(connection: Connection) {
  try {
    return await connection.getSlot("processed");
  } catch {
    return undefined;
  }
}

async function safeGetBalance(connection: Connection, pubkey: any) {
  try {
    return await connection.getBalance(pubkey, "processed");
  } catch {
    return undefined;
  }
}

async function dumpErrorLogs(connection: Connection, err: any) {
  try {
    if (err && typeof err.getLogs === "function") {
      try {
        const logs =
          err.getLogs.length > 0
            ? await err.getLogs(connection)
            : await err.getLogs();
        if (logs) {
          Logger.error("E2E tx logs:", logs);
        }
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
}

async function waitForConfirmedTxSlot(
  connection: Connection,
  signature: string
) {
  for (let i = 0; i < 30; i++) {
    const tx = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (tx) return tx.slot;
    await sleep(500);
  }
  throw new Error(`Timed out waiting for tx slot for signature: ${signature}`);
}

async function airdropSol(
  connection: Connection,
  recipient: Keypair,
  sol: number
) {
  const lamports = Math.floor(sol * 1e9);
  const sig = await connection.requestAirdrop(recipient.publicKey, lamports);
  const latest = await connection.getLatestBlockhash("confirmed");
  await connection.confirmTransaction(
    {
      signature: sig,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    },
    "confirmed"
  );
  return sig;
}

maybeDescribe("Devnet E2E: fund then launch (minContextSlot)", () => {
  it("should airdrop SOL and successfully launch a token on devnet using minContextSlot", async () => {
    const rpcUrl = process.env.RPC_URL ?? "https://api.devnet.solana.com";
    const connection = new Connection(rpcUrl, "confirmed");

    // Prefer running E2E tests using a pre-funded wallet to avoid devnet airdrop rate limits.
    // - Git Bash: RUN_DEVNET_E2E=1 E2E_PRIVATE_KEY=... bun test tests/devnet-e2e.test.ts
    // - PowerShell: $env:RUN_DEVNET_E2E='1'; $env:E2E_PRIVATE_KEY='...'; bun test tests/devnet-e2e.test.ts
    const fundedPrivateKey =
      process.env.E2E_PRIVATE_KEY ?? process.env.PRIVATE_KEY ?? undefined;

    let privateKey: string;
    let minContextSlot: number | undefined;
    let payerForLaunch: Keypair;
    if (fundedPrivateKey) {
      privateKey = fundedPrivateKey;
      payerForLaunch = Keypair.fromSecretKey(bs58.decode(privateKey));
    } else {
      payerForLaunch = Keypair.generate();
      privateKey = bs58.encode(payerForLaunch.secretKey);
      try {
        Logger.info("Requesting devnet airdrop...");
        const airdropSig = await airdropSol(connection, payerForLaunch, 2);
        minContextSlot = await waitForConfirmedTxSlot(connection, airdropSig);
        Logger.info(
          `Airdrop confirmed at slot ${minContextSlot}. Waiting for balance to be visible...`
        );
        await waitForBalanceAtLeast(
          connection,
          payerForLaunch.publicKey,
          1,
          60_000
        );
      } catch (e: any) {
        const msg = `${e?.message ?? e}`;
        if (msg.includes("429") || msg.toLowerCase().includes("airdrop")) {
          throw new Error(
            "Devnet airdrop is rate-limited. Fund a devnet wallet manually (e.g. https://faucet.solana.com) and re-run with E2E_PRIVATE_KEY set (base58 secretKey)."
          );
        }
        throw e;
      }
    }

    const kit = new MemeKit({ rpcUrl, privateKey, network: "devnet" });
    Logger.info(`E2E RPC: ${rpcUrl}`);

    Logger.info(`E2E Wallet: ${payerForLaunch.publicKey.toBase58()}`);

    // Auto-fund wallet if balance is 0
    const initialBal = await safeGetBalance(
      connection,
      payerForLaunch.publicKey
    );
    if (!initialBal || initialBal < 0.01 * 1e9) {
      Logger.info(
        `Wallet has insufficient funds (${
          initialBal ?? 0
        } lamports). Requesting devnet airdrop...`
      );
      try {
        const airdropSig = await airdropSol(connection, payerForLaunch, 2);
        minContextSlot = await waitForConfirmedTxSlot(connection, airdropSig);
        Logger.info(
          `Airdrop confirmed at slot ${minContextSlot}. Waiting for balance...`
        );
        await waitForBalanceAtLeast(
          connection,
          payerForLaunch.publicKey,
          1,
          60_000
        );
      } catch (e: any) {
        const msg = `${e?.message ?? e}`;
        if (msg.includes("429") || msg.toLowerCase().includes("airdrop")) {
          throw new Error(
            `Devnet airdrop is rate-limited. Fund ${payerForLaunch.publicKey.toBase58()} manually (https://faucet.solana.com) and re-run.`
          );
        }
        throw e;
      }
    }

    const maxAttempts = Number.parseInt(
      process.env.E2E_MAX_ATTEMPTS ?? "1",
      10
    );
    let lastErr: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const attemptStart = Date.now();
      try {
        const slot = await safeGetSlot(connection);
        const bal = await safeGetBalance(connection, payerForLaunch.publicKey);
        Logger.info(
          `E2E attempt ${attempt + 1}/${maxAttempts} | slot=${
            slot ?? "?"
          } | balance=${bal ?? "?"} lamports | minContextSlot=${
            minContextSlot ?? "none"
          }`
        );

        const res = await withTimeout(
          kit.launch({
            name: `E2E-${Date.now()}`,
            symbol: "E2E",
            image: "https://example.com/e2e.png",
            decimals: 6,
            supply: 1_000_000,
            dex: "meteora",
            liquidity: {
              solAmount: 0.05,
              tokenAmount: 50_000,
              buyAmountSol: 0,
            },
            txOptions: {
              minContextSlot,
              skipPreflight: true,
              maxRetries: 10,
            },
          } as any),
          Number.parseInt(process.env.E2E_ATTEMPT_TIMEOUT_MS ?? "90000", 10)
        );

        Logger.info(
          `E2E attempt ${attempt + 1} succeeded in ${
            Date.now() - attemptStart
          }ms | signature=${(res as any).signature}`
        );

        expect(res.signature).toBeDefined();
        expect(typeof res.signature).toBe("string");
        expect(res.signature.length).toBeGreaterThan(0);
        expect(res.signature.startsWith("Failed:")).toBe(false);
        return;
      } catch (e: any) {
        lastErr = e;
        const msgRaw = `${e?.message ?? e}`;
        const msg = msgRaw.toLowerCase();
        Logger.error(
          `E2E attempt ${attempt + 1} failed in ${
            Date.now() - attemptStart
          }ms | ${e?.name ?? "Error"}: ${msgRaw}`
        );
        if (e?.signature) {
          Logger.error(`E2E error signature: ${e.signature}`);
        }
        if (e?.stack) {
          Logger.error(`E2E error stack: ${e.stack}`);
        }
        await dumpErrorLogs(connection, e);

        const retryable =
          msg.includes("minimum context slot") ||
          msg.includes("block height exceeded") ||
          msg.includes("blockheight") ||
          msg.includes("expired") ||
          msg.includes("timed out");

        if (!retryable) {
          throw e;
        }
        await sleep(750 * (attempt + 1));
      }
    }

    throw lastErr;
  }, 240_000);
});
