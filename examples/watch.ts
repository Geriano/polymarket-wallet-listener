/**
 * Watch a wallet's trades on a specific market.
 *
 * Usage:
 *   npm run example:watch -- <wallet> <slug>
 *
 * Example:
 *   npm run example:watch -- 0x25d76e8eaF02494c31Cda797E58364874e598333 btc-updown-5m-17xx91
 */

import { Watcher, deriveProxyAddress } from '../src/index.js';
import type { WatcherEvent } from '../src/index.js';

const WS_URL = 'ws://5.223.66.160:3001/ws';
const GAMMA_URL = 'https://gamma-api.polymarket.com';

const DEBUG = process.env.DEBUG === '1' || process.env.DEBUG === 'true';

function debug(...args: unknown[]): void {
  if (DEBUG) console.log('[debug]', ...args);
}

const wallet = process.argv[2];
const slug = process.argv[3];

if (!wallet || !slug) {
  console.error('Usage: npm run example:watch -- <wallet> <slug>');
  console.error('  Set DEBUG=1 for verbose logging');
  process.exit(1);
}

async function main() {
  const proxy = deriveProxyAddress(wallet);

  console.log('=== Polymarket Wallet Watcher ===\n');
  console.log(`Wallet:  ${wallet}`);
  console.log(`Proxy:   ${proxy}`);
  console.log(`Slug:    ${slug}`);
  console.log(`WS:      ${WS_URL}`);
  console.log(`Debug:   ${DEBUG ? 'ON' : 'OFF (set DEBUG=1 to enable)'}\n`);

  debug('Creating watcher with options:', { wsUrl: WS_URL, gammaUrl: GAMMA_URL });

  const watcher = new Watcher({
    wsUrl: WS_URL,
    gammaUrl: GAMMA_URL,
  });

  // Lifecycle events
  watcher.on('connected', () => {
    console.log('[lifecycle] connected to upstream\n');
    debug('WebSocket readyState: OPEN');
  });

  watcher.on('disconnected', (code, reason) => {
    console.log(`[lifecycle] disconnected: ${code} ${reason}`);
    debug('WebSocket closed with code', code, 'reason:', reason);
  });

  watcher.on('reconnecting', (attempt, delay) => {
    console.log(`[lifecycle] reconnecting attempt #${attempt} in ${delay}ms`);
    debug('Reconnect scheduled:', { attempt, delay });
  });

  watcher.on('error', (err) => {
    console.error(`[error] ${err.message}`);
    debug('Error details:', err);
  });

  // @ts-ignore — debug is an internal event
  watcher.on('debug', (label: string, data: string) => {
    debug(`[ws:${label}]`, data);
  });

  // Fetch outcomes
  debug('Fetching outcomes from Gamma API:', `${GAMMA_URL}/markets/slug/${slug}`);
  console.log('Fetching outcomes...');
  const outcomes = await watcher.outcomes(slug);

  debug('Raw outcomes received:', JSON.stringify(outcomes, null, 2));
  console.log('\nOutcomes:');
  console.table(outcomes.map((o) => ({ name: o.name, price: o.price, id: o.id.slice(0, 20) + '...' })));

  // Subscribe to all outcomes, all sides, all event types
  const subscribeOpts = {
    outcomes: outcomes.map((o) => ({ ...o })),
    events: ['trade', 'split', 'merge', 'redeem'] as const,
  };
  debug('Subscribing with options:', JSON.stringify(subscribeOpts, null, 2));

  const sub = watcher.subscribe(wallet, {
    outcomes: outcomes.map((o) => ({ ...o })),
    events: ['trade', 'split', 'merge', 'redeem'],
    skipProxy: true,
  });

  debug('Subscription created:', {
    id: sub.id,
    wallets: sub.wallets,
    proxyWallets: sub.proxyWallets,
  });

  sub.watch((event: WatcherEvent) => {
    debug('Raw event received:', JSON.stringify(event.raw, null, 2));
    const ts = new Date(event.timestamp).toISOString();

    switch (event.type) {
      case 'trade':
        console.log(
          `[${ts}] TRADE | ${event.side.padEnd(4)} | ${event.outcome.name.padEnd(10)} | ` +
            `$${event.size.toFixed(2).padStart(10)} | price ${event.price.toFixed(4)} | ` +
            `tx ${event.tx.slice(0, 10)}...`,
        );
        break;

      case 'split':
        console.log(
          `[${ts}] SPLIT | $${event.amount.toFixed(2).padStart(10)} | ` +
            `condition ${event.conditionId.slice(0, 10)}... | tx ${event.tx.slice(0, 10)}...`,
        );
        break;

      case 'merge':
        console.log(
          `[${ts}] MERGE | $${event.amount.toFixed(2).padStart(10)} | ` +
            `condition ${event.conditionId.slice(0, 10)}... | tx ${event.tx.slice(0, 10)}...`,
        );
        break;

      case 'redeem':
        console.log(
          `[${ts}] REDEEM | $${event.payout.toFixed(2).padStart(10)} | ` +
            `condition ${event.conditionId.slice(0, 10)}... | tx ${event.tx.slice(0, 10)}...`,
        );
        break;
    }
  });

  console.log('\nWatching... (Ctrl+C to stop)\n');

  // Clean shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    sub.unwatch();
    watcher.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
