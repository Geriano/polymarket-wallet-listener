// Classes
export { Watcher } from './watcher.js';
export { Subscription } from './subscription.js';

// Enums
export { Side } from './types.js';

// Constants
export { EVENT_KIND_TO_WIRE } from './types.js';

// Utilities
export { deriveProxyAddress, normalizeAddress } from './wallet.js';

// Errors
export {
  WatcherError,
  ConnectionError,
  ReconnectError,
  ProtocolError,
  ServerError,
} from './errors.js';

// Types
export type {
  OutcomeInfo,
  OutcomeFilter,
  SubscribeOptions,
  WatcherEvent,
  WatcherEventMap,
  TypedHandler,
  TradeEvent,
  MatchEvent,
  CancelEvent,
  FeeEvent,
  SplitEvent,
  MergeEvent,
  RedeemEvent,
  ConvertEvent,
  PrepareEvent,
  ResolveEvent,
  TransferEvent,
  TransferBatchEvent,
  TokenRegisteredEvent,
  TradingPausedEvent,
  TradingUnpausedEvent,
  GammaEnrichment,
  ClobEnrichment,
  GammaSeries,
  GammaTag,
  ExtendMessage,
  ExcludeMessage,
  ProtocolMessage,
  WatcherOptions,
  EventKind,
  ReconnectOptions,
  KeepaliveOptions,
  LifecycleEvent,
  LifecycleEventMap,
} from './types.js';
