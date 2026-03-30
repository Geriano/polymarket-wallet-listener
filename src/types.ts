// ─── Primitives ──────────────────────────────────────────────────────────────

export type Address = `0x${string}`;
export type B256 = `0x${string}`;
export type U256 = string;
export type OrderSide = 'Buy' | 'Sell';

// ─── SDK Public Types ────────────────────────────────────────────────────────

export enum Side {
  Buy = 'Buy',
  Sell = 'Sell',
}

export type EventKind = 'trade' | 'split' | 'merge' | 'redeem';

export interface OutcomeInfo {
  id: string;
  name: string;
  price: string;
}

export interface OutcomeFilter extends OutcomeInfo {
  side?: Side;
  size?: number;
}

export interface SubscribeOptions {
  outcomes?: OutcomeFilter[];
  events?: EventKind[];
  skipProxy?: boolean;
}

// ─── Watcher Events (discriminated union) ────────────────────────────────────

export interface TradeEvent {
  type: 'trade';
  wallet: string;
  outcome: OutcomeInfo;
  side: 'Buy' | 'Sell';
  size: number;
  price: number;
  tx: string;
  block: number;
  timestamp: number;
  raw: object;
}

export interface SplitEvent {
  type: 'split';
  wallet: string;
  conditionId: string;
  amount: number;
  tx: string;
  block: number;
  timestamp: number;
  raw: object;
}

export interface MergeEvent {
  type: 'merge';
  wallet: string;
  conditionId: string;
  amount: number;
  tx: string;
  block: number;
  timestamp: number;
  raw: object;
}

export interface RedeemEvent {
  type: 'redeem';
  wallet: string;
  conditionId: string;
  payout: number;
  tx: string;
  block: number;
  timestamp: number;
  raw: object;
}

export type WatcherEvent = TradeEvent | SplitEvent | MergeEvent | RedeemEvent;

// ─── Configuration ───────────────────────────────────────────────────────────

export interface ReconnectOptions {
  enabled: boolean;
  baseDelay: number;
  maxDelay: number;
  maxAttempts: number;
  jitter: number;
}

export interface KeepaliveOptions {
  interval: number;
  timeout: number;
}

export interface WatcherOptions {
  wsUrl: string;
  gammaUrl: string;
  reconnect?: Partial<ReconnectOptions>;
  keepalive?: Partial<KeepaliveOptions>;
  WebSocket?: unknown;
}

// ─── Lifecycle Events ────────────────────────────────────────────────────────

export interface LifecycleEventMap {
  connected: () => void;
  disconnected: (code: number, reason: string) => void;
  reconnecting: (attempt: number, delay: number) => void;
  error: (error: Error) => void;
}

export type LifecycleEvent = keyof LifecycleEventMap;

// ─── Raw Upstream Event Types ────────────────────────────────────────────────

export interface OrderFilledEvent {
  readonly type: 'order_filled';
  order_hash: B256;
  maker: Address;
  taker: Address;
  maker_asset_id: U256;
  taker_asset_id: U256;
  maker_amount_filled: U256;
  taker_amount_filled: U256;
  fee: U256;
  side: OrderSide;
  price: number;
  usdc_amount: number;
  block_number: number;
  tx_hash: B256;
  exchange: Address;
}

export interface PositionSplitEvent {
  readonly type: 'position_split';
  stakeholder: Address;
  condition_id: B256;
  amount: U256;
  block_number: number;
  tx_hash: B256;
}

export interface PositionsMergeEvent {
  readonly type: 'positions_merge';
  stakeholder: Address;
  condition_id: B256;
  amount: U256;
  block_number: number;
  tx_hash: B256;
}

export interface PayoutRedemptionEvent {
  readonly type: 'payout_redemption';
  redeemer: Address;
  condition_id: B256;
  payout: U256;
  block_number: number;
  tx_hash: B256;
}

export type UpstreamEvent =
  | OrderFilledEvent
  | PositionSplitEvent
  | PositionsMergeEvent
  | PayoutRedemptionEvent;

// ─── Wire Protocol ───────────────────────────────────────────────────────────

export type FilterOp = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte';

export interface FieldFilter {
  field: string;
  op: FilterOp;
  value: string | number;
}

export interface EventTypeSubscription {
  event_type: string;
  filters?: FieldFilter[];
}

export interface SubscribeMessage {
  action: 'subscribe';
  subscriptions: EventTypeSubscription[];
}

export interface ServerEventMessage {
  type: 'event';
  data: Record<string, unknown>;
}

export interface ServerSubscribedMessage {
  type: 'subscribed';
  event_types: string[];
}

export interface ServerPongMessage {
  type: 'pong';
}

export interface ServerErrorMessage {
  type: 'error';
  message: string;
}

export type ServerMessage =
  | ServerEventMessage
  | ServerSubscribedMessage
  | { type: 'unsubscribed' }
  | ServerPongMessage
  | ServerErrorMessage;

// ─── Internal Types ──────────────────────────────────────────────────────────

export interface InternalSubscription {
  id: string;
  wallets: string[];
  proxyWallets: string[];
  options: Required<Pick<SubscribeOptions, 'events'>> & Pick<SubscribeOptions, 'outcomes'>;
  callback: ((event: WatcherEvent) => void | Promise<void>) | null;
}

export const DEFAULT_RECONNECT: ReconnectOptions = {
  enabled: true,
  baseDelay: 1000,
  maxDelay: 60_000,
  maxAttempts: Infinity,
  jitter: 0.25,
};

export const DEFAULT_KEEPALIVE: KeepaliveOptions = {
  interval: 30_000,
  timeout: 10_000,
};
