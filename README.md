# polymarket-wallet-listener

TypeScript SDK for real-time Polymarket wallet monitoring via WebSocket. Watch specific wallets and get notified of trades, splits, merges, redemptions, transfers, resolutions, and more — with full market metadata and real-time pricing from server-side enrichment.

Designed for copy-trading, whale-watching, and position-tracking workflows.

## Features

- **Typed event callbacks**: `sub.traded(cb)`, `sub.splitted(cb)`, `sub.merged(cb)`, etc. — one method per event type, fully typed
- **15 event types**: trade, match, cancel, fee, split, merge, redeem, convert, prepare, resolve, transfer, transfer_batch, token_registered, trading_paused, trading_unpaused
- **Server-side enrichment**: every event carries `gamma` (market metadata) and `clob` (real-time pricing) fields automatically
- **Buy/sell price normalization**: `buyPrice` and `sellPrice` on every trade event
- **Incremental subscriptions**: leverages server `extend`/`exclude` protocol for efficient wallet addition/removal
- Per-outcome filtering with side and minimum size thresholds
- Automatic proxy wallet derivation (Gnosis Safe CREATE2) with option to skip
- Multi-wallet subscriptions in a single WebSocket connection
- Auto-reconnect with exponential backoff and jitter
- Keepalive ping/pong health checks
- Works in Node.js and browsers (custom WebSocket constructor supported)
- Dual-format build: CJS + ESM with full TypeScript declarations

## Install

```bash
npm install polymarket-wallet-listener
```

## Quick Start

### Typed callbacks (recommended)

```ts
import { Watcher } from 'polymarket-wallet-listener'

const watcher = new Watcher({ wsUrl: 'ws://your-stream-server/ws' })
const sub = watcher.subscribe('0xWhaleAddress')

// No events: [...] needed — typed methods auto-subscribe
sub.traded(async (event) => {
  // event is TradeEvent — fully typed, check side yourself
  const label = event.side === 'Buy' ? 'BUY' : 'SELL'
  console.log(`${label} ${event.outcome.name} $${event.size} | buyer ${event.buyer}`)
  console.log(`  bid: ${event.clob?.best_bid} ask: ${event.clob?.best_ask}`)
})

sub.splitted(async (event) => {
  console.log(`SPLIT $${event.amount}`)
})

// Disposer pattern — call off() to stop listening
const off = sub.merged(async (event) => {
  console.log(`MERGE $${event.amount}`)
})
// off()  // call to remove this handler

// Clean up all handlers
sub.unwatch()
watcher.close()
```

### With watch() catch-all

```ts
const sub = watcher.subscribe('0xWhaleAddress', {
  events: ['trade', 'split', 'merge', 'redeem'],
})

sub.watch(async (event) => {
  switch (event.type) {
    case 'trade':
      console.log(`${event.side} ${event.outcome.name} $${event.size}`)
      break
    case 'split':
      console.log(`Split $${event.amount}`)
      break
  }
})
```

### With slug-based outcome filtering

```ts
import { Watcher, Side } from 'polymarket-wallet-listener'

const watcher = new Watcher({
  wsUrl: 'ws://your-stream-server/ws',
  gammaUrl: 'https://gamma-api.polymarket.com',
})

const outcomes = await watcher.outcomes('btc-updown-5m-17xx91')

const sub = watcher.subscribe('0xWhaleAddress', {
  outcomes: [
    { ...outcomes[0], side: Side.Buy, size: 10 },  // "Up" buys >= $10
    { ...outcomes[1] },                              // "Down" all trades
  ],
})

sub.traded(async (event) => {
  console.log(`${event.side} ${event.outcome.name} $${event.size} @ buy ${event.buyPrice}`)
})
```

## Architecture

