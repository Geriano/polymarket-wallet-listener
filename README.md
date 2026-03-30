# polymarket-wallet-listener

TypeScript SDK for real-time Polymarket wallet trade monitoring via WebSocket. Watch specific wallets and get notified when they trade, split, merge, or redeem positions.

Designed for copy-trading, whale-watching, and position-tracking workflows.

## Features

- Real-time trade, split, merge, and redeem event streaming
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

```ts
import { Watcher, Side } from 'polymarket-wallet-listener'

const watcher = new Watcher({
  wsUrl: 'ws://your-stream-server/ws',
  gammaUrl: 'https://gamma-api.polymarket.com',
})

// Fetch market outcomes
const outcomes = await watcher.outcomes('btc-updown-5m-17xx91')

// Watch a wallet
const sub = watcher.subscribe('0xWhaleAddress', {
  outcomes: [
    { ...outcomes[0], side: Side.Buy, size: 10 },  // "Up" buys >= $10
    { ...outcomes[1] },                              // "Down" all trades
  ],
  events: ['trade', 'split', 'merge', 'redeem'],
})

sub.watch(async (event) => {
  if (event.type === 'trade') {
    console.log(`${event.side} ${event.outcome.name} $${event.size} @ ${event.price}`)
  }
})

// Clean up
sub.unwatch()
watcher.close()
```

## Architecture

```
                                ┌──────────────────┐
                                │  Gamma API       │
                                │  (market data)   │
                                └────────┬─────────┘
                                         │ outcomes()
                                         ▼
┌─────────┐   subscribe()   ┌───────────────────────────┐
│  Your   │ ──────────────▶ │        Watcher            │
│  Code   │                 │                           │
│         │ ◀────────────── │  ┌─────────┐ ┌─────────┐ │
│         │   watch(cb)     │  │ Router  │ │Protocol │ │
└─────────┘                 │  └────┬────┘ └────┬────┘ │
                            │       │           │      │
                            │       ▼           ▼      │
                            │  ┌────────────────────┐  │
                            │  │   WebSocket conn   │  │
                            │  └─────────┬──────────┘  │
                            └────────────┼─────────────┘
                                         │
                                         ▼
                            ┌──────────────────────────┐
                            │  Upstream Stream Server   │
                            │  (order_filled, splits,   │
                            │   merges, redemptions)    │
                            └──────────────────────────┘
```

**Flow:**
1. `Watcher` fetches outcome metadata from the Gamma API
2. On `subscribe()`, a lazy WebSocket connection is opened to the stream server
3. The SDK builds server-side filter messages (by maker/taker address for trades, stakeholder for splits/merges, redeemer for redemptions)
4. Incoming events are routed through `EventRouter`, which matches them to subscriptions and applies client-side outcome/side/size filters
5. Matched events are delivered to your `watch()` callback

## API Reference

### `new Watcher(options)`

Creates a new watcher instance. The WebSocket connection is **lazy** -- it is established on the first `subscribe()` call.

```ts
interface WatcherOptions {
  wsUrl: string           // Upstream WebSocket URL
  gammaUrl: string        // Polymarket Gamma API base URL
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

### `watcher.outcomes(slug, cache?)`

Fetch outcome metadata for a market by slug. Returns an array of `OutcomeInfo` objects containing CLOB token IDs, names, and current prices.

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
| `events` | `EventKind[]` | `['trade']` | Event types: `'trade'`, `'split'`, `'merge'`, `'redeem'` |
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

### `subscription.watch(callback)`

Start receiving events. Replaces any previous callback.

```ts
sub.watch(async (event) => {
  switch (event.type) {
    case 'trade':
      console.log(`${event.side} ${event.outcome.name} $${event.size}`)
      break
    case 'split':
      console.log(`Split $${event.amount}`)
      break
    case 'merge':
      console.log(`Merge $${event.amount}`)
      break
    case 'redeem':
      console.log(`Redeem $${event.payout}`)
      break
  }
})
```

The callback can be sync or async. Errors thrown in the callback are silently caught to prevent breaking the event stream.

### `subscription.unwatch()`

Stop receiving events and update the upstream WebSocket subscription. If this was the last active subscription, an unsubscribe message is sent to the server.

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

### TradeEvent

Emitted when a watched wallet buys or sells an outcome token (`order_filled`).

```ts
{
  type: 'trade'
  wallet: string         // Address that matched (maker or taker)
  outcome: OutcomeInfo   // { id, name, price }
  side: 'Buy' | 'Sell'  // From the wallet's perspective
  size: number           // USDC amount
  price: number          // Price per outcome token
  tx: string             // Transaction hash
  block: number          // Block number
  timestamp: number      // Date.now() when received
  raw: object            // Full upstream OrderFilledEvent
}
```

**Side resolution**: The `side` field reflects the wallet's perspective. If the wallet is the maker on a Buy order, `side` is `'Buy'`. If the wallet is the taker on a Buy order (counterparty), `side` is `'Sell'`.

### SplitEvent

Wallet locked USDC to mint YES+NO outcome tokens (entering a market).

```ts
{
  type: 'split'
  wallet: string         // Stakeholder address
  conditionId: string    // Market condition ID
  amount: number         // USDC locked (raw amount / 1e6)
  tx: string
  block: number
  timestamp: number
  raw: object            // Full upstream PositionSplitEvent
}
```

### MergeEvent

Wallet burned YES+NO outcome tokens to release USDC (exiting a market).

```ts
{
  type: 'merge'
  wallet: string
  conditionId: string
  amount: number         // USDC released (raw amount / 1e6)
  tx: string
  block: number
  timestamp: number
  raw: object            // Full upstream PositionsMergeEvent
}
```

### RedeemEvent

Wallet claimed payout after market resolution.

```ts
{
  type: 'redeem'
  wallet: string
  conditionId: string
  payout: number         // USDC claimed (raw amount / 1e6)
  tx: string
  block: number
  timestamp: number
  raw: object            // Full upstream PayoutRedemptionEvent
}
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

