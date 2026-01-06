# solana-meme-kit

**The All-in-One SDK for launching Solana Tokens.**

[![npm version](https://img.shields.io/npm/v/solana-meme-kit.svg)](https://www.npmjs.com/package/solana-meme-kit)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A unified, open-source TypeScript SDK that abstracts the complexity of Solana token launches. It provides a single interface to handle Token Minting, "Low-Cost" OpenBook Market creation, and Raydium Liquidity provisioning with Jito Bundles (Anti-Snipe).


## ✨ Core Features

- **Token Minting**: One-line minting with metadata upload via Metaplex Umi.
- **OpenBook Markets**:
  - Automatically calculates rent-exempt minimums.
  - Supports **"Low-Cost"** configuration (Event Queue: 128, Request Queue: 63, Orderbook: 201) to save ~2.6 SOL per launch.
  - Uses the official OpenBook V1 Program ID.
- **Liquidity Management**:
  - Integrated with **Raydium SDK V2**.
  - **Jito Bundle Support**: Atomically executes `InitPool` + `AddLiquidity` + `Swap` + `Tip` to prevent sniping (Mainnet only).
- **Security**: Built-in helpers to revoke Mint and Freeze authorities.

## 📦 Installation

```bash
bun add solana-meme-kit
# or
npm install solana-meme-kit
```

## 💻 Usage

### Basic Launch

```typescript
import { MemeKit } from 'solana-meme-kit';

// 1. Initialize
const kit = new MemeKit({
  rpcUrl: process.env.RPC_URL!,
  privateKey: process.env.PRIVATE_KEY!,
  cluster: 'mainnet' // 'mainnet' | 'devnet'
});

// 2. Launch
const result = await kit.launch({
  // Token
  name: 'Cool Token',
  symbol: 'COOL',
  image: 'https://arweave.net/metadata-uri',
  supply: 1_000_000_000,
  
  // Liquidity
  solLiquidityAmount: 5,
  tokenLiquidityAmount: 800_000_000,
  
  // Advanced Config
  marketMode: 'low-cost', // Optimizes rent costs
  jitoTipAmount: 0.01,
});

console.log('Launch Bundle:', result.bundleId);
```

## 🛠️ Architecture

The SDK is composed of three main managers which can also be used independently:

- **`TokenManager`**: Wraps `@metaplex-foundation/umi` for minting and authority management.
- **`MarketManager`**: Wraps `@openbook-dex/openbook` for market ID generation.
- **`LiquidityManager`**: Wraps `@raydium-io/raydium-sdk-v2` and `jito-ts` for pool actions.

## 🧪 Development

```bash
# Install dependencies
bun install

# Run Tests
bun test

# Build
bun run build
```

## 📄 License

MIT