```
                          ┌──────────────────┐
                          │  Gamma API       │  (optional — for slug-based
                          │  (market data)   │   outcome lookups only)
                          └────────┬─────────┘
                                   │ outcomes()
                                   ▼
┌─────────┐  subscribe()  ┌───────────────────────────────────┐
│  Your   │ ────────────▶ │            Watcher                │
│  Code   │               │                                   │
│         │ ◀──────────── │  ┌─────────┐ ┌─────────────────┐ │
│         │  traded(cb)   │  │ Router  │ │ ProtocolState   │ │
│         │  splitted(cb) │  │         │ │ (extend/exclude │ │
│         │  watch(cb)    │  │         │ │  diff engine)   │ │
└─────────┘               │  └────┬────┘ └───────┬─────────┘ │
                          │       │              │           │
                          │       ▼              ▼           │
                          │  ┌────────────────────────────┐  │
                          │  │     WebSocket connection    │  │
                          │  └────────────┬───────────────┘  │
                          └───────────────┼──────────────────┘
                                          │
                                          ▼
                          ┌──────────────────────────┐
                          │  Stream Server (v0.5.0+) │
                          │  subscribe/extend/exclude│
                          │  gamma + clob enrichment │
                          └──────────────────────────┘
```

**Flow:**
1. On `subscribe()`, a lazy WebSocket connection is opened to the stream server
2. `ProtocolState` computes the optimal wire message: `subscribe` (initial), `extend` (additions), or `exclude` (full event type removal). Rapid changes are debounced via `queueMicrotask`.
3. The server enriches each event with `gamma` (market metadata) and `clob` (real-time pricing) before sending
4. `EventRouter` matches incoming events to subscriptions and applies client-side outcome/side/size filters
5. Matched events are delivered to typed handlers (`traded`, `splitted`, etc.) and the `watch()` catch-all
6. Optionally, `watcher.outcomes(slug)` can fetch outcome metadata from the Gamma API for slug-based filtering

## API Reference

### `new Watcher(options)`

Creates a new watcher instance. The WebSocket connection is **lazy** -- it is established on the first `subscribe()` call.

```ts
interface WatcherOptions {
  wsUrl: string           // Upstream WebSocket URL
  gammaUrl?: string       // Polymarket Gamma API base URL (optional — only for slug lookups)
  reconnect?: {           // Reconnection options
    enabled?: boolean     // Default: true
    baseDelay?: number    // Default: 1000ms
    maxDelay?: number     // Default: 60000ms
    maxAttempts?: number  // Default: Infinity
    jitter?: number       // Default: 0.25 (25% random jitter)
  }
  keepalive?: {           // Keepalive ping/pong
    interval?: number     // Default: 30000ms (30s between pings)
    timeout?: number      // Default: 10000ms (10s pong deadline)
  }
  WebSocket?: unknown     // Custom WebSocket constructor (for browsers or testing)
}
```

> **Note**: `gammaUrl` is optional since v0.2.0. The stream server (v0.3.0+) enriches every event with market metadata and pricing automatically. You only need `gammaUrl` if you use `watcher.outcomes(slug)` for client-side outcome filtering.

### `watcher.outcomes(slug, cache?)`

Fetch outcome metadata for a market by slug. Returns an array of `OutcomeInfo` objects containing CLOB token IDs, names, and current prices. Requires `gammaUrl` in `WatcherOptions`.

```ts
const outcomes = await watcher.outcomes('btc-updown-5m-17xx91')
// [{ id: "241342...", name: "Up", price: "0.65" },
//  { id: "101344...", name: "Down", price: "0.35" }]

// Force fresh API call (bypass cache)
const fresh = await watcher.outcomes('btc-updown-5m-17xx91', false)
```

| Param | Type | Default | Description |
|---|---|---|---|
| `slug` | `string` | required | Market slug (e.g. `btc-updown-5m-1774599000`) |
| `cache` | `boolean` | `true` | Use cached result if available |

### `watcher.subscribe(wallet, options?)`

Create a subscription for one or more wallets. Triggers lazy WebSocket connection on first call.

```ts
// Single wallet, default (trade events only)
const sub = watcher.subscribe('0xAddress')

// Multiple wallets with full filtering
const sub = watcher.subscribe(['0xAddr1', '0xAddr2'], {
  outcomes: [
    { ...outcomes[0], side: Side.Buy, size: 10 },
  ],
  events: ['trade', 'split', 'merge', 'redeem'],
})

// Skip proxy derivation (when address is already a proxy wallet)
const sub = watcher.subscribe('0xProxyAddress', {
  events: ['trade'],
  skipProxy: true,
})
```

**SubscribeOptions:**

