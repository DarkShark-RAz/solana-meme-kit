# solana-meme-kit

**The Universal SDK for launching Solana Tokens.**

[![npm version](https://img.shields.io/npm/v/solana-meme-kit.svg)](https://www.npmjs.com/package/solana-meme-kit)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A unified, open-source TypeScript SDK that abstracts the complexity of Solana token launches. It provides a **Strategy Pattern** allowing you to choose different DEX backends for liquidity provision with a single code path.

## Table of Contents

- Installation
- Requirements
- Quickstart
- Strategy Comparison
- API Reference
- Meteora DLMM Guide
- Raydium Guide
- Jito Smart Tipping
- Cost Estimation + Fund Recovery
- Troubleshooting / FAQ
- Development

## ✨ Core Features

- **Protocol:Strategy Selection**: Choose your DEX backend using `protocol:strategy` format.
- **Token Minting**: One-line minting with metadata upload via Metaplex Umi.
- **OpenBook Markets**: Supports automated low-cost market creation.
- **Security**: Built-in helpers to revoke Mint and Freeze authorities.
- **Standardized Interface**: Switch DEXs without changing your business logic.
- **Jito Smart Tipping**: Use `jitoTip: "auto"` (or a manual tip) with optional block engine region routing.

## 📦 Installation

```bash
npm i solana-meme-kit
```

Or:

```bash
pnpm add solana-meme-kit
```

Or:

```bash
bun add solana-meme-kit
```

## ✅ Requirements

- **Node.js**: 18+ recommended
- **TypeScript**: peer dependency
- **RPC**: provide a reliable mainnet RPC for production usage

## 🔐 Security & Key Management

- Never hardcode private keys in source code.
- Prefer environment variables or a secret manager.
- Treat the `privateKey` as a **base58 secret key** (full keypair secret), not a public key.

Example:

```typescript
import { MemeKit } from "solana-meme-kit";

const kit = new MemeKit({
  rpcUrl: process.env.RPC_URL!,
  privateKey: process.env.PRIVATE_KEY!,
  cluster: "mainnet-beta",
});
```

## 🚀 Quickstart

The SDK is designed so you can launch with a single `launch()` call.

```typescript
import { MemeKit } from "solana-meme-kit";

const kit = new MemeKit({
  rpcUrl: "https://api.mainnet-beta.solana.com",
  privateKey: "YOUR_PRIVATE_KEY",
  cluster: "mainnet-beta",
});

const result = await kit.launch({
  name: "Super Gem",
  symbol: "SGEM",
  image: "https://arweave.net/metadata",
  supply: 1_000_000_000,
  liquidity: { solAmount: 5, tokenAmount: 800_000_000 },
  dex: "meteora",
  jitoTip: "auto",
});

console.log(result);
```

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
  cluster: "mainnet-beta",
});

const result = await kit.launch({
  name: "Super Gem",
  symbol: "SGEM",
  image: "https://arweave.net/metadata",
  supply: 1_000_000_000,
  liquidity: { solAmount: 5, tokenAmount: 800_000_000 },
  dex: "meteora", // Default (alias for meteora:dlmm)
});

