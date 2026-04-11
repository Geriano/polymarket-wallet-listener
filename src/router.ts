import { normalizeAddress } from './wallet.js';
import type {
  ClobEnrichment,
  ConditionPreparationEvent,
  ConditionResolutionEvent,
  EventKind,
  FeeChargedEvent,
  GammaEnrichment,
  InternalSubscription,
  OrderCancelledEvent,
  OrderFilledEvent,
  OrdersMatchedEvent,
  OutcomeFilter,
  OutcomeInfo,
  PayoutRedemptionEvent,
  PositionsConvertedEvent,
  PositionSplitEvent,
  PositionsMergeEvent,
  TokenRegisteredUpstreamEvent,
  TradingPausedUpstreamEvent,
  TradingUnpausedUpstreamEvent,
  TransferBatchUpstreamEvent,
  TransferSingleUpstreamEvent,
  WatcherEvent,
} from './types.js';

function hasListeners(sub: InternalSubscription): boolean {
  return sub.callback !== null || sub.handlers.size > 0;
}

export class EventRouter {
  // subscriptionId → InternalSubscription
  private readonly subs = new Map<string, InternalSubscription>();

  // normalizedAddress → Set<subscriptionId>
  private readonly addressIndex = new Map<string, Set<string>>();

  // CLOB tokenId → OutcomeInfo
  private readonly outcomeRegistry = new Map<string, OutcomeInfo>();

  register(sub: InternalSubscription): void {
    this.subs.set(sub.id, sub);
    const allAddrs = [...sub.wallets, ...sub.proxyWallets];
    for (const addr of allAddrs) {
      const norm = normalizeAddress(addr);
      let set = this.addressIndex.get(norm);
      if (!set) {
        set = new Set();
        this.addressIndex.set(norm, set);
      }
      set.add(sub.id);
    }
  }

  unregister(subId: string): void {
    const sub = this.subs.get(subId);
    if (!sub) return;
    this.subs.delete(subId);
    const allAddrs = [...sub.wallets, ...sub.proxyWallets];
    for (const addr of allAddrs) {
      const norm = normalizeAddress(addr);
      const set = this.addressIndex.get(norm);
      if (set) {
        set.delete(subId);
        if (set.size === 0) this.addressIndex.delete(norm);
      }
    }
  }

  registerOutcomes(outcomes: OutcomeInfo[]): void {
    for (const o of outcomes) {
      this.outcomeRegistry.set(o.id, o);
    }
  }

  route(data: Record<string, unknown>): void {
    const eventType = data.type as string;
    if (!eventType) return;

    // Extract gamma outcomes from enrichment on any event that carries them
    this.extractGammaOutcomes(data);

    switch (eventType) {
      // ── Trading ──
      case 'order_filled':
        if (!data.maker || !data.taker || !data.exchange) break;
        this.routeOrderFilled(data as unknown as OrderFilledEvent, data);
        break;
      case 'orders_matched':
        if (!data.taker_order_maker) break;
        this.routeOrdersMatched(data as unknown as OrdersMatchedEvent, data);
        break;
      case 'order_cancelled':
        this.routeOrderCancelled(data as unknown as OrderCancelledEvent, data);
        break;
      case 'fee_charged':
        if (!data.receiver) break;
        this.routeFeeCharged(data as unknown as FeeChargedEvent, data);
        break;

      // ── Position ──
      case 'position_split':
        if (!data.stakeholder) break;
        this.routePositionSplit(data as unknown as PositionSplitEvent, data);
        break;
      case 'positions_merge':
        if (!data.stakeholder) break;
        this.routePositionsMerge(data as unknown as PositionsMergeEvent, data);
        break;
      case 'payout_redemption':
        if (!data.redeemer) break;
        this.routePayoutRedemption(data as unknown as PayoutRedemptionEvent, data);
        break;
      case 'positions_converted':
        if (!data.stakeholder) break;
        this.routePositionsConverted(data as unknown as PositionsConvertedEvent, data);
        break;

      // ── Resolution ──
      case 'condition_preparation':
        this.routeBroadcast('prepare', data as unknown as ConditionPreparationEvent, data);
        break;
      case 'condition_resolution':
        this.routeBroadcast('resolve', data as unknown as ConditionResolutionEvent, data);
        break;

      // ── Transfer ──
      case 'transfer_single':
        if (!data.from && !data.to) break;
        this.routeTransferSingle(data as unknown as TransferSingleUpstreamEvent, data);
        break;
      case 'transfer_batch':
        if (!data.from && !data.to) break;
        this.routeTransferBatch(data as unknown as TransferBatchUpstreamEvent, data);
        break;

      // ── Admin ──
      case 'token_registered':
        this.routeBroadcast('token_registered', data as unknown as TokenRegisteredUpstreamEvent, data);
        break;
      case 'trading_paused':
        this.routeBroadcast('trading_paused', data as unknown as TradingPausedUpstreamEvent, data);
        break;
      case 'trading_unpaused':
        this.routeBroadcast('trading_unpaused', data as unknown as TradingUnpausedUpstreamEvent, data);
        break;
    }
  }