| Field | Type | Default | Description |
|---|---|---|---|
| `outcomes` | `OutcomeFilter[]` | `undefined` | Filter by specific outcomes. Omit to receive all. |
| `events` | `EventKind[]` | `['trade']` | Event types to subscribe to (see [Event Types](#event-types)) |
| `skipProxy` | `boolean` | `false` | Skip proxy address derivation. Use when the input address is already a proxy wallet. |

**OutcomeFilter** extends `OutcomeInfo` with optional client-side filters:

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | yes | CLOB token ID (from `outcomes()`) |
| `name` | `string` | yes | Outcome name (e.g. `"Up"`, `"Down"`) |
| `price` | `string` | yes | Current price |
| `side` | `Side` | no | Filter by `Side.Buy` or `Side.Sell` |
| `size` | `number` | no | Minimum USDC amount threshold |

**Filtering behavior:**
- **Server-side**: Address filters (maker/taker/stakeholder/redeemer) are always applied on the server. If all outcome filters have a `size` threshold, the minimum is sent as a server-side `usdc_amount >= N` filter.
- **Client-side**: Outcome token matching, side filtering, and per-outcome size filtering are applied by the SDK's `EventRouter`.

### Typed Event Callbacks

Each method registers a typed handler and auto-subscribes to the event type. Returns a disposer function. Multiple handlers per event are supported (additive). One method per event type (15 total).

| Method | Event Type |
|---|---|
| `sub.traded(cb)` | `TradeEvent` |
| `sub.splitted(cb)` | `SplitEvent` |
| `sub.merged(cb)` | `MergeEvent` |
| `sub.redeemed(cb)` | `RedeemEvent` |
| `sub.matched(cb)` | `MatchEvent` |
| `sub.cancelled(cb)` | `CancelEvent` |
| `sub.fee(cb)` | `FeeEvent` |
| `sub.converted(cb)` | `ConvertEvent` |
| `sub.prepared(cb)` | `PrepareEvent` |
| `sub.resolved(cb)` | `ResolveEvent` |
| `sub.transferred(cb)` | `TransferEvent` |
| `sub.transferredBatch(cb)` | `TransferBatchEvent` |
| `sub.tokenRegistered(cb)` | `TokenRegisteredEvent` |
| `sub.tradingPaused(cb)` | `TradingPausedEvent` |
| `sub.tradingUnpaused(cb)` | `TradingUnpausedEvent` |

```ts
// Auto-subscribes to 'trade' event type on the wire
const offTrade = sub.traded(async (event) => {
  // event is TradeEvent — TypeScript knows all fields
  if (event.side === 'Buy') {
    console.log(`BUY ${event.outcome.name} $${event.size} @ ${event.buyPrice}`)
  } else {
    console.log(`SELL ${event.outcome.name} $${event.size} @ ${event.sellPrice}`)
  }
})

// Multiple handlers for same event type — both fire
sub.traded(async (event) => {
  await sendAlert(event)
})

// Dispose a specific handler
offTrade()
```

**Auto-subscribe**: calling `sub.traded()` automatically adds `'trade'` to the wire subscription. You don't need to pass `events: ['trade']` in `SubscribeOptions`. When the disposer is called and no handlers remain for that event type, it is automatically removed from the subscription.

### `subscription.watch(callback)`

Catch-all callback. Receives all `WatcherEvent` types — use a switch statement to narrow. Coexists with typed callbacks: `watch()` fires first, then typed handlers.

```ts
sub.watch(async (event) => {
  switch (event.type) {
    case 'trade':
      console.log(`${event.side} ${event.outcome.name} $${event.size}`)
      break
    default:
      console.log(`${event.type} | tx ${event.tx}`)
      break
  }
})
```

The callback can be sync or async. Errors are caught and logged via `console.warn`.

### `subscription.unwatch()`

Stop receiving events. Removes the catch-all callback and all typed handlers. Updates the upstream WebSocket subscription.

### `subscription.id`

Unique subscription identifier (UUID v4).

### `subscription.wallets`

Normalized wallet addresses being watched.

### `subscription.proxyWallets`

Derived proxy wallet addresses (empty when `skipProxy: true`).

### `watcher.on(event, listener)` / `watcher.off(event, listener)`

Register or remove lifecycle event listeners.

### `watcher.close()`

Close the WebSocket connection and clean up all timers and state. Emits a `disconnected` event.

## Event Types

All events include optional enrichment fields from the stream server:

```ts
{
  gamma?: GammaEnrichment | null  // Market metadata (question, outcomes, volume, etc.)
  clob?: ClobEnrichment | null    // Real-time pricing (best_bid, best_ask, midpoint, etc.)
  raw: object                     // Full upstream event
}
```

### Trading Events

#### TradeEvent (`'trade'`)

Emitted when a watched wallet buys or sells an outcome token (`order_filled`).

```ts
{
  type: 'trade'
  wallet: string            // Address that matched (maker or taker)
  market: string            // Market question (from gamma enrichment)
  outcome: OutcomeInfo      // { id, name, price }
  side: 'Buy' | 'Sell'     // From the wallet's perspective
  size: number              // Collateral amount (USDC/pUSD)
  collateralAmount: number  // Same as size — canonical name going forward
  price: number             // Price per outcome token (from wallet's perspective)
  buyPrice: number          // Price from buyer's perspective
  sellPrice: number         // Price from seller's perspective (1 - buyPrice)
  negRisk: boolean          // true if fill from NegRisk CTF Exchange
  buyer: string             // Address that bought outcome tokens (server-derived)
  seller: string            // Address that sold outcome tokens (server-derived)
  tx: string
  block: number
  timestamp: number
  normalized: boolean       // true if complement outcome was normalized to canonical
}
```

**Price fields**:
- `price` — the price from the wallet's perspective (equals `buyPrice` when `side === 'Buy'`, `sellPrice` when `side === 'Sell'`)
- `buyPrice` — always the buyer's cost per outcome share, regardless of which side the wallet is on
- `sellPrice` — always `1 - buyPrice` for binary markets

**Side resolution**: The `side` field reflects the wallet's perspective. If the wallet is the maker on a Buy order, `side` is `'Buy'`. If the wallet is the taker on a Buy order (counterparty), `side` is `'Sell'`.

#### MatchEvent (`'match'`)

Summary of a `matchOrders` call.

```ts
{
  type: 'match'
  wallet: string            // taker_order_maker
  takerOrderHash: string
  makerAssetId: string
  takerAssetId: string
  makerAmountFilled: string
  takerAmountFilled: string
  tx: string
  block: number
  timestamp: number
}
```

#### CancelEvent (`'cancel'`)

Maker cancelled their order on-chain. Broadcast to all subscriptions (no wallet-address filter).

```ts
{
  type: 'cancel'
  orderHash: string
  tx: string
  block: number
  timestamp: number
}
```

#### FeeEvent (`'fee'`)

Fee collected from a trade.

```ts
{
  type: 'fee'
  receiver: string
  tokenId: string
  amount: string
  tx: string
  block: number
  timestamp: number
}
```

### Position Events

#### SplitEvent (`'split'`)

Wallet locked USDC to mint YES+NO outcome tokens (entering a market).

```ts
{
  type: 'split'
  wallet: string
  conditionId: string
  amount: number         // USDC locked (raw / 1e6)
  tx: string
  block: number
  timestamp: number
}
```

#### MergeEvent (`'merge'`)

Wallet burned YES+NO outcome tokens to release USDC (exiting a market).

```ts
{
  type: 'merge'
  wallet: string
  conditionId: string
  amount: number         // USDC released (raw / 1e6)
  tx: string
  block: number
  timestamp: number
}
```

#### RedeemEvent (`'redeem'`)

Wallet claimed payout after market resolution.

```ts
{
  type: 'redeem'
  wallet: string
  conditionId: string
  payout: number         // USDC claimed (raw / 1e6)
  tx: string
  block: number
  timestamp: number
}
```

#### ConvertEvent (`'convert'`)

NO tokens converted to YES tokens in multi-outcome (neg-risk) markets.

```ts
{
  type: 'convert'
  wallet: string
  marketId: string
  indexSet: string
  amount: number         // USDC value (raw / 1e6)
  tx: string
  block: number
  timestamp: number
}
```

### Resolution Events

#### PrepareEvent (`'prepare'`)

New condition created. Broadcast to all subscriptions.

```ts
{
  type: 'prepare'
  conditionId: string
  oracle: string
  questionId: string
  outcomeSlotCount: string
  tx: string
  block: number
  timestamp: number
}
```

#### ResolveEvent (`'resolve'`)

Condition resolved with payout numerators. Broadcast to all subscriptions.

```ts
{
  type: 'resolve'
  conditionId: string
  oracle: string
  questionId: string
  outcomeSlotCount: string
  payoutNumerators: string[]
  tx: string
  block: number
  timestamp: number
}
```

### Transfer Events

#### TransferEvent (`'transfer'`)

Single ERC-1155 token transfer. Matched if `from` or `to` is a watched wallet.

```ts
{
  type: 'transfer'
  operator: string
  from: string
  to: string
  tokenId: string
  value: string
  tx: string
  block: number
  timestamp: number
}
```

#### TransferBatchEvent (`'transfer_batch'`)

Batch ERC-1155 token transfer. Matched if `from` or `to` is a watched wallet.

```ts
{
  type: 'transfer_batch'
  operator: string
  from: string
  to: string
  ids: string[]
  values: string[]
  tx: string
  block: number
  timestamp: number
}
```

### Admin Events

These are broadcast to all subscriptions (no wallet-address filter).

#### TokenRegisteredEvent (`'token_registered'`)

```ts
{ type: 'token_registered', token0: string, token1: string, conditionId: string, tx, block, timestamp }
```

#### TradingPausedEvent (`'trading_paused'`)

```ts
{ type: 'trading_paused', pauser: string, tx, block, timestamp }
```

#### TradingUnpausedEvent (`'trading_unpaused'`)

```ts
{ type: 'trading_unpaused', unpauser: string, tx, block, timestamp }
```

## Lifecycle Events

```ts
watcher.on('connected', () => {
  console.log('WebSocket connected')
})

watcher.on('disconnected', (code: number, reason: string) => {
  console.log(`Disconnected: ${code} ${reason}`)
})

watcher.on('reconnecting', (attempt: number, delay: number) => {
  console.log(`Reconnecting #${attempt} in ${delay}ms`)
})

