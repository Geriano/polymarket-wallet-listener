/**
 * Watch multiple wallets for trade, split, and merge events on a specific market.
 *
 * Usage:
 *   npm run example:multiple -- <wallet1> <wallet2> [walletN...] <slug>
 *
 * Example:
 *   npm run example:multiple -- 0xWallet1 0xWallet2 btc-updown-5m-1774601100
 *   DEBUG=1 npm run example:multiple -- 0xWallet1 0xWallet2 0xWallet3 btc-updown-5m-1774601100
 */

import { Watcher } from '../src/index.js';
import type { WatcherEvent } from '../src/index.js';

const WS_URL = 'ws://5.223.66.160:3001/ws';
const GAMMA_URL = 'https://gamma-api.polymarket.com';

const DEBUG = process.env.DEBUG === '1' || process.env.DEBUG === 'true';

function debug(...args: unknown[]): void {
  if (DEBUG) console.log('[debug]', ...args);
}

// Last arg is slug, everything before is a wallet address
const args = process.argv.slice(2);
const slug = args.pop();
const wallets = args;

if (wallets.length < 1 || !slug) {
  console.error('Usage: npm run example:multiple -- <wallet1> <wallet2> [walletN...] <slug>');
  console.error('  Set DEBUG=1 for verbose logging');
  process.exit(1);
}

function shortAddr(addr: string): string {
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

async function main() {
  console.log('=== Polymarket Multi-Wallet Watcher ===\n');
  console.log(`Wallets: ${wallets.length}`);
  for (const w of wallets) {
    console.log(`  - ${w}`);
  }
  console.log(`Slug:    ${slug}`);
  console.log(`Events:  trade, split, merge`);
  console.log(`WS:      ${WS_URL}`);
  console.log(`Debug:   ${DEBUG ? 'ON' : 'OFF (set DEBUG=1 to enable)'}\n`);

  const watcher = new Watcher({
    wsUrl: WS_URL,
    gammaUrl: GAMMA_URL,
  });

  watcher.on('connected', () => {
    console.log('[lifecycle] connected to upstream\n');
  });

  watcher.on('disconnected', (code, reason) => {
    console.log(`[lifecycle] disconnected: ${code} ${reason}`);
  });

  watcher.on('reconnecting', (attempt, delay) => {
    console.log(`[lifecycle] reconnecting attempt #${attempt} in ${delay}ms`);
  });

  watcher.on('error', (err) => {
    console.error(`[error] ${err.message}`);
    debug('Error details:', err);
  });

  watcher.on('debug', (label: string, data: string) => {
    debug(`[ws:${label}]`, data);
  });

  console.log('Fetching outcomes...');
  const outcomes = await watcher.outcomes(slug!);

  console.log('\nOutcomes:');
  console.table(outcomes.map((o) => ({ name: o.name, price: o.price, id: o.id.slice(0, 20) + '...' })));

  const sub = watcher.subscribe(wallets, {
    outcomes: outcomes.map((o) => ({ ...o })),
    events: ['trade', 'split', 'merge'],
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
    const w = shortAddr(event.wallet);

    switch (event.type) {
      case 'trade':
        console.log(
          `[${ts}] TRADE | ${w} | ${event.side.padEnd(4)} | ${event.outcome.name.padEnd(10)} | ` +
            `$${event.size.toFixed(2).padStart(10)} | price ${event.price.toFixed(4)} | ` +
            `tx ${event.tx.slice(0, 10)}...`,
        );
        break;

      case 'split':
        console.log(
          `[${ts}] SPLIT | ${w} | $${event.amount.toFixed(2).padStart(10)} | ` +
            `condition ${event.conditionId.slice(0, 10)}... | tx ${event.tx.slice(0, 10)}...`,
        );
        break;

      case 'merge':
        console.log(
          `[${ts}] MERGE | ${w} | $${event.amount.toFixed(2).padStart(10)} | ` +
            `condition ${event.conditionId.slice(0, 10)}... | tx ${event.tx.slice(0, 10)}...`,
        );
        break;
    }
  });

  console.log(`\nWatching ${wallets.length} wallets... (Ctrl+C to stop)\n`);

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