  // ─── Enrichment Helpers ───────────────────────────────────────────────────

  private extractEnrichment(data: Record<string, unknown>): {
    gamma: GammaEnrichment | null;
    clob: ClobEnrichment | null;
  } {
    const gamma = (data.gamma as GammaEnrichment) ?? null;
    const clob = (data.clob as ClobEnrichment) ?? null;
    return { gamma, clob };
  }

  private extractGammaOutcomes(data: Record<string, unknown>): void {
    const gamma = data.gamma as Record<string, unknown> | undefined;
    if (!gamma) return;

    const tokenIds = gamma.clob_token_ids as string[] | undefined;
    const names = gamma.outcomes as string[] | undefined;
    const prices = gamma.outcome_prices as string[] | undefined;
    if (!tokenIds || !names) return;

    for (let i = 0; i < tokenIds.length; i++) {
      const id = tokenIds[i];
      if (this.outcomeRegistry.has(id)) continue;
      this.outcomeRegistry.set(id, {
        id,
        name: names[i] ?? 'unknown',
        price: prices?.[i] ?? '0',
      });
    }
  }

  // ─── Trading Event Routes ─────────────────────────────────────────────────

  private routeOrderFilled(event: OrderFilledEvent, data: Record<string, unknown>): void {
    const exchangeNorm = normalizeAddress(event.exchange);
    const makerNorm = normalizeAddress(event.maker);
    const takerNorm = normalizeAddress(event.taker);

    if (makerNorm === exchangeNorm || takerNorm === exchangeNorm) {
      return;
    }

    const outcomeTokenId =
      event.side === 'Buy' ? event.taker_asset_id : event.maker_asset_id;

    const matched = new Map<string, { wallet: string; isMaker: boolean }>();

    const makerSubs = this.addressIndex.get(makerNorm);
    if (makerSubs) {
      for (const subId of makerSubs) {
        if (!matched.has(subId)) {
          matched.set(subId, { wallet: event.maker, isMaker: true });
        }
      }
    }

    const takerSubs = this.addressIndex.get(takerNorm);
    if (takerSubs) {
      for (const subId of takerSubs) {
        if (!matched.has(subId)) {
          matched.set(subId, { wallet: event.taker, isMaker: false });
        }
      }
    }

    const { gamma, clob } = this.extractEnrichment(data);

    for (const [subId, { wallet, isMaker }] of matched) {
      const sub = this.subs.get(subId);
      if (!sub || !hasListeners(sub)) continue;
      if (!sub.options.events.includes('trade')) continue;

      const rawWalletSide: 'Buy' | 'Sell' = isMaker
        ? event.side
        : event.side === 'Buy'
          ? 'Sell'
          : 'Buy';

      const norm = this.normalizeBinaryOutcome(
        outcomeTokenId,
        rawWalletSide,
        event.price,
        event.collateral_amount ?? event.usdc_amount,
        gamma,
      );

      const outcomeFilter = this.findOutcomeFilter(sub, norm.outcomeTokenId);
      if (sub.options.outcomes && sub.options.outcomes.length > 0) {
        if (!outcomeFilter) continue;
      }

      if (outcomeFilter?.side && outcomeFilter.side !== norm.walletSide) continue;
      if (outcomeFilter?.size != null && norm.usdcAmount < outcomeFilter.size) continue;

      const outcome: OutcomeInfo = this.outcomeRegistry.get(norm.outcomeTokenId) ?? {
        id: outcomeFilter?.id ?? norm.outcomeTokenId,
        name: outcomeFilter?.name ?? 'unknown',
        price: outcomeFilter?.price ?? '0',
      };

      const market = gamma?.question ?? '';
      const buyPrice = norm.walletSide === 'Buy' ? norm.price : 1 - norm.price;
      const sellPrice = 1 - buyPrice;

      this.invoke(sub, {
        type: 'trade',
        wallet,
        market,
        outcome,
        side: norm.walletSide,
        size: norm.usdcAmount,
        collateralAmount: norm.usdcAmount,
        price: norm.price,
        buyPrice,
        sellPrice,
        negRisk: event.neg_risk ?? false,
        buyer: event.buyer ?? '',
        seller: event.seller ?? '',
        tx: event.tx_hash,
        block: event.block_number,
        timestamp: Date.now(),
        normalized: norm.normalized,
        gamma,
        clob,
        raw: event,
      });
    }
  }