watcher.on('error', (err: Error) => {
  // err is one of: ConnectionError, ReconnectError, ProtocolError, ServerError
  console.error(err.name, err.message)
})

// Debug event — useful for development diagnostics
watcher.on('debug', (label: string, data: string) => {
  console.log(`[debug:${label}]`, data)
})
```

## Wallet Resolution

Polymarket uses Gnosis Safe proxy wallets. Users have two addresses:

- **EOA** -- the user's externally owned account, shown on Polymarket profiles
- **Proxy** -- the Gnosis Safe proxy that appears in on-chain events, derived via CREATE2

By default, the SDK derives the proxy address from any input and subscribes to **both** forms, so you don't need to know which type of address you have.

```ts
import { deriveProxyAddress, normalizeAddress } from 'polymarket-wallet-listener'

const proxy = deriveProxyAddress('0x25d76e8eaF02494c31Cda797E58364874e598333')
// '0xdbCb463dB35Ad1a011B45e40154fc939CCDD665E'

const norm = normalizeAddress('0x25D76E8EAF02494C31CDA797E58364874E598333')
// '0x25d76e8eaf02494c31cda797e58364874e598333'
```

**Important**: If the address you're watching is already a proxy wallet (e.g. from the `proxyWallet` field in the Polymarket data API), use `skipProxy: true` to avoid deriving a proxy-of-a-proxy:

```ts
// Address from data-api proxyWallet field -- already a proxy
const sub = watcher.subscribe('0xProxyWallet', {
  skipProxy: true,
  events: ['trade'],
})
```

**How to tell if an address is a proxy**: If you obtained the address from the Polymarket Data API's `proxyWallet` field or from on-chain `maker`/`taker` fields, it is a proxy. If you got it from a Polymarket profile URL or user lookup, it is likely an EOA.

## Error Handling

The SDK exports a typed error hierarchy:

```ts
import {
  WatcherError,      // Base class
  ConnectionError,   // WebSocket creation or pong timeout failures
  ReconnectError,    // Max reconnect attempts exceeded
  ProtocolError,     // Failed to parse server message
  ServerError,       // Server returned an error message
} from 'polymarket-wallet-listener'

