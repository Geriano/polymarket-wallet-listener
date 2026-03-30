import { normalizeAddress } from './wallet.js';
import type {
  InternalSubscription,
  OrderFilledEvent,
  OutcomeFilter,
  OutcomeInfo,
  PayoutRedemptionEvent,
  PositionSplitEvent,
  PositionsMergeEvent,
  TradeEvent,
  SplitEvent,
  MergeEvent,
  RedeemEvent,
  WatcherEvent,
} from './types.js';

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
    switch (eventType) {
      case 'order_filled':
        this.routeOrderFilled(data as unknown as OrderFilledEvent);
        break;
      case 'position_split':
        this.routePositionSplit(data as unknown as PositionSplitEvent);
        break;
      case 'positions_merge':
        this.routePositionsMerge(data as unknown as PositionsMergeEvent);
        break;
      case 'payout_redemption':
        this.routePayoutRedemption(data as unknown as PayoutRedemptionEvent);
        break;
    }
  }

  private routeOrderFilled(event: OrderFilledEvent): void {
    // Exclude internal protocol fills where the exchange contract is maker or taker
    const exchangeNorm = normalizeAddress(event.exchange);
    const makerNorm = normalizeAddress(event.maker);
    const takerNorm = normalizeAddress(event.taker);

    if (makerNorm === exchangeNorm || takerNorm === exchangeNorm) {
      return;
    }

    // Determine outcome token ID
    // Buy: makerAssetId == 0, outcome token is taker_asset_id
    // Sell: makerAssetId != 0, outcome token is maker_asset_id
    const outcomeTokenId =
      event.side === 'Buy' ? event.taker_asset_id : event.maker_asset_id;

    // Collect unique subscription IDs that match maker or taker
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

    for (const [subId, { wallet, isMaker }] of matched) {
      const sub = this.subs.get(subId);
      if (!sub?.callback) continue;
      if (!sub.options.events.includes('trade')) continue;

      // Wallet's side perspective
      const walletSide: 'Buy' | 'Sell' = isMaker
        ? event.side
        : event.side === 'Buy'
          ? 'Sell'
          : 'Buy';

      // Client-side outcome filtering
      const outcomeFilter = this.findOutcomeFilter(sub, outcomeTokenId);
      if (sub.options.outcomes && sub.options.outcomes.length > 0) {
        if (!outcomeFilter) continue;
      }

      // Client-side side filtering
      if (outcomeFilter?.side && outcomeFilter.side !== walletSide) continue;

      // Client-side size filtering
      if (outcomeFilter?.size != null && event.usdc_amount < outcomeFilter.size) continue;

      // Enrich outcome info
      const outcome: OutcomeInfo = this.outcomeRegistry.get(outcomeTokenId) ?? {
        id: outcomeTokenId,
        name: 'unknown',
        price: '0',
      };

      const tradeEvent: TradeEvent = {
        type: 'trade',
        wallet,
        outcome,
        side: walletSide,
        size: event.usdc_amount,
        price: event.price,
        tx: event.tx_hash,
        block: event.block_number,
        timestamp: Date.now(),
        raw: event,
      };

      this.invoke(sub, tradeEvent);
    }
  }

  private routePositionSplit(event: PositionSplitEvent): void {
    this.routeStakeholderEvent(event.stakeholder, 'split', {
      type: 'split',
      wallet: event.stakeholder,
      conditionId: event.condition_id,
      amount: parseFloat(event.amount) / 1e6,
      tx: event.tx_hash,
      block: event.block_number,
      timestamp: Date.now(),
      raw: event,
    } satisfies SplitEvent);
  }

  private routePositionsMerge(event: PositionsMergeEvent): void {
    this.routeStakeholderEvent(event.stakeholder, 'merge', {
      type: 'merge',
      wallet: event.stakeholder,
      conditionId: event.condition_id,
      amount: parseFloat(event.amount) / 1e6,
      tx: event.tx_hash,
      block: event.block_number,
      timestamp: Date.now(),
      raw: event,
    } satisfies MergeEvent);
  }

  private routePayoutRedemption(event: PayoutRedemptionEvent): void {
    this.routeStakeholderEvent(event.redeemer, 'redeem', {
      type: 'redeem',
      wallet: event.redeemer,
      conditionId: event.condition_id,
      payout: parseFloat(event.payout) / 1e6,
      tx: event.tx_hash,
      block: event.block_number,
      timestamp: Date.now(),
      raw: event,
    } satisfies RedeemEvent);
  }

  private routeStakeholderEvent(
    address: string,
    kind: 'split' | 'merge' | 'redeem',
    event: WatcherEvent,
  ): void {
    const norm = normalizeAddress(address);
    const subIds = this.addressIndex.get(norm);
    if (!subIds) return;

    for (const subId of subIds) {
      const sub = this.subs.get(subId);
      if (!sub?.callback) continue;
      if (!sub.options.events.includes(kind)) continue;
      this.invoke(sub, event);
    }
  }

  private findOutcomeFilter(
    sub: InternalSubscription,
    tokenId: string,
  ): OutcomeFilter | undefined {
    return sub.options.outcomes?.find((o) => o.id === tokenId);
  }

  private invoke(sub: InternalSubscription, event: WatcherEvent): void {
    try {
      const result = sub.callback!(event);
      if (result instanceof Promise) {
        result.catch(() => {});
      }
    } catch {
      // Swallow sync callback errors
    }
  }
}
