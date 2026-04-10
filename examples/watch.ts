/**
 * Watch all markets and outcomes for a wallet.
 *
 * Usage:
 *   npm run example:watch -- <wallet>
 *
 * Example:
 *   npm run example:watch -- 0x25d76e8eaF02494c31Cda797E58364874e598333
 */

import { Watcher, deriveProxyAddress } from '../src/index.js';
import type { WatcherEvent } from '../src/index.js';

const WS_URL = process.env.WS_URL || 'ws://localhost:3001/ws';

const DEBUG = process.env.DEBUG === '1' || process.env.DEBUG === 'true';

function debug(...args: unknown[]): void {
  if (DEBUG) console.log('[debug]', ...args);
}

const wallet = process.argv[2];

if (!wallet) {
  console.error('Usage: npm run example:watch -- <wallet>');
  console.error('  Set DEBUG=1 for verbose logging');
  process.exit(1);
}

async function main() {
  const proxy = deriveProxyAddress(wallet);

  console.log('=== Polymarket Wallet Watcher ===\n');
  console.log(`Wallet:  ${wallet}`);
  console.log(`Proxy:   ${proxy}`);
  console.log(`WS:      ${WS_URL}`);
  console.log(`Debug:   ${DEBUG ? 'ON' : 'OFF (set DEBUG=1 to enable)'}\n`);

  debug('Creating watcher with options:', { wsUrl: WS_URL });

  // No gammaUrl needed — server provides enrichment via gamma/clob fields
  const watcher = new Watcher({ wsUrl: WS_URL });

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

  watcher.on('debug', (label: string, data: string) => {
    debug(`[ws:${label}]`, data);
  });

  // Subscribe to all markets, all outcomes, all event types
  const sub = watcher.subscribe(wallet, {
    events: ['trade', 'split', 'merge', 'redeem', 'convert', 'resolve'],
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
    const slug = event.gamma?.slug ?? '';

    switch (event.type) {
      case 'trade':
        console.log(
          `[${ts}] TRADE | ${event.market} | ${event.side.padEnd(4)} | ${event.outcome.name.padEnd(10)} | ` +
            `$${event.size.toFixed(2).padStart(10)} | price ${event.price.toFixed(4)} | ` +
            `bid ${event.clob?.best_bid ?? 'n/a'} ask ${event.clob?.best_ask ?? 'n/a'} | ` +
            `tx ${event.tx.slice(0, 10)}...`,
        );
        break;

      case 'split':
        console.log(
          `[${ts}] SPLIT | ${slug} | $${event.amount.toFixed(2).padStart(10)} | ` +
            `condition ${event.conditionId.slice(0, 10)}... | tx ${event.tx.slice(0, 10)}...`,
        );
        break;

      case 'merge':
        console.log(
          `[${ts}] MERGE | ${slug} | $${event.amount.toFixed(2).padStart(10)} | ` +
            `condition ${event.conditionId.slice(0, 10)}... | tx ${event.tx.slice(0, 10)}...`,
        );
        break;

      case 'redeem':
        console.log(
          `[${ts}] REDEEM | ${slug} | $${event.payout.toFixed(2).padStart(10)} | ` +
            `condition ${event.conditionId.slice(0, 10)}... | tx ${event.tx.slice(0, 10)}...`,
        );
        break;

      case 'convert':
        console.log(
          `[${ts}] CONVERT | ${slug} | $${event.amount.toFixed(2).padStart(10)} | ` +
            `market ${event.marketId.slice(0, 10)}... | tx ${event.tx.slice(0, 10)}...`,
        );
        break;

      case 'resolve':
        console.log(
          `[${ts}] RESOLVE | ${event.gamma?.question ?? 'unknown'} | ` +
            `payouts [${event.payoutNumerators.join(',')}] | ` +
            `condition ${event.conditionId.slice(0, 10)}... | tx ${event.tx.slice(0, 10)}...`,
        );
        break;

      default:
        console.log(`[${ts}] ${event.type.toUpperCase()} | tx ${event.tx.slice(0, 10)}...`);
        break;
    }
  });

  console.log('\nWatching all markets... (Ctrl+C to stop)\n');

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
