import type { OutcomeInfo } from './types.js';

/**
 * Client for the Gamma REST API.
 *
 * @deprecated Since server v0.3.0, market metadata is provided automatically via
 * server-side enrichment (the `gamma` field on events). This client is only
 * needed for explicit slug-based lookups via `watcher.outcomes(slug)`.
 */
export class GammaClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async fetchOutcomes(slug: string): Promise<OutcomeInfo[]> {
    const url = `${this.baseUrl}/markets/slug/${encodeURIComponent(slug)}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Gamma API error: ${response.status} ${response.statusText} for slug "${slug}"`);
    }

    const market = await response.json();

    const outcomes: string[] =
      typeof market.outcomes === 'string' ? JSON.parse(market.outcomes) : market.outcomes ?? [];
    const prices: string[] =
      typeof market.outcomePrices === 'string'
        ? JSON.parse(market.outcomePrices)
        : market.outcomePrices ?? [];
    const tokenIds: string[] =
      typeof market.clobTokenIds === 'string'
        ? JSON.parse(market.clobTokenIds)
        : market.clobTokenIds ?? [];

    return outcomes.map((name: string, i: number) => ({
      id: tokenIds[i] ?? '',
      name,
      price: prices[i] ?? '0',
    }));
  }
}