console.log(`Token: ${result.mint}, Pool: ${result.poolId}`);
```

## 📚 API Reference

### `new MemeKit(config)`

```typescript
type MemeKitConfig = {
  rpcUrl: string;
  privateKey?: string;
  cluster?: "mainnet-beta" | "devnet";
};
```

- **`rpcUrl`**: Solana RPC endpoint
- **`privateKey`**: base58 secret key (recommended to load from env in production)
- **`cluster`**: defaults to `mainnet-beta`

### `kit.launch(options)`

`launch()` orchestrates:

- Token mint + metadata
- Authority revocations
- Pool creation + initial liquidity (via your selected DEX strategy)
- Optional Jito bundle submission

Key `LaunchOptions` fields:

- **Token fields**
  - `name`, `symbol`, `image`
  - `decimals` (default depends on token manager)
  - `supply` (defaults to `1_000_000_000`)
- **Liquidity fields**
  - `liquidity: { solAmount, tokenAmount }` (recommended)
  - Legacy support: `solLiquidityAmount`, `tokenLiquidityAmount`
- **Strategy selection**
  - `dex`: `"meteora" | "meteora:dlmm" | "raydium:cpmm" | "raydium:amm"`
  - `strategy`: legacy alias mapping is supported
- **Jito**
  - `jitoTip`: number (SOL) or `"auto"`
  - `blockEngine`: region routing
- **Meteora activation (optional)**
  - `meteoraOptions.activationType`: `"timestamp" | "slot"`
  - `meteoraOptions.activationPoint`: number
  - `meteoraOptions.activationDate`: `Date` (convenience; converted to unix seconds)
- **Meteora DLMM config (optional)**
  - `meteora.binStep`: number (basis points between bins)
  - `meteora.width`: number (how many bins to seed)
  - `meteora.strategyType`: `StrategyType.Spot | StrategyType.Curve | StrategyType.BidAsk`
  - `meteora.lfg`: `{ minPrice, maxPrice, curvature }` (LFG seeding mode)
- **Raydium AMM market (optional)**
  - `marketMode`: `"low-cost" | "standard"`

Return value (high level):

```typescript
type LaunchResult = {
  mint: string;
  poolId: string;
  marketId: string;
  strategy: string;
  signature: string;
};
```

### What happens during `launch()`

At a high level, `launch()` will:

- Create the SPL token + metadata
- Revoke mint and freeze authorities (so supply can’t be changed)
- Create the liquidity pool (based on `dex`)
- Seed initial liquidity
- Optionally submit everything as a single Jito bundle when `jitoTip` is set

The returned `poolId` is the pool address created/derived by the selected strategy.

## ✅ After launch (what to do next)

- **Save `mint`, `poolId`, and `signature`**.
- Use the official DEX UI (Meteora/Raydium) to manage/adjust your position after initialization.
- If you schedule a Meteora activation point, make sure you understand whether it’s a slot or timestamp.

## 🧠 Meteora DLMM Guide

### What the SDK does for DLMM

When you select `dex: "meteora"` (alias for `meteora:dlmm`), `DLMMManager.initialize()` generates instructions for:

- Creating the permissionless DLMM pool
- Initializing only the bin arrays needed for your chosen range
- Creating a position
- Seeding initial liquidity using a strategy

If you use Jito bundling, the SDK signs the bundle with any additional required signers automatically.

Notes:

- The SDK keeps DLMM initialization cost-efficient by only creating bin arrays covering your configured range.
- The SDK creates a position account internally; this requires an additional signer, handled for you.

### Meteora Configuration (Advanced)

You can customize DLMM pool configuration via `meteora`.

Fee controls (sniper tax):

- **`meteora.feeBps`**: override the pool fee (in basis points). Example: `500` = 5%.
- **`meteora.baseFactor`**: convenience input (defaults to `10000`). If you don’t set `feeBps`, the SDK derives a fee from `(baseFactor, binStep)`.

```typescript
import { MemeKit } from "solana-meme-kit";
import { StrategyType } from "@meteora-ag/dlmm";

const kit = new MemeKit({
  rpcUrl: "https://api.mainnet-beta.solana.com",
  privateKey: "YOUR_PRIVATE_KEY",
  cluster: "mainnet-beta",
});

const result = await kit.launch({
  name: "Super Gem",
  symbol: "SGEM",
  image: "https://arweave.net/metadata",
  liquidity: { solAmount: 5, tokenAmount: 800_000_000 },
  dex: "meteora",
  meteora: {
    binStep: 100,
    width: 60,
    strategyType: StrategyType.Spot,
    feeBps: 500,
  },
});

console.log(result.poolId);
```

### Meteora Presets

If you want a safe default configuration without tuning numbers, use `MeteoraPresets`.

Presets are simple configuration objects that you pass into `launch()` as `meteora: ...`.

Available presets:

- **`MeteoraPresets.MEMECOIN_VOLATILE`**
  - `binStep: 100` (1%)
  - `width: 80`
  - `strategyType: StrategyType.Spot`
- **`MeteoraPresets.ANTI_SNIPE_FEE`**
  - `binStep: 100` (1%)
  - `width: 80`
  - `strategyType: StrategyType.Spot`
  - `feeBps: 500` (5%)
- **`MeteoraPresets.COMMUNITY_TOKEN`**
  - `binStep: 25` (0.25%)
  - `width: 60`
  - `strategyType: StrategyType.Spot`
- **`MeteoraPresets.STABLE_PEGGED`**
  - `binStep: 5` (0.05%)
  - `width: 10`
  - `strategyType: StrategyType.BidAsk`

How to choose:

- **Memecoins / high volatility launches**: start with `MEMECOIN_VOLATILE`.
- **Anti-snipe fee mode**: start with `ANTI_SNIPE_FEE`.
- **Slower / organic launches**: start with `COMMUNITY_TOKEN`.
- **Pegged assets**: start with `STABLE_PEGGED`.

You can always start from a preset and override fields by passing a custom object instead.

### Launch Styles (Recommended)

`LaunchStyles` is the abstraction layer for common launch types. It bundles multiple low-level parameters into a single, human-readable choice.

```typescript
import { MemeKit, LaunchStyles } from "solana-meme-kit";

