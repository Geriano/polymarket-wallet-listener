import type { EventKind, EventTypeSubscription, FieldFilter, InternalSubscription, ProtocolMessage } from './types.js';
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
  order_preapproved: [],
  order_preapproval_invalidated: [],
  user_paused: ['user'],
  user_unpaused: ['user'],
  user_pause_block_interval_updated: [],
  fee_receiver_updated: [],
  max_fee_rate_updated: [],
};

/**
 * Canonical string key for an EventTypeSubscription, used for diffing.
 */
function canonicalize(group: EventTypeSubscription): string {
  if (!group.filters || group.filters.length === 0) {
    return group.event_type;
  }
  const sorted = [...group.filters].sort((a, b) =>
    a.field < b.field ? -1 : a.field > b.field ? 1 :
    a.op < b.op ? -1 : a.op > b.op ? 1 :
    String(a.value) < String(b.value) ? -1 : String(a.value) > String(b.value) ? 1 : 0,
  );
  return group.event_type + '|' + JSON.stringify(sorted);
}

/**
 * Build the flat list of EventTypeSubscription groups from all active subscriptions.
 */
function buildGroups(subscriptions: Map<string, InternalSubscription>): EventTypeSubscription[] {
  const groups: EventTypeSubscription[] = [];
  const broadcastSeen = new Set<string>();

  for (const sub of subscriptions.values()) {
    if (!sub.callback && sub.handlers.size === 0) continue;

    const allAddresses = [...sub.wallets, ...sub.proxyWallets];
    const events = sub.options.events;
    const minSize = computeMinSize(sub);

    for (const kind of events) {
      const wireType = EVENT_KIND_TO_WIRE[kind];
      const addrFields = ADDRESS_FIELDS[kind];

      if (addrFields.length === 0) {
        if (!broadcastSeen.has(wireType)) {
          broadcastSeen.add(wireType);
          groups.push({ event_type: wireType });
        }
      } else {
        for (const addr of allAddresses) {
          for (const field of addrFields) {
            const filters: FieldFilter[] = [{ field, op: 'eq', value: addr }];
            if (wireType === 'order_filled' && minSize !== null) {
              filters.push({ field: 'usdc_amount', op: 'gte', value: minSize });
            }
            groups.push({ event_type: wireType, filters });
          }
        }
      }
    }
  }

  return groups;
}

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

/**
 * Stateful protocol layer that tracks last-sent subscription state
 * and computes optimal wire messages (subscribe / extend / exclude).
 */
export class ProtocolState {
  private lastSentKeys = new Map<string, EventTypeSubscription>();
  private hasSentInitial = false;

  /**
   * Reset state. Call on reconnect to force a full subscribe.
   */
  reset(): void {
    this.lastSentKeys.clear();
    this.hasSentInitial = false;
  }

  /**
   * Compute the optimal wire message(s) for the current subscription state.
   */
  computeMessages(subscriptions: Map<string, InternalSubscription>): ProtocolMessage[] {
    const desiredGroups = buildGroups(subscriptions);

    // Build desired key → group map
    const desiredKeys = new Map<string, EventTypeSubscription>();
    for (const group of desiredGroups) {
      desiredKeys.set(canonicalize(group), group);
    }

    // First message ever → full subscribe
    if (!this.hasSentInitial) {
      this.hasSentInitial = true;
      this.lastSentKeys = desiredKeys;
      return [{ action: 'subscribe', subscriptions: desiredGroups }];
    }

    // Compute diff
    const addedKeys: string[] = [];
    for (const key of desiredKeys.keys()) {
      if (!this.lastSentKeys.has(key)) addedKeys.push(key);
    }

    const removedKeys: string[] = [];
    for (const key of this.lastSentKeys.keys()) {
      if (!desiredKeys.has(key)) removedKeys.push(key);
    }

    // No changes
    if (addedKeys.length === 0 && removedKeys.length === 0) {
      return [];
    }

    // Pure addition → extend
    if (removedKeys.length === 0) {
      const added = addedKeys.map((k) => desiredKeys.get(k)!);
      this.lastSentKeys = desiredKeys;
      return [{ action: 'extend', subscriptions: added }];
    }

    // Check if removals eliminate whole event types
    const removedEventTypes = new Set<string>();
    for (const key of removedKeys) {
      const group = this.lastSentKeys.get(key)!;
      removedEventTypes.add(group.event_type);
    }

    const desiredEventTypes = new Set<string>();
    for (const group of desiredGroups) {
      desiredEventTypes.add(group.event_type);
    }

    // Find event types that are fully removed (not present in desired at all)
    const fullyRemovedTypes: string[] = [];
    for (const eventType of removedEventTypes) {
      if (!desiredEventTypes.has(eventType)) {
        fullyRemovedTypes.push(eventType);
      }
    }

    // All removals are whole event types → can use exclude + optional extend
    if (fullyRemovedTypes.length === removedEventTypes.size) {
      const messages: ProtocolMessage[] = [
        { action: 'exclude', event_types: fullyRemovedTypes },
      ];
      if (addedKeys.length > 0) {
        const added = addedKeys.map((k) => desiredKeys.get(k)!);
        messages.push({ action: 'extend', subscriptions: added });
      }
      this.lastSentKeys = desiredKeys;
      return messages;
    }

    // Partial removal → full rebuild
    this.lastSentKeys = desiredKeys;
    return [{ action: 'subscribe', subscriptions: desiredGroups }];
  }
}