  private routeOrdersMatched(event: OrdersMatchedEvent, data: Record<string, unknown>): void {
    const { gamma, clob } = this.extractEnrichment(data);
    this.routeAddressEvent(event.taker_order_maker, 'match', {
      type: 'match',
      wallet: event.taker_order_maker,
      takerOrderHash: event.taker_order_hash,
      makerAssetId: event.maker_asset_id,
      takerAssetId: event.taker_asset_id,
      makerAmountFilled: event.maker_amount_filled,
      takerAmountFilled: event.taker_amount_filled,
      tx: event.tx_hash,
      block: event.block_number,
      timestamp: Date.now(),
      gamma,
      clob,
      raw: event,
    });
  }

  private routeOrderCancelled(event: OrderCancelledEvent, data: Record<string, unknown>): void {
    const { gamma, clob } = this.extractEnrichment(data);
    this.routeBroadcastEvent('cancel', {
      type: 'cancel',
      orderHash: event.order_hash,
      tx: event.tx_hash,
      block: event.block_number,
      timestamp: Date.now(),
      gamma,
      clob,
      raw: event,
    });
  }

  private routeFeeCharged(event: FeeChargedEvent, data: Record<string, unknown>): void {
    const { gamma, clob } = this.extractEnrichment(data);
    this.routeAddressEvent(event.receiver, 'fee', {
      type: 'fee',
      receiver: event.receiver,
      tokenId: event.token_id,
      amount: event.amount,
      tx: event.tx_hash,
      block: event.block_number,
      timestamp: Date.now(),
      gamma,
      clob,
      raw: event,
    });
  }

  // ─── Position Event Routes ────────────────────────────────────────────────

  private routePositionSplit(event: PositionSplitEvent, data: Record<string, unknown>): void {
    const { gamma, clob } = this.extractEnrichment(data);
    const amount = parseFloat(event.amount) / 1e6;
    this.routeAddressEvent(event.stakeholder, 'split', {
      type: 'split',
      wallet: event.stakeholder,
      conditionId: event.condition_id,
      amount,
      collateralAmount: event.collateral_amount ?? amount,
      source: event.source ?? '',
      negRisk: event.neg_risk ?? false,
      tx: event.tx_hash,
      block: event.block_number,
      timestamp: Date.now(),
      gamma,
      clob,
      raw: event,
    });
  }

  private routePositionsMerge(event: PositionsMergeEvent, data: Record<string, unknown>): void {
    const { gamma, clob } = this.extractEnrichment(data);
    const amount = parseFloat(event.amount) / 1e6;
    this.routeAddressEvent(event.stakeholder, 'merge', {
      type: 'merge',
      wallet: event.stakeholder,
      conditionId: event.condition_id,
      amount,
      collateralAmount: event.collateral_amount ?? amount,
      source: event.source ?? '',
      negRisk: event.neg_risk ?? false,
      tx: event.tx_hash,
      block: event.block_number,
      timestamp: Date.now(),
      gamma,
      clob,
      raw: event,
    });
  }

  private routePayoutRedemption(event: PayoutRedemptionEvent, data: Record<string, unknown>): void {
    const { gamma, clob } = this.extractEnrichment(data);
    const payout = parseFloat(event.payout) / 1e6;
    this.routeAddressEvent(event.redeemer, 'redeem', {
      type: 'redeem',
      wallet: event.redeemer,
      conditionId: event.condition_id,
      payout,
      collateralAmount: event.collateral_amount ?? payout,
      tx: event.tx_hash,
      block: event.block_number,
      timestamp: Date.now(),
      gamma,
      clob,
      raw: event,
    });
  }

