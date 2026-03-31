# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
