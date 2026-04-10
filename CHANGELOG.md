# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