  private routePositionsConverted(event: PositionsConvertedEvent, data: Record<string, unknown>): void {
    const { gamma, clob } = this.extractEnrichment(data);
    this.routeAddressEvent(event.stakeholder, 'convert', {
      type: 'convert',
      wallet: event.stakeholder,
      marketId: event.market_id,
      indexSet: event.index_set,
      amount: parseFloat(event.amount) / 1e6,
      tx: event.tx_hash,
      block: event.block_number,
      timestamp: Date.now(),
      gamma,
      clob,
      raw: event,
    });
  }

  // ─── Transfer Event Routes ────────────────────────────────────────────────

  private routeTransferSingle(event: TransferSingleUpstreamEvent, data: Record<string, unknown>): void {
    const { gamma, clob } = this.extractEnrichment(data);
    const watcherEvent: WatcherEvent = {
      type: 'transfer',
      operator: event.operator,
      from: event.from,
      to: event.to,
      tokenId: event.id,
      value: event.value,
      tx: event.tx_hash,
      block: event.block_number,
      timestamp: Date.now(),
      gamma,
      clob,
      raw: event,
    };
    this.routeDualAddressEvent(event.from, event.to, 'transfer', watcherEvent);
  }

  private routeTransferBatch(event: TransferBatchUpstreamEvent, data: Record<string, unknown>): void {
    const { gamma, clob } = this.extractEnrichment(data);
    const watcherEvent: WatcherEvent = {
      type: 'transfer_batch',
      operator: event.operator,
      from: event.from,
      to: event.to,
      ids: event.ids,
      values: event.values,
      tx: event.tx_hash,
      block: event.block_number,
      timestamp: Date.now(),
      gamma,
      clob,
      raw: event,
    };
    this.routeDualAddressEvent(event.from, event.to, 'transfer_batch', watcherEvent);
  }

  // ─── Broadcast Routes (called from route() switch for admin/resolution) ──

  private routeBroadcast(
    kind: EventKind,
    event: unknown,
    data: Record<string, unknown>,
  ): void {
    const { gamma, clob } = this.extractEnrichment(data);
    let watcherEvent: WatcherEvent;

    switch (kind) {
      case 'prepare': {
        const e = event as unknown as ConditionPreparationEvent;
        watcherEvent = {
          type: 'prepare',
          conditionId: e.condition_id,
          oracle: e.oracle,
          questionId: e.question_id,
          outcomeSlotCount: e.outcome_slot_count,
          tx: e.tx_hash,
          block: e.block_number,
          timestamp: Date.now(),
          gamma,
          clob,
          raw: event as object,
        };
        break;
      }
      case 'resolve': {
        const e = event as unknown as ConditionResolutionEvent;
        watcherEvent = {
          type: 'resolve',
          conditionId: e.condition_id,
          oracle: e.oracle,
          questionId: e.question_id,
          outcomeSlotCount: e.outcome_slot_count,
          payoutNumerators: e.payout_numerators,
          tx: e.tx_hash,
          block: e.block_number,
          timestamp: Date.now(),
          gamma,
          clob,
          raw: event as object,
        };
        break;
      }
      case 'token_registered': {
        const e = event as unknown as TokenRegisteredUpstreamEvent;
        watcherEvent = {
          type: 'token_registered',
          token0: e.token0,
          token1: e.token1,
          conditionId: e.condition_id,
          tx: e.tx_hash,
          block: e.block_number,
          timestamp: Date.now(),
          gamma,
          clob,
          raw: event as object,
        };
        break;
      }
      case 'trading_paused': {
        const e = event as unknown as TradingPausedUpstreamEvent;
        watcherEvent = {
          type: 'trading_paused',
          pauser: e.pauser,
          tx: e.tx_hash,
          block: e.block_number,
          timestamp: Date.now(),
          gamma,
          clob,
          raw: event as object,
        };
        break;
      }
      case 'trading_unpaused': {
        const e = event as unknown as TradingUnpausedUpstreamEvent;
        watcherEvent = {
          type: 'trading_unpaused',
          unpauser: e.unpauser,
          tx: e.tx_hash,
          block: e.block_number,
          timestamp: Date.now(),
          gamma,
          clob,
          raw: event as object,
        };
        break;
      }
      default:
        return;
    }

    this.routeBroadcastEvent(kind, watcherEvent);
  }

