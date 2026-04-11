# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.3] - 2026-04-11

### Added
- **`stakeholder`** field on `SplitEvent` and `MergeEvent` — raw stakeholder address from the server event (for NRA events this is the exchange address, not the user).
- **`negRisk`** field on `SplitEvent` and `MergeEvent` — `true` when the position event came from the NegRisk Adapter.
- **`source`** field on `SplitEvent` and `MergeEvent` — contract address that emitted the event (CT or NRA).
- **`collateralAmount`** field on `SplitEvent`, `MergeEvent`, and `RedeemEvent` — human-readable collateral value from server enrichment.

### Changed
- **`wallet` field on `SplitEvent`/`MergeEvent`/`RedeemEvent`** now uses the server's enrichment `wallet` (actual user EOA resolved via `eth_getTransactionByHash`), falling back to `stakeholder`/`redeemer` if unavailable. Previously always used raw `stakeholder`.
- **Dual-address routing** for split, merge, and redeem events — matches subscriptions by both the enrichment `wallet` and the raw `stakeholder`/`redeemer` address. Ensures NRA events (where `stakeholder` = exchange) still route to the correct user subscription.
- Updated upstream wire types to include server v0.7.0+ fields (`collateral_amount`, `source`, `neg_risk`).

## [0.3.1] - 2026-04-11

### Changed
- **`traded()` replaces `bought()` + `sold()`** — one method per event type (15 total). Users check `event.side` in the callback instead of using separate methods.
- **`size` now reads from `collateral_amount`** (server v0.4.0 canonical field) instead of deprecated `usdc_amount`. Falls back to `usdc_amount` for older servers.

### Added
- **`collateralAmount`** field on `TradeEvent` — same value as `size`, canonical name going forward.
- **`negRisk`** field on `TradeEvent` — `true` when fill came from NegRisk CTF Exchange.
- **`buyer`** field on `TradeEvent` — address that bought outcome tokens (server-derived).
- **`seller`** field on `TradeEvent` — address that sold outcome tokens (server-derived).

### Removed
- `bought()` and `sold()` methods (replaced by `traded()`).

## [0.3.0] - 2026-04-11

### Added
- **Typed event callbacks** on `Subscription`: `bought()`, `sold()`, `splitted()`, `merged()`, `redeemed()`, `matched()`, `cancelled()`, `fee()`, `converted()`, `prepared()`, `resolved()`, `transferred()`, `transferredBatch()`, `tokenRegistered()`, `tradingPaused()`, `tradingUnpaused()`. Each returns a disposer function. Multiple handlers per event supported (additive). Coexists with `watch()` catch-all.
- **Auto-subscribe event types**: typed methods auto-add their event kind to the wire subscription without requiring `events: [...]` in `SubscribeOptions`.
- **`buyPrice` / `sellPrice` fields on `TradeEvent`**: explicit buyer/seller prices. `buyPrice` is always the buyer's cost per share; `sellPrice = 1 - buyPrice` for binary markets.
- **Extend/exclude wire protocol**: leverages stream server v0.5.0 `extend`/`exclude` actions. Adding wallets sends only the delta; full rebuild only on partial removals.
- **Microtask debouncing**: rapid handler registrations batched into a single wire message via `queueMicrotask`.
- `WatcherEventMap`, `TypedHandler`, `ExtendMessage`, `ExcludeMessage`, `ProtocolMessage` types exported

### Changed
- `InternalSubscription` carries `handlers` map + `autoEvents` set alongside `callback`
- Protocol refactored from pure function (`buildSubscribeMessage`) to stateful `ProtocolState` class tracking last-sent state for delta computation
- Router dispatches to both catch-all `callback` and per-event-kind typed `handlers`
- Subscription rebuild debounced via `queueMicrotask` instead of synchronous

## [0.2.0] - 2026-04-10

