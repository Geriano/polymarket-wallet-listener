import WebSocketImpl from 'ws';
import { GammaClient } from './gamma.js';
import { EventRouter } from './router.js';
import { Subscription } from './subscription.js';
import { ProtocolState } from './protocol.js';
import { ConnectionError, ProtocolError, ReconnectError, ServerError } from './errors.js';
import type {
  InternalSubscription,
  KeepaliveOptions,
  LifecycleEvent,
  LifecycleEventMap,
  OutcomeInfo,
  ReconnectOptions,
  ServerMessage,
  SubscribeOptions,
  WatcherOptions,
} from './types.js';
import { DEFAULT_KEEPALIVE, DEFAULT_RECONNECT } from './types.js';

type WebSocketLike = {
  readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
};

export class Watcher {
  private readonly wsUrl: string;
  private readonly gamma: GammaClient | null;
  private readonly reconnectOpts: ReconnectOptions;
  private readonly keepaliveOpts: KeepaliveOptions;
  private readonly WebSocketCtor: unknown;

  // WebSocket state
  private ws: WebSocketLike | null = null;
  private manualClose = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private awaitingPong = false;

  // Subscriptions
  private readonly subscriptions = new Map<string, InternalSubscription>();
  private readonly router = new EventRouter();
  private readonly protocol = new ProtocolState();
  private pendingSend = false;

  // Outcomes cache: slug → OutcomeInfo[]
  private readonly outcomesCache = new Map<string, OutcomeInfo[]>();

  // Lifecycle event listeners
  private readonly listeners = new Map<string, Set<Function>>();

  constructor(options: WatcherOptions) {
    this.wsUrl = options.wsUrl;
    this.gamma = options.gammaUrl ? new GammaClient(options.gammaUrl) : null;
    this.reconnectOpts = { ...DEFAULT_RECONNECT, ...options.reconnect };
    this.keepaliveOpts = { ...DEFAULT_KEEPALIVE, ...options.keepalive };
    this.WebSocketCtor = options.WebSocket ?? undefined;
  }

  // ─── Lifecycle Events ────────────────────────────────────────────────────

  on<K extends LifecycleEvent>(event: K, listener: LifecycleEventMap[K]): this {
    this.getListeners(event).add(listener);
    return this;
  }

  off<K extends LifecycleEvent>(event: K, listener: LifecycleEventMap[K]): this {
    this.getListeners(event).delete(listener);
    return this;
  }

