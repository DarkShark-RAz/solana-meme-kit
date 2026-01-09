import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  createSignerFromKeypair,
  signerIdentity,
  generateSigner,
  percentAmount,
  keypairIdentity,
} from "@metaplex-foundation/umi";
import {
  createFungible,
  mintV1,
  TokenStandard,
  mplTokenMetadata,
} from "@metaplex-foundation/mpl-token-metadata";
import {
  fromWeb3JsKeypair,
  toWeb3JsKeypair,
} from "@metaplex-foundation/umi-web3js-adapters";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { setAuthority, AuthorityType } from "@solana/spl-token";
import { Logger } from "../core/utils";
import bs58 from "bs58";
import type { MemeKitSendOptions } from "../strategies/LiquidityStrategy";

export interface TokenConfig {
  name: string;
  symbol: string;
  uri: string; // We'll assume URI is pre-uploaded for now or handled outside
  decimals?: number;
  initialSupply: number; // Raw amount, will be adjusted for decimals
}

export class TokenManager {
  private umi;

  constructor(private connection: Connection, payer: Keypair) {
    this.umi = createUmi(connection.rpcEndpoint).use(mplTokenMetadata());

    const keypair = fromWeb3JsKeypair(payer);
    this.umi.use(keypairIdentity(keypair));
  }

  async createToken(config: TokenConfig, txOptions?: MemeKitSendOptions) {
    Logger.info(`Creating token ${config.name} (${config.symbol})...`);

    const mint = generateSigner(this.umi);
    const supply = BigInt(config.initialSupply * 10 ** (config.decimals || 6));

    // Create the Fungible Token
    // We use createFungible which inherently creates a mint with 0 decimals if not specified,
    // but here we specify it. It defaults to 0 supply.
    const builder = createFungible(this.umi, {
      mint,
      name: config.name,
      symbol: config.symbol,
      uri: config.uri,
      sellerFeeBasisPoints: percentAmount(0),
      decimals: config.decimals || 6,
    });

    const umiSendOptions = txOptions
      ? {
          send: {
            skipPreflight: txOptions.skipPreflight,
            minContextSlot: txOptions.minContextSlot,
            maxRetries: txOptions.maxRetries,
          },
        }
      : undefined;

    try {
      const { signature } = await builder.sendAndConfirm(
        this.umi,
        umiSendOptions
      );
      const sigBase58 = bs58.encode(signature);
      Logger.info(`Token Mint create signature: ${sigBase58}`);
    } catch (e: any) {
      Logger.error(`Token Mint create failed: ${e?.message ?? e}`);
      throw e;
    }

    Logger.info(`Token Mint created: ${mint.publicKey.toString()}`);

    // Mint initial supply to payer
    Logger.info(`Minting ${config.initialSupply} tokens to payer...`);
    try {
      const { signature } = await mintV1(this.umi, {
        mint: mint.publicKey,
        amount: supply,
        tokenStandard: TokenStandard.Fungible,
      }).sendAndConfirm(this.umi, umiSendOptions);
      const sigBase58 = bs58.encode(signature);
      Logger.info(`Token Mint supply signature: ${sigBase58}`);
    } catch (e: any) {
      Logger.error(`Token Mint supply failed: ${e?.message ?? e}`);
      throw e;
    }

    return {
      mint: toWeb3JsKeypair(mint),
    };
  }

  async revokeAuthorities(
    mint: PublicKey,
    payer: Keypair,
    txOptions?: MemeKitSendOptions
  ) {
    Logger.info(
      `Revoking Mint and Freeze authorities for ${mint.toString()}...`
    );

    const confirmOptions = txOptions
      ? {
          skipPreflight: txOptions.skipPreflight,
          minContextSlot: txOptions.minContextSlot,
          maxRetries: txOptions.maxRetries,
        }
      : undefined;

    // Revoke Mint Authority
    try {
      const sig = await setAuthority(
        this.connection,
        payer, // Payer
        mint, // Account
        payer, // Current authority
        AuthorityType.MintTokens,
        null, // Set new authority to null to revoke
        undefined,
        confirmOptions
      );
      Logger.info(
        `Mint authority revoked for ${mint.toString()} (sig: ${sig})`
      );
    } catch (e: any) {
      Logger.error(`Mint authority revoke failed: ${e?.message ?? e}`);
      throw e;
    }

    // Revoke Freeze Authority
    try {
      const sig = await setAuthority(
        this.connection,
        payer, // Payer
        mint, // Account
        payer, // Current authority
        AuthorityType.FreezeAccount,
        null, // Set new authority to null to revoke
        undefined,
        confirmOptions
      );
      Logger.info(
        `Freeze authority revoked for ${mint.toString()} (sig: ${sig})`
      );
    } catch (e: any) {
      Logger.error(`Freeze authority revoke failed: ${e?.message ?? e}`);
      throw e;
    }
  }
}
