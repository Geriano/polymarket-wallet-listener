// Classes
export { Watcher } from './watcher.js';
export { Subscription } from './subscription.js';

// Enums
export { Side } from './types.js';

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
  TradeEvent,
  SplitEvent,
  MergeEvent,
  RedeemEvent,
  WatcherOptions,
  EventKind,
  ReconnectOptions,
  KeepaliveOptions,
  LifecycleEvent,
  LifecycleEventMap,
} from './types.js';