  private emit(event: string, ...args: unknown[]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of set) {
      try {
        (fn as Function)(...args);
      } catch {
        // Swallow listener errors
      }
    }
  }

  private getListeners(event: string): Set<Function> {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    return set;
  }

  // ─── Outcomes ────────────────────────────────────────────────────────────

  /**
   * Fetch outcome metadata for a market slug.
   * @param slug - Market slug (e.g., 'btc-updown-5m-17xx91')
   * @param cache - Use cached result if available (default: true)
   */
  /**
   * Fetch outcome metadata for a market slug.
   * Requires `gammaUrl` to be set in WatcherOptions.
   */
  async outcomes(slug: string, cache: boolean = true): Promise<OutcomeInfo[]> {
    if (!this.gamma) {
      throw new Error(
        'gammaUrl is required for slug-based outcome lookups. ' +
        'Provide it in WatcherOptions or use server enrichment instead.',
      );
    }

    if (cache) {
      const cached = this.outcomesCache.get(slug);
      if (cached) return cached;
    }

    const outcomes = await this.gamma.fetchOutcomes(slug);
    this.outcomesCache.set(slug, outcomes);
    this.router.registerOutcomes(outcomes);
    return outcomes;
  }

  // ─── Subscribe ───────────────────────────────────────────────────────────

  /**
   * Create a subscription for one or more wallet addresses.
   * Triggers lazy WebSocket connection on first call.
   */
  subscribe(wallet: string | string[], options?: SubscribeOptions): Subscription {
    const wallets = Array.isArray(wallet) ? wallet : [wallet];
    const sub = new Subscription(wallets, options, () => this.rebuildSubscription());

    this.subscriptions.set(sub.id, sub._internal);
    this.router.register(sub._internal);

    // Lazy connect: first subscribe triggers WS connection
    if (!this.ws && !this.manualClose) {
      this.connect();
    }

    return sub;
  }

  // ─── Close ───────────────────────────────────────────────────────────────

  /**
   * Close the WebSocket connection and clean up all state.
   */
  close(): void {
    this.manualClose = true;
    this.clearReconnect();
    this.stopKeepalive();

    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.close(1000, 'client disconnect');
      this.ws = null;
    }

    this.emit('disconnected', 1000, 'client disconnect');
  }

  // ─── Internal: WebSocket Lifecycle ───────────────────────────────────────

  private connect(): void {
    const Ctor = this.resolveWebSocket();

    let ws: WebSocketLike;
    try {
      ws = new (Ctor as new (url: string) => WebSocketLike)(this.wsUrl);
    } catch (err) {
      this.emit('error', new ConnectionError(`Failed to create WebSocket: ${err}`));
      this.scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      this.ws = ws;
      this.reconnectAttempt = 0;
      this.startKeepalive();
      this.emit('connected');
      this.protocol.reset();
      this.sendCurrentSubscription();
    };

    ws.onmessage = (ev) => {
      const raw = typeof ev.data === 'string' ? ev.data : String(ev.data);
      this.handleMessage(raw);
    };

    ws.onclose = (ev) => {
      this.ws = null;
      this.stopKeepalive();
      this.emit('disconnected', ev.code, ev.reason);
      if (!this.manualClose && this.reconnectOpts.enabled) {
        this.scheduleReconnect();
      }
    };

    ws.onerror = () => {
      // onclose will fire after onerror
    };
  }

  private resolveWebSocket(): unknown {
    if (this.WebSocketCtor) return this.WebSocketCtor;
    if (typeof globalThis !== 'undefined' && globalThis.WebSocket) return globalThis.WebSocket;
    return WebSocketImpl;
  }

  private handleMessage(raw: string): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(raw) as ServerMessage;
    } catch {
      this.emit('error', new ProtocolError(`Failed to parse: ${raw.slice(0, 200)}`));
      return;
    }

    this.emit('debug', msg.type, raw.length > 500 ? raw.slice(0, 500) + '...' : raw);

    switch (msg.type) {
      case 'event':
        this.router.route(msg.data);
        break;
      case 'pong':
        this.awaitingPong = false;
        if (this.pongTimer) {
          clearTimeout(this.pongTimer);
          this.pongTimer = null;
        }
        break;
      case 'error':
        this.emit('error', new ServerError(msg.message));
        break;
    }
  }

  // ─── Internal: Subscription Management ───────────────────────────────────

  private rebuildSubscription(): void {
    this.scheduleSend();
  }

  private scheduleSend(): void {
    if (this.pendingSend) return;
    this.pendingSend = true;
    queueMicrotask(() => {
      this.pendingSend = false;
      this.flushSubscription();
    });
  }

  private flushSubscription(): void {
    for (const [, sub] of this.subscriptions) {
      if (!sub.callback && sub.handlers.size === 0) {
        this.router.unregister(sub.id);
      } else {
        this.router.register(sub);
      }
    }
    this.sendCurrentSubscription();
  }

  private sendCurrentSubscription(): void {
    if (!this.ws || this.ws.readyState !== 1) return;
    if (this.subscriptions.size === 0) {
      this.sendRaw(JSON.stringify({ action: 'unsubscribe' }));
      this.protocol.reset();
      return;
    }

    const messages = this.protocol.computeMessages(this.subscriptions);
    for (const msg of messages) {
      const payload = JSON.stringify(msg);
      this.emit('debug', `${msg.action}_sent`, payload.length > 1000 ? payload.slice(0, 1000) + '...' : payload);
      this.sendRaw(payload);
    }
  }

  private sendRaw(data: string): void {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(data);
    }
  }

  // ─── Internal: Reconnect ─────────────────────────────────────────────────

  private scheduleReconnect(): void {
    this.reconnectAttempt++;
    if (this.reconnectAttempt > this.reconnectOpts.maxAttempts) {
      this.emit(
        'error',
        new ReconnectError(
          `Max reconnect attempts (${this.reconnectOpts.maxAttempts}) exceeded`,
          this.reconnectAttempt,
        ),
      );
      return;
    }

    const { baseDelay, maxDelay, jitter } = this.reconnectOpts;
    let delay = baseDelay * Math.pow(2, this.reconnectAttempt - 1);
    delay = Math.min(delay, maxDelay);
    if (jitter > 0) {
      delay += delay * jitter * (Math.random() * 2 - 1);
      delay = Math.max(0, delay);
    }

    this.emit('reconnecting', this.reconnectAttempt, Math.round(delay));

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // ─── Internal: Keepalive ─────────────────────────────────────────────────

  private startKeepalive(): void {
    this.stopKeepalive();
    this.pingTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== 1) return;
      this.awaitingPong = true;
      this.sendRaw(JSON.stringify({ action: 'ping' }));

      this.pongTimer = setTimeout(() => {
        if (this.awaitingPong) {
          this.emit('error', new ConnectionError('Pong timeout'));
          this.ws?.close(4000, 'pong timeout');
        }
      }, this.keepaliveOpts.timeout);
    }, this.keepaliveOpts.interval);
  }

  private stopKeepalive(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
    this.awaitingPong = false;
  }
}
