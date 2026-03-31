import type { EventTypeSubscription, FieldFilter, InternalSubscription, SubscribeMessage } from './types.js';

/**
 * Build the upstream WebSocket subscribe message from all active subscriptions.
 *
 * For each subscription, generates server-side filter groups:
 * - trade: 2 groups per address (maker eq addr, taker eq addr) + optional usdc_amount filter
 * - split: 1 group per address (stakeholder eq addr)
 * - merge: 1 group per address (stakeholder eq addr)
 * - redeem: 1 group per address (redeemer eq addr)
 */
export function buildSubscribeMessage(
  subscriptions: Map<string, InternalSubscription>,
): SubscribeMessage {
  const groups: EventTypeSubscription[] = [];

  for (const sub of subscriptions.values()) {
    if (!sub.callback) continue;

    const allAddresses = [...sub.wallets, ...sub.proxyWallets];
    const events = sub.options.events;

    // Compute minimum size threshold across all outcome filters for server-side optimization
    const minSize = computeMinSize(sub);

    for (const addr of allAddresses) {
      if (events.includes('trade')) {
        // order_filled: filter by maker
        groups.push(buildOrderFilledGroup(addr, 'maker', minSize));
        // order_filled: filter by taker
        groups.push(buildOrderFilledGroup(addr, 'taker', minSize));
      }

      if (events.includes('split')) {
        groups.push({
          event_type: 'position_split',
          filters: [{ field: 'stakeholder', op: 'eq', value: addr }],
        });
      }

      if (events.includes('merge')) {
        groups.push({
          event_type: 'positions_merge',
          filters: [{ field: 'stakeholder', op: 'eq', value: addr }],
        });
      }

      if (events.includes('redeem')) {
        groups.push({
          event_type: 'payout_redemption',
          filters: [{ field: 'redeemer', op: 'eq', value: addr }],
        });
      }
    }
  }

  return { action: 'subscribe', subscriptions: groups };
}

function buildOrderFilledGroup(
  addr: string,
  role: 'maker' | 'taker',
  minSize: number | null,
): EventTypeSubscription {
  const filters: FieldFilter[] = [{ field: role, op: 'eq', value: addr }];
  if (minSize !== null) {
    filters.push({ field: 'usdc_amount', op: 'gte', value: minSize });
  }
  return { event_type: 'order_filled', filters };
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