## Exports

```ts
// Classes
export { Watcher, Subscription }

// Enums
export { Side }              // Side.Buy | Side.Sell

// Utilities
export { deriveProxyAddress, normalizeAddress }

// Errors
export { WatcherError, ConnectionError, ReconnectError, ProtocolError, ServerError }

// Types
export type {
  OutcomeInfo,
  OutcomeFilter,
  SubscribeOptions,
  WatcherEvent,        // TradeEvent | SplitEvent | MergeEvent | RedeemEvent
  TradeEvent,
  SplitEvent,
  MergeEvent,
  RedeemEvent,
  WatcherOptions,
  EventKind,           // 'trade' | 'split' | 'merge' | 'redeem'
  ReconnectOptions,
  KeepaliveOptions,
  LifecycleEvent,
  LifecycleEventMap,
}
```

## Examples

### Run the example watcher

```bash
cd sdk

# Basic usage
npm run example:watch -- 0xWalletAddress market-slug

# With debug logging (shows WS messages, subscription payloads, raw events)
DEBUG=1 npm run example:watch -- 0xWalletAddress market-slug
```

### Copy-trade pattern

```ts
const watcher = new Watcher({ wsUrl, gammaUrl })
const outcomes = await watcher.outcomes('some-market')

watcher.subscribe('0xWhale', {
  outcomes: outcomes.map(o => ({ ...o })),
  events: ['trade'],
}).watch(async (event) => {
  if (event.type === 'trade') {
    await executeTrade(event.outcome.id, event.side, event.size)
  }
})
```

### Watch proxy wallet directly

```ts
// When you already have the proxy address (e.g. from data-api)
const watcher = new Watcher({ wsUrl, gammaUrl })
const outcomes = await watcher.outcomes('btc-updown-5m-1774601100')

const sub = watcher.subscribe('0x99c4fb1f78881601075bc25b13c9af76bc5918e7', {
  outcomes: outcomes.map(o => ({ ...o })),
  events: ['trade', 'split', 'merge', 'redeem'],
  skipProxy: true,
})

sub.watch((event) => {
  if (event.type === 'trade') {
    console.log(`${event.side} ${event.outcome.name} $${event.size.toFixed(2)} @ ${event.price.toFixed(4)}`)
  }
})
```

### Multi-wallet monitoring

```ts
const watcher = new Watcher({ wsUrl, gammaUrl })
const outcomes = await watcher.outcomes('btc-updown-5m-1774601100')

// Watch multiple wallets with a single subscription
const sub = watcher.subscribe(
  ['0xWhale1', '0xWhale2', '0xWhale3'],
  {
    outcomes: outcomes.map(o => ({ ...o })),
    events: ['trade'],
  }
)

sub.watch((event) => {
  if (event.type === 'trade') {
    console.log(`[${event.wallet}] ${event.side} ${event.outcome.name} $${event.size}`)
  }
})
```

### Whale alert (size filter)

```ts
const watcher = new Watcher({ wsUrl, gammaUrl })
const outcomes = await watcher.outcomes('will-trump-win-2024')

// Only alert on trades >= $1000
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
const watcher = new Watcher({ wsUrl, gammaUrl })
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

# Run example
DEBUG=1 npm run example:watch -- 0xAddress market-slug
```

## Wire Protocol

The SDK communicates with the upstream stream server over WebSocket using JSON messages.

**Subscribe request** (sent by SDK):
```json
{
  "action": "subscribe",
  "subscriptions": [
    {
      "event_type": "order_filled",
      "filters": [
        { "field": "maker", "op": "eq", "value": "0xAddress" }
      ]
    },
    {
      "event_type": "order_filled",
      "filters": [
        { "field": "taker", "op": "eq", "value": "0xAddress" },
        { "field": "usdc_amount", "op": "gte", "value": 10 }
      ]
    }
  ]
}
```

**Server responses:**
- `{"type": "subscribed", "event_types": ["order_filled", ...]}` -- subscription acknowledged
- `{"type": "event", "data": { ... }}` -- upstream event matching filters
- `{"type": "pong"}` -- keepalive response
- `{"type": "error", "message": "..."}` -- server error

**Supported filter operators:** `eq`, `ne`, `gt`, `gte`, `lt`, `lte`

## License

MIT
