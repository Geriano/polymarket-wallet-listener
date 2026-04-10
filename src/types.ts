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

export type EventKind =
  | 'trade'
  | 'split'
  | 'merge'
  | 'redeem'
  | 'match'
  | 'cancel'
  | 'fee'
  | 'convert'
  | 'prepare'
  | 'resolve'
  | 'transfer'
  | 'transfer_batch'
  | 'token_registered'
  | 'trading_paused'
  | 'trading_unpaused';

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

// ─── Enrichment Types ───────────────────────────────────────────────────────

export interface GammaSeries {
  id: string | null;
  title: string | null;
  slug: string | null;
}

export interface GammaTag {
  label: string | null;
  slug: string | null;
}

export interface GammaEnrichment {
  market_id: string | null;
  condition_id: string | null;
  question: string | null;
  description: string | null;
  resolution_source: string | null;
  slug: string | null;
  category: string | null;
  end_date: string | null;
  image: string | null;
  icon: string | null;
  outcomes: string[];
  outcome_prices: string[];
  clob_token_ids: string[];
  active: boolean | null;
  closed: boolean | null;
  enable_neg_risk: boolean | null;
  market_type: string | null;
  volume: number | null;
  volume_24hr: number | null;
  volume_1wk: number | null;
  volume_1mo: number | null;
  liquidity: number | null;
  open_interest: number | null;
  best_bid: number | null;
  best_ask: number | null;
  spread: number | null;
  last_trade_price: number | null;
  one_day_price_change: number | null;
  one_hour_price_change: number | null;
  one_week_price_change: number | null;
  rewards_min_size: number | null;
  rewards_max_spread: number | null;
  comment_count: number | null;
  event_id: string | null;
  event_title: string | null;
  event_slug: string | null;
  series: GammaSeries[];
  tags: GammaTag[];
}

export interface ClobEnrichment {
  token_id: string;
  best_bid: string | null;
  best_ask: string | null;
  midpoint: string | null;
  last_trade_price: string | null;
  tick_size: string | null;
  neg_risk: boolean | null;
  timestamp: string | null;
}

// ─── Watcher Events (discriminated union) ────────────────────────────────────

// ── Trading Events ──

export interface TradeEvent {
  type: 'trade';
  wallet: string;
  market: string;
  outcome: OutcomeInfo;
  side: 'Buy' | 'Sell';
  size: number;
  price: number;
  tx: string;
  block: number;
  timestamp: number;
  gamma?: GammaEnrichment | null;
  clob?: ClobEnrichment | null;
  raw: object;
}

export interface MatchEvent {
  type: 'match';
  wallet: string;
  takerOrderHash: string;
  makerAssetId: string;
  takerAssetId: string;
  makerAmountFilled: string;
  takerAmountFilled: string;
  tx: string;
  block: number;
  timestamp: number;
  gamma?: GammaEnrichment | null;
  clob?: ClobEnrichment | null;
  raw: object;
}

export interface CancelEvent {
  type: 'cancel';
  orderHash: string;
  tx: string;
  block: number;
  timestamp: number;
  gamma?: GammaEnrichment | null;
  clob?: ClobEnrichment | null;
  raw: object;
}

export interface FeeEvent {
  type: 'fee';
  receiver: string;
  tokenId: string;
  amount: string;
  tx: string;
  block: number;
  timestamp: number;
  gamma?: GammaEnrichment | null;
  clob?: ClobEnrichment | null;
  raw: object;
}

// ── Position Events ──

export interface SplitEvent {
  type: 'split';
  wallet: string;
  conditionId: string;
  amount: number;
  tx: string;
  block: number;
  timestamp: number;
  gamma?: GammaEnrichment | null;
  clob?: ClobEnrichment | null;
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
  gamma?: GammaEnrichment | null;
  clob?: ClobEnrichment | null;
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
  gamma?: GammaEnrichment | null;
  clob?: ClobEnrichment | null;
  raw: object;
}

export interface ConvertEvent {
  type: 'convert';
  wallet: string;
  marketId: string;
  indexSet: string;
  amount: number;
  tx: string;
  block: number;
  timestamp: number;
  gamma?: GammaEnrichment | null;
  clob?: ClobEnrichment | null;
  raw: object;
}

// ── Resolution Events ──

export interface PrepareEvent {
  type: 'prepare';
  conditionId: string;
  oracle: string;
  questionId: string;
  outcomeSlotCount: string;
  tx: string;
  block: number;
  timestamp: number;
  gamma?: GammaEnrichment | null;
  clob?: ClobEnrichment | null;
  raw: object;
}

export interface ResolveEvent {
  type: 'resolve';
  conditionId: string;
  oracle: string;
  questionId: string;
  outcomeSlotCount: string;
  payoutNumerators: string[];
  tx: string;
  block: number;
  timestamp: number;
  gamma?: GammaEnrichment | null;
  clob?: ClobEnrichment | null;
  raw: object;
}

// ── Transfer Events ──

export interface TransferEvent {
  type: 'transfer';
  operator: string;
  from: string;
  to: string;
  tokenId: string;
  value: string;
  tx: string;
  block: number;
  timestamp: number;
  gamma?: GammaEnrichment | null;
  clob?: ClobEnrichment | null;
  raw: object;
}