const kit = new MemeKit({
  rpcUrl: "https://api.mainnet-beta.solana.com",
  privateKey: "YOUR_PRIVATE_KEY",
  cluster: "mainnet-beta",
});

// Instant “viral memecoin” style
await kit.launch({
  name: "Super Gem",
  symbol: "SGEM",
  image: "https://arweave.net/metadata",
  liquidity: { solAmount: 5, tokenAmount: 800_000_000 },
  dex: "meteora",
  meteora: LaunchStyles.VIRAL,
});

// Fair launch style (pool is created but trading is paused until the activation time)
await kit.launch({
  name: "Super Gem",
  symbol: "SGEM",
  image: "https://arweave.net/metadata",
  liquidity: { solAmount: 5, tokenAmount: 800_000_000 },
  dex: "meteora",
  meteora: LaunchStyles.FAIR_LAUNCH(new Date(Date.now() + 60_000)),
});
```

```typescript
import { MemeKit, MeteoraPresets } from "solana-meme-kit";

const kit = new MemeKit({
  rpcUrl: "https://api.mainnet-beta.solana.com",
  privateKey: "YOUR_PRIVATE_KEY",
  cluster: "mainnet-beta",
});

const result = await kit.launch({
  name: "Super Gem",
  symbol: "SGEM",
  image: "https://arweave.net/metadata",
  liquidity: { solAmount: 5, tokenAmount: 800_000_000 },
  dex: "meteora",
  meteora: MeteoraPresets.MEMECOIN_VOLATILE,
});

console.log(result.poolId);
```

### Meteora Activation Scheduling (Optional)

You can schedule the pool activation with `meteoraOptions`:

```typescript
import { MemeKit } from "solana-meme-kit";

const kit = new MemeKit({
  rpcUrl: "https://api.mainnet-beta.solana.com",
  privateKey: "YOUR_PRIVATE_KEY",
  cluster: "mainnet-beta",
});

const result = await kit.launch({
  name: "Super Gem",
  symbol: "SGEM",
  image: "https://arweave.net/metadata",
  liquidity: { solAmount: 5, tokenAmount: 800_000_000 },
  dex: "meteora",
  meteoraOptions: {
    activationType: "timestamp",
    activationPoint: Math.floor(Date.now() / 1000) + 60,
  },
});

console.log(result.signature);
```

You can also use `activationDate` as a convenience:

```typescript
import { MemeKit } from "solana-meme-kit";

const kit = new MemeKit({
  rpcUrl: "https://api.mainnet-beta.solana.com",
  privateKey: "YOUR_PRIVATE_KEY",
  cluster: "mainnet-beta",
});

const result = await kit.launch({
  name: "Super Gem",
  symbol: "SGEM",
  image: "https://arweave.net/metadata",
  liquidity: { solAmount: 5, tokenAmount: 800_000_000 },
  dex: "meteora",
  meteoraOptions: {
    activationDate: new Date(Date.now() + 60_000),
  },
});

console.log(result.signature);
```

### LFG Seeding (Liquidity For Growth)

LFG mode allows you to seed liquidity across a specific price range (`minPrice` -> `maxPrice`) using a curved distribution.

```typescript
import { MemeKit } from "solana-meme-kit";

const kit = new MemeKit({
  rpcUrl: "https://api.mainnet-beta.solana.com",
  privateKey: "YOUR_PRIVATE_KEY",
  cluster: "mainnet-beta",
});

const result = await kit.launch({
  name: "Super Gem",
  symbol: "SGEM",
  image: "https://arweave.net/metadata",
  liquidity: { solAmount: 5, tokenAmount: 800_000_000 },
  dex: "meteora",
  meteora: {
    binStep: 100,
    lfg: {
      minPrice: 0.0000000009,
      maxPrice: 0.0000000011,
      curvature: 0.6,
    },
  },
});

console.log(result.poolId);
```

## 💧 Raydium Guide

### Raydium CPMM (`raydium:cpmm`)

```typescript
import { MemeKit } from "solana-meme-kit";

const kit = new MemeKit({
  rpcUrl: "https://api.mainnet-beta.solana.com",
  privateKey: "YOUR_PRIVATE_KEY",
  cluster: "mainnet-beta",
});