watcher.on('error', (err) => {
  if (err instanceof ReconnectError) {
    console.error(`Gave up after ${err.attempt} attempts`)
  } else if (err instanceof ConnectionError) {
    console.error('Connection issue:', err.message)
  }
})
```

## Enrichment Types

Every event carries optional `gamma` and `clob` fields populated by the stream server's enrichment system:

### GammaEnrichment

Market metadata from the Gamma API (30+ fields). Key fields:

| Field | Type | Description |
|---|---|---|
| `question` | `string \| null` | Market question text |
| `slug` | `string \| null` | URL slug |
| `outcomes` | `string[]` | Outcome labels (e.g. `["Yes", "No"]`) |
| `outcome_prices` | `string[]` | Current prices |
| `clob_token_ids` | `string[]` | CLOB token IDs |
| `condition_id` | `string \| null` | On-chain condition ID |
| `volume_24hr` | `number \| null` | 24-hour volume |
| `liquidity` | `number \| null` | Current liquidity |
| `active` / `closed` | `boolean \| null` | Market status |
| `event_title` | `string \| null` | Parent event title |

See `GammaEnrichment` type for the full list.

### ClobEnrichment

Real-time order book pricing:

| Field | Type | Description |
|---|---|---|
| `token_id` | `string` | CLOB token ID |
| `best_bid` | `string \| null` | Best bid price |
| `best_ask` | `string \| null` | Best ask price |
| `midpoint` | `string \| null` | Midpoint price |
| `last_trade_price` | `string \| null` | Last trade price |
| `tick_size` | `string \| null` | Minimum price increment |
| `neg_risk` | `boolean \| null` | Negative risk flag |

## Exports

```ts
// Classes
export { Watcher, Subscription }