export interface TransferBatchEvent {
  type: 'transfer_batch';
  operator: string;
  from: string;
  to: string;
  ids: string[];
  values: string[];
  tx: string;
  block: number;
  timestamp: number;
  gamma?: GammaEnrichment | null;
  clob?: ClobEnrichment | null;
  raw: object;
}

// ── Admin Events ──

export interface TokenRegisteredEvent {
  type: 'token_registered';
  token0: string;
  token1: string;
  conditionId: string;
  tx: string;
  block: number;
  timestamp: number;
  gamma?: GammaEnrichment | null;
  clob?: ClobEnrichment | null;
  raw: object;
}

export interface TradingPausedEvent {
  type: 'trading_paused';
  pauser: string;
  tx: string;
  block: number;
  timestamp: number;
  gamma?: GammaEnrichment | null;
  clob?: ClobEnrichment | null;
  raw: object;
}

export interface TradingUnpausedEvent {
  type: 'trading_unpaused';
  unpauser: string;
  tx: string;
  block: number;
  timestamp: number;
  gamma?: GammaEnrichment | null;
  clob?: ClobEnrichment | null;
  raw: object;
}

export type WatcherEvent =
  | TradeEvent
  | MatchEvent
  | CancelEvent
  | FeeEvent
  | SplitEvent
  | MergeEvent
  | RedeemEvent
  | ConvertEvent
  | PrepareEvent
  | ResolveEvent
  | TransferEvent
  | TransferBatchEvent
  | TokenRegisteredEvent
  | TradingPausedEvent
  | TradingUnpausedEvent;

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
  gammaUrl?: string;
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
  debug: (label: string, data: string) => void;
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

export interface OrdersMatchedEvent {
  readonly type: 'orders_matched';
  taker_order_hash: B256;
  taker_order_maker: Address;
  maker_asset_id: U256;
  taker_asset_id: U256;
  maker_amount_filled: U256;
  taker_amount_filled: U256;
  block_number: number;
  tx_hash: B256;
}

export interface OrderCancelledEvent {
  readonly type: 'order_cancelled';
  order_hash: B256;
  block_number: number;
  tx_hash: B256;
}

export interface FeeChargedEvent {
  readonly type: 'fee_charged';
  receiver: Address;
  token_id: U256;
  amount: U256;
  block_number: number;
  tx_hash: B256;
}

export interface TokenRegisteredUpstreamEvent {
  readonly type: 'token_registered';
  token0: U256;
  token1: U256;
  condition_id: B256;
  block_number: number;
  tx_hash: B256;
}

export interface TradingPausedUpstreamEvent {
  readonly type: 'trading_paused';
  pauser: Address;
  block_number: number;
  tx_hash: B256;
}

export interface TradingUnpausedUpstreamEvent {
  readonly type: 'trading_unpaused';
  unpauser: Address;
  block_number: number;
  tx_hash: B256;
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

export interface PositionsConvertedEvent {
  readonly type: 'positions_converted';
  stakeholder: Address;
  market_id: B256;
  index_set: U256;
  amount: U256;
  block_number: number;
  tx_hash: B256;
}

export interface ConditionPreparationEvent {
  readonly type: 'condition_preparation';
  condition_id: B256;
  oracle: Address;
  question_id: B256;
  outcome_slot_count: U256;
  block_number: number;
  tx_hash: B256;
}

export interface ConditionResolutionEvent {
  readonly type: 'condition_resolution';
  condition_id: B256;
  oracle: Address;
  question_id: B256;
  outcome_slot_count: U256;
  payout_numerators: U256[];
  block_number: number;
  tx_hash: B256;
}

export interface TransferSingleUpstreamEvent {
  readonly type: 'transfer_single';
  operator: Address;
  from: Address;
  to: Address;
  id: U256;
  value: U256;
  block_number: number;
  tx_hash: B256;
}

export interface TransferBatchUpstreamEvent {
  readonly type: 'transfer_batch';
  operator: Address;
  from: Address;
  to: Address;
  ids: U256[];
  values: U256[];
  block_number: number;
  tx_hash: B256;
}

export type UpstreamEvent =
  | OrderFilledEvent
  | OrdersMatchedEvent
  | OrderCancelledEvent
  | FeeChargedEvent
  | TokenRegisteredUpstreamEvent
  | TradingPausedUpstreamEvent
  | TradingUnpausedUpstreamEvent
  | PositionSplitEvent
  | PositionsMergeEvent
  | PayoutRedemptionEvent
  | PositionsConvertedEvent
  | ConditionPreparationEvent
  | ConditionResolutionEvent
  | TransferSingleUpstreamEvent
  | TransferBatchUpstreamEvent;

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

// ─── Event Kind ↔ Wire Type Mapping ─────────────────────────────────────────

export const EVENT_KIND_TO_WIRE: Record<EventKind, string> = {
  trade: 'order_filled',
  match: 'orders_matched',
  cancel: 'order_cancelled',
  fee: 'fee_charged',
  split: 'position_split',
  merge: 'positions_merge',
  redeem: 'payout_redemption',
  convert: 'positions_converted',
  prepare: 'condition_preparation',
  resolve: 'condition_resolution',
  transfer: 'transfer_single',
  transfer_batch: 'transfer_batch',
  token_registered: 'token_registered',
  trading_paused: 'trading_paused',
  trading_unpaused: 'trading_unpaused',
};

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
