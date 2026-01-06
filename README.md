# solana-meme-kit

**The Universal SDK for launching Solana Tokens.**

[![npm version](https://img.shields.io/npm/v/solana-meme-kit.svg)](https://www.npmjs.com/package/solana-meme-kit)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A unified, open-source TypeScript SDK that abstracts the complexity of Solana token launches. It provides a **Strategy Pattern** allowing you to choose different DEX backends for liquidity provision with a single code path.

## ✨ Core Features

- **Protocol:Strategy Selection**: Choose your DEX backend using `protocol:strategy` format.
- **Token Minting**: One-line minting with metadata upload via Metaplex Umi.
- **OpenBook Markets**: Supports automated low-cost market creation.
- **Security**: Built-in helpers to revoke Mint and Freeze authorities.
- **Standardized Interface**: Switch DEXs without changing your business logic.

## 📊 Strategy Comparison

| Strategy           | Cost (est)     | Anti-Snipe | Features                             |
| :----------------- | :------------- | :--------- | :----------------------------------- |
| **`meteora:dlmm`** | ~0.02 SOL      | ✅ High    | Dynamic fees, concentrated liquidity |
| **`raydium:cpmm`** | ~0.15 SOL      | ⚠️ Medium  | Modern CPMM, no OpenBook needed      |
| **`raydium:amm`**  | ~0.2 - 2.8 SOL | ⚠️ Low     | Legacy AMM, maximum compatibility    |

## 💻 Usage

### Basic Launch (Meteora DLMM - Default)

```typescript
import { MemeKit } from "solana-meme-kit";

const kit = new MemeKit({
  rpcUrl: "https://api.mainnet-beta.solana.com",
  privateKey: "YOUR_PRIVATE_KEY",
  cluster: "mainnet",
});

const result = await kit.launch({
  name: "Super Gem",
  symbol: "SGEM",
  image: "https://arweave.net/metadata",
  supply: 1_000_000_000,
  solLiquidityAmount: 5,
  tokenLiquidityAmount: 800_000_000,
  dex: "meteora:dlmm", // Choose strategy here
});

console.log(`Token: ${result.mint}, Pool: ${result.poolId}`);
```

## 🛠️ Architecture

```
src/
├── core/               # Main SDK and utilities
├── managers/           # Modular components (Token, Market, etc)
└── strategies/         # DEX-specific implementations
    ├── meteora/        # Meteora DLMM logic
    └── raydium/        # Raydium CPMM & AMM logic
```

## 🧪 Development

```bash
bun install
bun run build
bun test
```

## 🚀 Roadmap

- [x] Meteora DLMM Integration
- [x] Raydium CPMM Integration
- [x] Raydium AMM (Legacy) Integration
- [x] Jito Bundle Support (Mainnet)

## 📄 License

MIT