// Enums & Constants
export { Side }              // Side.Buy | Side.Sell
export { EVENT_KIND_TO_WIRE } // EventKind → server wire type mapping

// Utilities
export { deriveProxyAddress, normalizeAddress }

// Errors
export { WatcherError, ConnectionError, ReconnectError, ProtocolError, ServerError }

// Types
export type {
  // Enrichment
  GammaEnrichment, ClobEnrichment, GammaSeries, GammaTag,
  // Events
  WatcherEvent, WatcherEventMap, TypedHandler,
  TradeEvent, MatchEvent, CancelEvent, FeeEvent,
  SplitEvent, MergeEvent, RedeemEvent, ConvertEvent,
  PrepareEvent, ResolveEvent,
  TransferEvent, TransferBatchEvent,
  TokenRegisteredEvent, TradingPausedEvent, TradingUnpausedEvent,
  // Protocol
  ExtendMessage, ExcludeMessage, ProtocolMessage,
  // Configuration
  OutcomeInfo, OutcomeFilter, SubscribeOptions,
  WatcherOptions, EventKind, ReconnectOptions, KeepaliveOptions,
  LifecycleEvent, LifecycleEventMap,
}
```

## Examples

### Run the example watcher

```bash
cd sdk

# Watch all markets for a wallet (no slug needed)
npm run example:watch -- 0xWalletAddress

# With debug logging
DEBUG=1 npm run example:watch -- 0xWalletAddress

# Multiple wallets on a specific market (slug-based filtering)
npm run example:multiple -- 0xWallet1 0xWallet2 market-slug
```

### Copy-trade pattern

```ts
const watcher = new Watcher({ wsUrl })
const sub = watcher.subscribe('0xWhale')

sub.traded(async (event) => {
  const price = event.side === 'Buy' ? event.buyPrice : event.sellPrice
  console.log(`COPY ${event.side} ${event.outcome.name} $${event.size} @ ${price}`)
  await executeTrade(event.outcome.id, event.side, event.size)
})
```

### Watch proxy wallet directly

```ts
const watcher = new Watcher({ wsUrl })

const sub = watcher.subscribe('0xProxyWallet', {
  events: ['trade', 'split', 'merge', 'redeem'],
  skipProxy: true,
})

sub.watch((event) => {
  if (event.type === 'trade') {
    console.log(`${event.market} | ${event.side} ${event.outcome.name} $${event.size.toFixed(2)}`)
    console.log(`  bid: ${event.clob?.best_bid} ask: ${event.clob?.best_ask}`)
  }
})
```

### Multi-wallet monitoring

```ts
const watcher = new Watcher({ wsUrl })

