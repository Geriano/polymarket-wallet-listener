import type { EventKind, EventTypeSubscription, FieldFilter, InternalSubscription, SubscribeMessage } from './types.js';
import { EVENT_KIND_TO_WIRE } from './types.js';

const ADDRESS_FIELDS: Record<EventKind, string[]> = {
  trade: ['maker', 'taker'],
  match: ['taker_order_maker'],
  cancel: [],
  fee: ['receiver'],
  split: ['stakeholder'],
  merge: ['stakeholder'],
  redeem: ['redeemer'],
  convert: ['stakeholder'],
  prepare: [],
  resolve: [],
  transfer: ['from', 'to'],
  transfer_batch: ['from', 'to'],
  token_registered: [],
  trading_paused: [],
  trading_unpaused: [],
};

/**
 * Build the upstream WebSocket subscribe message from all active subscriptions.
 */
export function buildSubscribeMessage(
  subscriptions: Map<string, InternalSubscription>,
): SubscribeMessage {
  const groups: EventTypeSubscription[] = [];
  const broadcastSeen = new Set<string>();

  for (const sub of subscriptions.values()) {
    if (!sub.callback) continue;

    const allAddresses = [...sub.wallets, ...sub.proxyWallets];
    const events = sub.options.events;
    const minSize = computeMinSize(sub);

    for (const kind of events) {
      const wireType = EVENT_KIND_TO_WIRE[kind];
      const addrFields = ADDRESS_FIELDS[kind];

      if (addrFields.length === 0) {
        // Broadcast event — subscribe once with no address filter
        if (!broadcastSeen.has(wireType)) {
          broadcastSeen.add(wireType);
          groups.push({ event_type: wireType });
        }
      } else {
        for (const addr of allAddresses) {
          for (const field of addrFields) {
            const filters: FieldFilter[] = [{ field, op: 'eq', value: addr }];
            // Server-side size optimization for order_filled only
            if (wireType === 'order_filled' && minSize !== null) {
              filters.push({ field: 'usdc_amount', op: 'gte', value: minSize });
            }
            groups.push({ event_type: wireType, filters });
          }
        }
      }
    }
  }

  return { action: 'subscribe', subscriptions: groups };
}

/**
 * If ALL outcome filters have a size threshold, return the minimum.
 * Otherwise return null (no server-side size filter).
 */
function computeMinSize(sub: InternalSubscription): number | null {
  const outcomes = sub.options.outcomes;
  if (!outcomes || outcomes.length === 0) return null;

  let min = Infinity;
  for (const o of outcomes) {
    if (o.size == null) return null;
    if (o.size < min) min = o.size;
  }
  return min;
}