const result = await kit.launch({
  name: "Super Gem",
  symbol: "SGEM",
  image: "https://arweave.net/metadata",
  liquidity: { solAmount: 5, tokenAmount: 800_000_000 },
  dex: "raydium:cpmm",
});

console.log(result.poolId);
```

### Raydium AMM (`raydium:amm`)

Raydium AMM requires an OpenBook market. The SDK can generate a low-cost market with `marketMode`.

```typescript
import { MemeKit } from "solana-meme-kit";

const kit = new MemeKit({
  rpcUrl: "https://api.mainnet-beta.solana.com",
  privateKey: "YOUR_PRIVATE_KEY",
  cluster: "mainnet-beta",
});

const result = await kit.launch({
  name: "Super Gem",
  symbol: "SGEM",
  image: "https://arweave.net/metadata",
  liquidity: { solAmount: 5, tokenAmount: 800_000_000 },
  dex: "raydium:amm",
  marketMode: "low-cost",
});

console.log(result.marketId);
```

### Smart Tipping (Jito)

`jitoTip` can be a number (SOL) or `"auto"`.

```typescript
import { MemeKit } from "solana-meme-kit";

const kit = new MemeKit({
  rpcUrl: "https://api.mainnet-beta.solana.com",
  privateKey: "YOUR_PRIVATE_KEY",
  cluster: "mainnet-beta",
});

const result = await kit.launch({
  name: "Super Gem",
  symbol: "SGEM",
  image: "https://arweave.net/metadata",
  liquidity: { solAmount: 5, tokenAmount: 800_000_000 },
  dex: "meteora",
  jitoTip: "auto",
  blockEngine: "ny",
});

console.log(result.signature);
```

Available `blockEngine` regions:

- **default**
- **ny**
- **amsterdam**
- **frankfurt**
- **tokyo**
- **slc**

Notes:

- `jitoTip: "auto"` queries a tip floor endpoint and uses a conservative percentile.
- Jito bundling is mainly relevant on **mainnet**.

## 🧾 Result fields (practical)

- **`mint`**: the SPL token mint address
- **`poolId`**: the created pool address (DLMM LB pair for Meteora; pool id for Raydium)
- **`marketId`**:
  - Raydium AMM: created OpenBook market id (if applicable)
  - Other strategies: “Not Required”
- **`signature`**:
  - With Jito: bundle id or engine response
  - Without Jito: standard Solana tx signature

### Smart Tip Quote (for UI)

```typescript
import { MemeKit } from "solana-meme-kit";

const tipSol = await MemeKit.getSmartTip();
console.log(tipSol);
```

### Cost Estimation + Fund Recovery

```typescript
import { MemeKit } from "solana-meme-kit";

const estimatedSol = MemeKit.estimateLaunchCost({
  name: "Super Gem",
  symbol: "SGEM",
  image: "https://arweave.net/metadata",
  liquidity: { solAmount: 5, tokenAmount: 800_000_000 },
  dex: "meteora",
  jitoTip: "auto",
});

console.log(estimatedSol);
```

```typescript
import { MemeKit } from "solana-meme-kit";

const kit = new MemeKit({
  rpcUrl: "https://api.mainnet-beta.solana.com",
  privateKey: "YOUR_PRIVATE_KEY",
  cluster: "mainnet-beta",
});

const txid = await kit.recoverFunds("DESTINATION_WALLET_ADDRESS");
console.log(txid);
```

## 🔧 Troubleshooting / FAQ

### “My launch fails when using Jito”

- Ensure you are on **mainnet-beta** and using a block engine region.
- Ensure your wallet has enough SOL for:
  - token creation
  - pool rent + liquidity
  - tip

### “Why did I get a signer error?”

Some strategies (notably Meteora DLMM) require creating additional accounts (like a position account), which requires additional signatures.

- If you call `MemeKit.launch()`, this is handled automatically.
- If you directly use `DLMMManager.initialize()`, you must also sign with `result.signers`.

### “My RPC is rate-limiting / failing”

- Use a dedicated RPC provider for mainnet.
- Some strategies need multiple account reads during instruction building.

### “How do I pick a binStep?”

- Higher `binStep` (e.g. 100 = 1%) supports more volatility but results in larger price jumps.
- Lower `binStep` (e.g. 5 = 0.05%) is only appropriate for stable/pegged assets.

### “What does width mean?”

- `width` is the number of bins you seed liquidity across.
- Larger width covers more price movement; smaller width concentrates liquidity tighter.

## 🛠️ Architecture

```text
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
