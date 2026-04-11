/**
 * Watch all markets and outcomes for a wallet using typed callbacks.
 *
 * Usage:
 *   npm run example:watch -- <wallet>
 *
 * Example:
 *   npm run example:watch -- 0x25d76e8eaF02494c31Cda797E58364874e598333
 */

import { Watcher, deriveProxyAddress } from '../src/index.js';

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

  const watcher = new Watcher({ wsUrl: WS_URL });

  // Lifecycle events
  watcher.on('connected', () => console.log('[lifecycle] connected\n'));
  watcher.on('disconnected', (code, reason) => console.log(`[lifecycle] disconnected: ${code} ${reason}`));
  watcher.on('reconnecting', (attempt, delay) => console.log(`[lifecycle] reconnecting #${attempt} in ${delay}ms`));
  watcher.on('error', (err) => console.error(`[error] ${err.message}`));
  watcher.on('debug', (label: string, data: string) => debug(`[ws:${label}]`, data));

  // Subscribe — no events: [...] needed, typed callbacks auto-subscribe
  const sub = watcher.subscribe(wallet, { skipProxy: true });

  debug('Subscription created:', { id: sub.id, wallets: sub.wallets });

  // ─── Typed callbacks (each narrows the event type) ──────────────────────

  sub.traded(async (event) => {
    const ts = new Date(event.timestamp).toISOString();
    const label = event.side === 'Buy' ? 'BUY ' : 'SELL';
    const price = event.side === 'Buy' ? event.buyPrice : event.sellPrice;
    console.log(
      `[${ts}] ${label} | ${event.market} | ${event.outcome.name.padEnd(10)} | ` +
        `$${event.size.toFixed(2).padStart(10)} | ` +
        `price ${price.toFixed(4)} | ` +
        `bid ${event.clob?.best_bid ?? 'n/a'} ask ${event.clob?.best_ask ?? 'n/a'} | ` +
        `${event.negRisk ? 'NEG_RISK' : ''} ${event.normalized ? 'NORM' : ''} | tx ${event.tx.slice(0, 10)}...`,
    );
  });

  sub.redeemed(async (event) => {
    const ts = new Date(event.timestamp).toISOString();
    const slug = event.gamma?.slug ?? '';
    console.log(
      `[${ts}] REDEEM | ${slug} | $${event.payout.toFixed(2).padStart(10)} | ` +
        `condition ${event.conditionId.slice(0, 10)}... | tx ${event.tx.slice(0, 10)}...`,
    );
  });

  sub.splitted(async (event) => {
    const ts = new Date(event.timestamp).toISOString();
    const slug = event.gamma?.slug ?? '';
    console.log(
      `[${ts}] SPLIT | ${slug} | $${event.amount.toFixed(2).padStart(10)} | ` +
        `condition ${event.conditionId.slice(0, 10)}... | tx ${event.tx.slice(0, 10)}...`,
    );
  });

  sub.merged(async (event) => {
    const ts = new Date(event.timestamp).toISOString();
    const slug = event.gamma?.slug ?? '';
    console.log(
      `[${ts}] MERGE | ${slug} | $${event.amount.toFixed(2).padStart(10)} | ` +
        `condition ${event.conditionId.slice(0, 10)}... | tx ${event.tx.slice(0, 10)}...`,
    );
  });

  sub.resolved(async (event) => {
    const ts = new Date(event.timestamp).toISOString();
    console.log(
      `[${ts}] RESOLVE | ${event.gamma?.question ?? 'unknown'} | ` +
        `payouts [${event.payoutNumerators.join(',')}] | ` +
        `condition ${event.conditionId.slice(0, 10)}... | tx ${event.tx.slice(0, 10)}...`,
    );
  });

  // Disposer pattern — can call offConvert() to stop listening
  const offConvert = sub.converted(async (event) => {
    const ts = new Date(event.timestamp).toISOString();
    const slug = event.gamma?.slug ?? '';
    console.log(
      `[${ts}] CONVERT | ${slug} | $${event.amount.toFixed(2).padStart(10)} | ` +
        `market ${event.marketId.slice(0, 10)}... | tx ${event.tx.slice(0, 10)}...`,
    );
  });

  // Keep offConvert in scope for clean shutdown
  void offConvert;

  console.log('\nWatching all markets... (Ctrl+C to stop)\n');

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
