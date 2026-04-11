/**
 * Watch multiple wallets for trade, split, merge, and redeem events on all markets.
 * Demonstrates typed callbacks with multi-wallet subscriptions.
 *
 * Usage:
 *   npm run example:multiple -- <wallet1> <wallet2> [walletN...]
 *
 * Example:
 *   npm run example:multiple -- 0xWallet1 0xWallet2
 *   DEBUG=1 npm run example:multiple -- 0xWallet1 0xWallet2 0xWallet3
 */

import { Watcher } from '../src/index.js';

const WS_URL = process.env.WS_URL || 'ws://localhost:3001/ws';

const DEBUG = process.env.DEBUG === '1' || process.env.DEBUG === 'true';

function debug(...args: unknown[]): void {
  if (DEBUG) console.log('[debug]', ...args);
}

const wallets = process.argv.slice(2);

if (wallets.length < 1) {
  console.error('Usage: npm run example:multiple -- <wallet1> <wallet2> [walletN...]');
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
  console.log(`WS:      ${WS_URL}`);
  console.log(`Debug:   ${DEBUG ? 'ON' : 'OFF (set DEBUG=1 to enable)'}\n`);

  const watcher = new Watcher({ wsUrl: WS_URL });

  watcher.on('connected', () => console.log('[lifecycle] connected\n'));
  watcher.on('disconnected', (code, reason) => console.log(`[lifecycle] disconnected: ${code} ${reason}`));
  watcher.on('reconnecting', (attempt, delay) => console.log(`[lifecycle] reconnecting #${attempt} in ${delay}ms`));
  watcher.on('error', (err) => console.error(`[error] ${err.message}`));
  watcher.on('debug', (label: string, data: string) => debug(`[ws:${label}]`, data));

  const sub = watcher.subscribe(wallets, { skipProxy: true });

  debug('Subscription created:', { id: sub.id, wallets: sub.wallets });

  // ─── Typed callbacks — auto-subscribe to trade, split, merge, redeem ───

  sub.traded(async (event) => {
    const ts = new Date(event.timestamp).toISOString();
    const w = shortAddr(event.wallet);
    const label = event.side === 'Buy' ? 'BUY ' : 'SELL';
    const price = event.side === 'Buy' ? event.buyPrice : event.sellPrice;
    console.log(
      `[${ts}] ${label} | ${w} | ${event.market} | ${event.outcome.name.padEnd(10)} | ` +
        `$${event.size.toFixed(2).padStart(10)} | ` +
        `price ${price.toFixed(4)} | ` +
        `bid ${event.clob?.best_bid ?? 'n/a'} ask ${event.clob?.best_ask ?? 'n/a'} | ` +
        `tx ${event.tx.slice(0, 10)}...`,
    );
  });

  sub.redeemed(async (event) => {
    const ts = new Date(event.timestamp).toISOString();
    const w = shortAddr(event.wallet);
    console.log(
      `[${ts}] REDEEM | ${w} | $${event.payout.toFixed(2).padStart(10)} | ` +
        `condition ${event.conditionId.slice(0, 10)}... | tx ${event.tx.slice(0, 10)}...`,
    );
  });

  sub.splitted(async (event) => {
    const ts = new Date(event.timestamp).toISOString();
    const w = shortAddr(event.wallet);
    console.log(
      `[${ts}] SPLIT | ${w} | $${event.amount.toFixed(2).padStart(10)} | ` +
        `condition ${event.conditionId.slice(0, 10)}... | tx ${event.tx.slice(0, 10)}...`,
    );
  });

  sub.merged(async (event) => {
    const ts = new Date(event.timestamp).toISOString();
    const w = shortAddr(event.wallet);
    console.log(
      `[${ts}] MERGE | ${w} | $${event.amount.toFixed(2).padStart(10)} | ` +
        `condition ${event.conditionId.slice(0, 10)}... | tx ${event.tx.slice(0, 10)}...`,
    );
  });

  console.log(`\nWatching ${wallets.length} wallets on all markets... (Ctrl+C to stop)\n`);

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