### Added
- **Server enrichment support.** All events now carry optional `gamma` and `clob` fields with market metadata and real-time CLOB pricing from the stream server v0.3.0 enrichment system. Typed as `GammaEnrichment` and `ClobEnrichment` interfaces.
- **11 new event types** covering all 15 server event types:
  - Trading: `MatchEvent` (orders_matched), `CancelEvent` (order_cancelled), `FeeEvent` (fee_charged)
  - Position: `ConvertEvent` (positions_converted)
  - Resolution: `PrepareEvent` (condition_preparation), `ResolveEvent` (condition_resolution)
  - Transfer: `TransferEvent` (transfer_single), `TransferBatchEvent` (transfer_batch)
  - Admin: `TokenRegisteredEvent`, `TradingPausedEvent`, `TradingUnpausedEvent`
- **`market` field on `TradeEvent`** populated from `gamma.question` enrichment
- **`EVENT_KIND_TO_WIRE` mapping constant** for SDK event kind to server wire type lookup
- **Broadcast event routing** for non-wallet events (cancel, prepare, resolve, admin) delivered to all matching subscriptions
- **Dual-address routing** for transfer events matching on both `from` and `to`
- **Auto-registration of outcome metadata** from gamma enrichment on all incoming events

### Changed
- **`gammaUrl` is now optional** in `WatcherOptions`. Server-side enrichment provides market metadata automatically — `GammaClient` is only needed for explicit slug-based lookups via `watcher.outcomes(slug)`.
- **`EventKind` expanded** from 4 to 15 values: added `match`, `cancel`, `fee`, `convert`, `prepare`, `resolve`, `transfer`, `transfer_batch`, `token_registered`, `trading_paused`, `trading_unpaused`
- **`WatcherEvent` union expanded** to include all 15 event types
- **Protocol module refactored** to data-driven subscribe builder using `ADDRESS_FIELDS` and `EVENT_KIND_TO_WIRE` lookup tables instead of hardcoded if-blocks
- **Router refactored** with `extractEnrichment()`, `routeAddressEvent()`, `routeDualAddressEvent()`, and `routeBroadcastEvent()` helpers
- **`GammaClient` marked `@deprecated`** — still functional for slug-based lookups

### Breaking
- Exhaustive `switch` statements on `WatcherEvent.type` without a `default` branch will now get TypeScript errors for unhandled new event types. Add a `default` case or handle the new types.

## [0.1.1] - 2026-03-31

### Fixed
- Callback errors in `watch()` are now logged via `console.warn` instead of silently swallowed
- Outcome filter fallback uses filter metadata when outcome registry is empty
- Subscription cleanup no longer removes subscriptions from the map (allows re-watching after `unwatch()`)
- Upstream data validation guards prevent crashes on malformed server messages
- Dead code removed from `computeMinSize` in protocol module
- `debug` lifecycle event is now properly typed in `LifecycleEventMap`

## [0.1.0] - 2026-03-31

### Added
- Real-time trade, split, merge, and redeem event streaming via WebSocket
- Per-outcome filtering with side and minimum size thresholds
- Automatic proxy wallet derivation (Gnosis Safe CREATE2)
- `skipProxy` option to bypass proxy derivation for known proxy addresses
- Multi-wallet subscriptions in a single WebSocket connection
- Auto-reconnect with exponential backoff and jitter
- Keepalive ping/pong health checks
- Exchange contract address exclusion for internal protocol fills
- `debug` lifecycle event for development diagnostics
- Typed error hierarchy: ConnectionError, ReconnectError, ProtocolError, ServerError
- Dual-format build: CJS + ESM with full TypeScript declarations
- Comprehensive README with architecture diagram and API reference

### Fixed
- Callback errors in `watch()` are now logged via `console.warn` instead of silently swallowed
- Outcome filter fallback uses filter metadata when outcome registry is empty
- Subscription cleanup no longer removes subscriptions from the map (allows re-watching after `unwatch()`)
- Upstream data validation guards prevent crashes on malformed server messages
- Dead code removed from `computeMinSize` in protocol module
