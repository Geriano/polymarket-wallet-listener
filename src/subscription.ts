import { deriveProxyAddress, normalizeAddress } from './wallet.js';
import type {
  EventKind,
  InternalSubscription,
  SubscribeOptions,
  TypedHandler,
  WatcherEvent,
} from './types.js';

const DEFAULT_EVENTS: EventKind[] = ['trade'];

export class Subscription {
  /** @internal */
  readonly _internal: InternalSubscription;

  private readonly onChanged: () => void;

  constructor(
    wallets: string[],
    options: SubscribeOptions | undefined,
    onChanged: () => void,
  ) {
    this.onChanged = onChanged;

    const normalized = wallets.map((w) => normalizeAddress(w));
    const proxies = options?.skipProxy
      ? []
      : normalized.map((w) => normalizeAddress(deriveProxyAddress(w)));

    this._internal = {
      id: crypto.randomUUID(),
      wallets: normalized,
      proxyWallets: proxies,
      options: {
        outcomes: options?.outcomes,
        events: options?.events ?? DEFAULT_EVENTS,
      },
      callback: null,
      handlers: new Map(),
      autoEvents: new Set(),
    };
  }

  get id(): string {
    return this._internal.id;
  }

  get wallets(): string[] {
    return this._internal.wallets;
  }

  get proxyWallets(): string[] {
    return this._internal.proxyWallets;
  }

  // ─── Catch-all callback ─────────────────────────────────────────────────

  /**
   * Start watching for events. Replaces any previous callback.
   */
  watch(callback: (event: WatcherEvent) => void | Promise<void>): void {
    this._internal.callback = callback;
    this.onChanged();
  }

  /**
   * Stop watching. Removes all callbacks (catch-all and typed handlers).
   */
  unwatch(): void {
    this._internal.callback = null;
    this._internal.handlers.clear();
    this._internal.autoEvents.clear();
    this.onChanged();
  }

  // ─── Typed event callbacks ──────────────────────────────────────────────

  traded(callback: TypedHandler<'trade'>): () => void {
    return this._on('trade', callback);
  }

  splitted(callback: TypedHandler<'split'>): () => void {
    return this._on('split', callback);
  }

  merged(callback: TypedHandler<'merge'>): () => void {
    return this._on('merge', callback);
  }

  redeemed(callback: TypedHandler<'redeem'>): () => void {
    return this._on('redeem', callback);
  }

  matched(callback: TypedHandler<'match'>): () => void {
    return this._on('match', callback);
  }

  cancelled(callback: TypedHandler<'cancel'>): () => void {
    return this._on('cancel', callback);
  }

  fee(callback: TypedHandler<'fee'>): () => void {
    return this._on('fee', callback);
  }

  converted(callback: TypedHandler<'convert'>): () => void {
    return this._on('convert', callback);
  }

  prepared(callback: TypedHandler<'prepare'>): () => void {
    return this._on('prepare', callback);
  }

  resolved(callback: TypedHandler<'resolve'>): () => void {
    return this._on('resolve', callback);
  }

  transferred(callback: TypedHandler<'transfer'>): () => void {
    return this._on('transfer', callback);
  }

  transferredBatch(callback: TypedHandler<'transfer_batch'>): () => void {
    return this._on('transfer_batch', callback);
  }

  tokenRegistered(callback: TypedHandler<'token_registered'>): () => void {
    return this._on('token_registered', callback);
  }

  tradingPaused(callback: TypedHandler<'trading_paused'>): () => void {
    return this._on('trading_paused', callback);
  }

  tradingUnpaused(callback: TypedHandler<'trading_unpaused'>): () => void {
    return this._on('trading_unpaused', callback);
  }

  // ─── Internal ───────────────────────────────────────────────────────────

  private _on<K extends EventKind>(
    kind: K,
    callback: TypedHandler<K>,
  ): () => void {
    const internal = this._internal;

    // Add to handlers set
    let set = internal.handlers.get(kind);
    if (!set) {
      set = new Set();
      internal.handlers.set(kind, set);
    }
    set.add(callback as (event: any) => void | Promise<void>);

    // Auto-subscribe: add event kind if not already present
    if (!internal.options.events.includes(kind)) {
      internal.options.events = [...internal.options.events, kind];
      internal.autoEvents.add(kind);
    }

    this.onChanged();

    // Return disposer
    return () => {
      set!.delete(callback as (event: any) => void | Promise<void>);
      if (set!.size === 0) {
        internal.handlers.delete(kind);
        // Remove auto-added event kind if no handlers remain
        if (internal.autoEvents.has(kind)) {
          internal.options.events = internal.options.events.filter((e) => e !== kind);
          internal.autoEvents.delete(kind);
        }
      }
      this.onChanged();
    };
  }
}
