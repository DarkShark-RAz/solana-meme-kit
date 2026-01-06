import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import fs from 'fs';
import path from 'path';

const envPath = path.resolve(__dirname, '../.env');
const keypair = Keypair.generate();
const secretKey = bs58.encode(keypair.secretKey);
const rpcUrl = 'https://api.devnet.solana.com';

const content = `RPC_URL=${rpcUrl}\nPRIVATE_KEY=${secretKey}\n`;

fs.writeFileSync(envPath, content);
console.log('Initialized .env with new wallet:', keypair.publicKey.toString());