  // ─── Dispatch Helpers ─────────────────────────────────────────────────────

  private routeAddressEvent(address: string, kind: EventKind, event: WatcherEvent): void {
    const norm = normalizeAddress(address);
    const subIds = this.addressIndex.get(norm);
    if (!subIds) return;

    for (const subId of subIds) {
      const sub = this.subs.get(subId);
      if (!sub || !hasListeners(sub)) continue;
      if (!sub.options.events.includes(kind)) continue;
      this.invoke(sub, event);
    }
  }

  private routeDualAddressEvent(
    addr1: string,
    addr2: string,
    kind: EventKind,
    event: WatcherEvent,
  ): void {
    const norm1 = normalizeAddress(addr1);
    const norm2 = normalizeAddress(addr2);
    const dispatched = new Set<string>();

    for (const norm of [norm1, norm2]) {
      const subIds = this.addressIndex.get(norm);
      if (!subIds) continue;
      for (const subId of subIds) {
        if (dispatched.has(subId)) continue;
        dispatched.add(subId);
        const sub = this.subs.get(subId);
        if (!sub || !hasListeners(sub)) continue;
        if (!sub.options.events.includes(kind)) continue;
        this.invoke(sub, event);
      }
    }
  }

  private routeBroadcastEvent(kind: EventKind, event: WatcherEvent): void {
    for (const sub of this.subs.values()) {
      if (!hasListeners(sub)) continue;
      if (!sub.options.events.includes(kind)) continue;
      this.invoke(sub, event);
    }
  }

  // ─── Utilities ────────────────────────────────────────────────────────────

  private normalizeBinaryOutcome(
    outcomeTokenId: string,
    walletSide: 'Buy' | 'Sell',
    price: number,
    usdcAmount: number,
    gamma: GammaEnrichment | null,
  ): {
    normalized: boolean;
    outcomeTokenId: string;
    walletSide: 'Buy' | 'Sell';
    price: number;
    usdcAmount: number;
  } {
    if (!gamma?.clob_token_ids || gamma.clob_token_ids.length !== 2) {
      return { normalized: false, outcomeTokenId, walletSide, price, usdcAmount };
    }

    const [canonicalTokenId, complementTokenId] = gamma.clob_token_ids;

    if (outcomeTokenId !== complementTokenId) {
      return { normalized: false, outcomeTokenId, walletSide, price, usdcAmount };
    }

    const flippedSide: 'Buy' | 'Sell' = walletSide === 'Buy' ? 'Sell' : 'Buy';
    const complementPrice = 1 - price;
    const normalizedUsdc = price > 0
      ? (usdcAmount / price) * complementPrice
      : usdcAmount;

    return {
      normalized: true,
      outcomeTokenId: canonicalTokenId,
      walletSide: flippedSide,
      price: complementPrice,
      usdcAmount: normalizedUsdc,
    };
  }

  private findOutcomeFilter(
    sub: InternalSubscription,
    tokenId: string,
  ): OutcomeFilter | undefined {
    return sub.options.outcomes?.find((o) => o.id === tokenId);
  }

  private invoke(sub: InternalSubscription, event: WatcherEvent): void {
    // Call catch-all watch() callback
    if (sub.callback) {
      try {
        const result = sub.callback(event);
        if (result instanceof Promise) {
          result.catch((err) => {
            console.warn('[polymarket-wallet-listener] async callback error:', err);
          });
        }
      } catch (err) {
        console.warn('[polymarket-wallet-listener] sync callback error:', err);
      }
    }

    // Call typed handlers for this event kind
    const handlers = sub.handlers.get(event.type as EventKind);
    if (handlers) {
      for (const handler of handlers) {
        try {
          const result = handler(event);
          if (result instanceof Promise) {
            result.catch((err) => {
              console.warn('[polymarket-wallet-listener] async callback error:', err);
            });
          }
        } catch (err) {
          console.warn('[polymarket-wallet-listener] sync callback error:', err);
        }
      }
    }
  }
}
