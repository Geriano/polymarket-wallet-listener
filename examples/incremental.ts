/**
 * Demonstrates incremental subscriptions using extend/exclude protocol
 * and typed callback methods with disposers.
 *
 * Usage:
 *   npm run example:incremental -- <wallet1> <wallet2> [wallet3...]
 *
 * Example:
 *   npm run example:incremental -- 0xAlice 0xBob 0xCharlie
 *
 * What happens:
 *   1. Subscribes to wallet1 with bought/sold handlers (sends 'subscribe')
 *   2. After 5s, adds wallet2 with merge/split handlers (sends 'extend' — delta only)
 *   3. After 10s, adds wallet3 with resolved handler (sends 'extend')
 *   4. After 15s, disposes wallet3's resolved handler (sends 'exclude' for condition_resolution)
 *   5. After 20s, unwatches wallet2 (sends 'subscribe' rebuild since partial removal)
 *
 * Set DEBUG=1 to see the wire messages (subscribe_sent / extend_sent / exclude_sent).
 */

import { Watcher, deriveProxyAddress } from '../src/index.js';

const WS_URL = process.env.WS_URL || 'ws://localhost:3001/ws';

const DEBUG = process.env.DEBUG === '1' || process.env.DEBUG === 'true';

function debug(...args: unknown[]): void {
  if (DEBUG) console.log('[debug]', ...args);
}

const wallets = process.argv.slice(2);

if (wallets.length < 2) {
  console.error('Usage: npm run example:incremental -- <wallet1> <wallet2> [wallet3...]');
  console.error('  Provide at least 2 wallets. Set DEBUG=1 to see wire protocol messages.');
  process.exit(1);
}

function shortAddr(addr: string): string {
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

async function main() {
  console.log('=== Incremental Subscription Demo ===\n');
  console.log(`Wallets: ${wallets.length}`);
  for (const w of wallets) {
    const proxy = deriveProxyAddress(w);
    console.log(`  - ${shortAddr(w)} (proxy: ${shortAddr(proxy)})`);
  }
  console.log(`WS:      ${WS_URL}`);
  console.log(`Debug:   ${DEBUG ? 'ON' : 'OFF (set DEBUG=1 to see wire messages)'}\n`);

  const watcher = new Watcher({ wsUrl: WS_URL });

  watcher.on('connected', () => console.log('[lifecycle] connected\n'));
  watcher.on('disconnected', (code, reason) => console.log(`[lifecycle] disconnected: ${code} ${reason}`));
  watcher.on('reconnecting', (attempt, delay) => console.log(`[lifecycle] reconnecting #${attempt} in ${delay}ms`));
  watcher.on('error', (err) => console.error(`[error] ${err.message}`));
  watcher.on('debug', (label: string, data: string) => debug(`[ws:${label}]`, data));

  // ─── Step 1: Subscribe wallet1 with bought/sold (triggers connect + subscribe) ──

  console.log(`[0s] Subscribing ${shortAddr(wallets[0])} with bought/sold handlers...`);
  const sub1 = watcher.subscribe(wallets[0], { skipProxy: true });

  sub1.traded(async (event) => {
    const ts = new Date(event.timestamp).toISOString();
    const label = event.side === 'Buy' ? 'BUY ' : 'SELL';
    const price = event.side === 'Buy' ? event.buyPrice : event.sellPrice;
    console.log(
      `  [${ts}] ${shortAddr(event.wallet)} ${label} | ${event.outcome.name.padEnd(10)} | ` +
        `$${event.size.toFixed(2).padStart(10)} | price ${price.toFixed(4)}`,
    );
  });

  sub1.redeemed(async (event) => {
    const ts = new Date(event.timestamp).toISOString();
    console.log(
      `  [${ts}] ${shortAddr(event.wallet)} REDEEM | ` +
        `$${event.payout.toFixed(2).padStart(10)} | condition ${event.conditionId.slice(0, 10)}...`,
    );
  });

  // ─── Step 2: After 5s, add wallet2 with split/merge (sends extend) ──────────

  setTimeout(() => {
    console.log(`\n[5s] Adding ${shortAddr(wallets[1])} with split/merge handlers (expect extend_sent)...`);
    const sub2 = watcher.subscribe(wallets[1], { skipProxy: true });

    sub2.splitted(async (event) => {
      const ts = new Date(event.timestamp).toISOString();
      console.log(
        `  [${ts}] ${shortAddr(event.wallet)} SPLIT | $${event.amount.toFixed(2).padStart(10)} | ` +
          `condition ${event.conditionId.slice(0, 10)}...`,
      );
    });

    sub2.merged(async (event) => {
      const ts = new Date(event.timestamp).toISOString();
      console.log(
        `  [${ts}] ${shortAddr(event.wallet)} MERGE | $${event.amount.toFixed(2).padStart(10)} | ` +
          `condition ${event.conditionId.slice(0, 10)}...`,
      );
    });

    // ─── Step 3: After 10s, add wallet3 with resolved (sends extend) ────────

    if (wallets.length >= 3) {
      setTimeout(() => {
        console.log(`\n[10s] Adding ${shortAddr(wallets[2])} with resolved handler (expect extend_sent)...`);
        const sub3 = watcher.subscribe(wallets[2], { skipProxy: true });

        const offResolved = sub3.resolved(async (event) => {
          const ts = new Date(event.timestamp).toISOString();
          console.log(
            `  [${ts}] RESOLVE | ${event.gamma?.question ?? 'unknown'} | ` +
              `payouts [${event.payoutNumerators.join(',')}]`,
          );
        });

        // ─── Step 4: After 15s, dispose resolved handler (sends exclude) ──

        setTimeout(() => {
          console.log(`\n[15s] Disposing resolved handler for ${shortAddr(wallets[2])} (expect exclude_sent)...`);
          offResolved();
        }, 5_000);
      }, 5_000);
    }

  }, 5_000);

  console.log('\nWatching... (Ctrl+C to stop)\n');

  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    watcher.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
