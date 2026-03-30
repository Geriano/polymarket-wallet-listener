import { deriveProxyAddress, normalizeAddress } from './wallet.js';
import type { EventKind, InternalSubscription, SubscribeOptions, WatcherEvent } from './types.js';

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

  /**
   * Start watching for events. Replaces any previous callback.
   */
  watch(callback: (event: WatcherEvent) => void | Promise<void>): void {
    this._internal.callback = callback;
    this.onChanged();
  }

  /**
   * Stop watching. Removes callback and updates upstream subscription.
   */
  unwatch(): void {
    this._internal.callback = null;
    this.onChanged();
  }
}