const sub = watcher.subscribe(
  ['0xWhale1', '0xWhale2', '0xWhale3'],
  { events: ['trade'] },
)

sub.watch((event) => {
  if (event.type === 'trade') {
    console.log(`[${event.wallet}] ${event.market} | ${event.side} ${event.outcome.name} $${event.size}`)
  }
})
```

### Market resolution alerts

```ts
const watcher = new Watcher({ wsUrl })

watcher.subscribe('0xAddr', {
  events: ['trade', 'resolve'],
}).watch((event) => {
  if (event.type === 'resolve') {
    console.log(`RESOLVED: ${event.gamma?.question} → payouts [${event.payoutNumerators}]`)
  }
})
```

### Whale alert (size filter with slug)

```ts
const watcher = new Watcher({ wsUrl, gammaUrl })
const outcomes = await watcher.outcomes('will-trump-win-2024')

const sub = watcher.subscribe('0xWhale', {
  outcomes: outcomes.map(o => ({ ...o, size: 1000 })),
  events: ['trade'],
})

sub.watch((event) => {
  if (event.type === 'trade') {
    console.log(`WHALE ALERT: ${event.side} ${event.outcome.name} $${event.size.toFixed(2)}`)
  }
})
```

### Graceful shutdown

```ts
const watcher = new Watcher({ wsUrl })
const sub = watcher.subscribe('0xAddr', { events: ['trade'] })

sub.watch((event) => { /* ... */ })

process.on('SIGINT', () => {
  sub.unwatch()
  watcher.close()
  process.exit(0)
})
```

## Development

```bash
cd sdk

# Install dependencies
npm install

# Build (CJS + ESM + .d.ts)
npm run build

# Watch mode
npm run dev

# Type check
npm run lint

# Run examples
DEBUG=1 npm run example:watch -- 0xAddress
npm run example:multiple -- 0xAddr1 0xAddr2 market-slug
```

## Wire Protocol

The SDK communicates with the upstream stream server over WebSocket using JSON messages.

**Subscribe** (full state, sent on first connection or reconnect):
```json
{ "action": "subscribe", "subscriptions": [
  { "event_type": "order_filled", "filters": [{ "field": "maker", "op": "eq", "value": "0xAddr" }] },
  { "event_type": "condition_resolution" }
]}
```

**Extend** (incremental, sent when adding wallets or event types):
```json
{ "action": "extend", "subscriptions": [
  { "event_type": "order_filled", "filters": [{ "field": "taker", "op": "eq", "value": "0xNew" }] }
]}
```

**Exclude** (remove entire event types):
```json
{ "action": "exclude", "event_types": ["condition_resolution"] }
```

The SDK automatically chooses the optimal action: `extend` for pure additions, `exclude` when removing entire event types, and full `subscribe` rebuild for partial removals. Multiple rapid changes are debounced via `queueMicrotask`.

**Server responses:**
- `{"type": "subscribed", "event_types": [...], "subscriptions": [...]}` -- acknowledged (for subscribe, extend, and exclude)
- `{"type": "event", "data": { ..., "gamma": {...}, "clob": {...} }}` -- enriched event
- `{"type": "pong"}` -- keepalive response
- `{"type": "error", "message": "..."}` -- server error

**Supported filter operators:** `eq`, `ne`, `gt`, `gte`, `lt`, `lte`

**Event type mapping** (SDK → wire):

| SDK EventKind | Wire Type |
|---|---|
| `trade` | `order_filled` |
| `match` | `orders_matched` |
| `cancel` | `order_cancelled` |
| `fee` | `fee_charged` |
| `split` | `position_split` |
| `merge` | `positions_merge` |
| `redeem` | `payout_redemption` |
| `convert` | `positions_converted` |
| `prepare` | `condition_preparation` |
| `resolve` | `condition_resolution` |
| `transfer` | `transfer_single` |
| `transfer_batch` | `transfer_batch` |
| `token_registered` | `token_registered` |
| `trading_paused` | `trading_paused` |
| `trading_unpaused` | `trading_unpaused` |

## License

MIT
