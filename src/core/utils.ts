import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import fs from 'fs';
import dotenv from 'dotenv';
import bs58 from 'bs58';

dotenv.config();

export const LOG_LEVELS = {
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
  DEBUG: 'DEBUG',
};

export class Logger {
  static info(msg: string, ...args: any[]) {
    console.log(`[${new Date().toISOString()}] [INFO] ${msg}`, ...args);
  }
  static warn(msg: string, ...args: any[]) {
    console.warn(`[${new Date().toISOString()}] [WARN] ${msg}`, ...args);
  }
  static error(msg: string, ...args: any[]) {
    console.error(`[${new Date().toISOString()}] [ERROR] ${msg}`, ...args);
  }
}

export function loadKeypairEnv(envVar: string = 'PRIVATE_KEY'): Keypair | null {
  const pk = process.env[envVar];
  if (!pk) return null;
  try {
    return Keypair.fromSecretKey(bs58.decode(pk));
  } catch (e) {
    Logger.error('Failed to parse private key from env', e);
    return null;
  }
}

export const EXPLORER_URL = 'https://explorer.solana.com';

export function getExplorerLink(type: 'tx' | 'address' | 'block', id: string, cluster: 'devnet' | 'mainnet-beta' = 'mainnet-beta') {
  return `${EXPLORER_URL}/${type}/${id}?cluster=${cluster}`;
}
