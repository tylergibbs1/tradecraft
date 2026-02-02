/**
 * SEC EDGAR Data Provider
 *
 * Fetches 10-K, 10-Q, 8-K filings and company facts from SEC EDGAR.
 * Uses the free SEC EDGAR API (no authentication required).
 *
 * Rate limit: 10 requests per second (SEC requirement)
 * User-Agent must identify the requester (SEC requirement)
 */

import { FilingMetadata, FinancialMetrics } from '../../agents/types.js';

const EDGAR_BASE_URL = 'https://data.sec.gov';
const EDGAR_FULL_TEXT_URL = 'https://www.sec.gov/Archives/edgar/data';

// SEC requires identifying User-Agent
const USER_AGENT = 'Tradecraft/1.0 (contact@tradecraft.dev)';

// Rate limiting - SEC allows 10 req/sec
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 100; // 100ms = 10 req/sec

async function rateLimitedFetch(url: string): Promise<Response> {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;

  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    await new Promise(resolve =>
      setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLastRequest)
    );
  }

  lastRequestTime = Date.now();

  return fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
    },
  });
}

// CIK (Central Index Key) to ticker mapping cache
const cikCache = new Map<string, string>();

interface CompanyTickerEntry {
  cik_str: number;
  ticker: string;
  title: string;
}

interface EdgarFilingEntry {
  accessionNumber: string;
  filingDate: string;
  reportDate: string;
  form: string;
  primaryDocument: string;
  primaryDocDescription: string;
}

interface EdgarFilingsResponse {
  cik: string;
  filings: {
    recent: {
      accessionNumber: string[];
      filingDate: string[];
      reportDate: string[];
      form: string[];
      primaryDocument: string[];
      primaryDocDescription: string[];
    };
  };
}

interface CompanyFactsResponse {
  cik: number;
  entityName: string;
  facts: {
    'us-gaap'?: Record<string, {
      label: string;
      description: string;
      units: Record<string, Array<{
        val: number;
        accn: string;
        fy: number;
        fp: string;
        form: string;
        filed: string;
        start?: string;
        end: string;
      }>>;
    }>;
    dei?: Record<string, unknown>;
  };
}

export class EdgarDataProvider {
  name = 'SEC EDGAR';

  /**
   * Get CIK (Central Index Key) for a ticker symbol
   */
  async getCik(symbol: string): Promise<string> {
    const upperSymbol = symbol.toUpperCase();

    // Check cache
    if (cikCache.has(upperSymbol)) {
      return cikCache.get(upperSymbol)!;
    }

    // Fetch company tickers list
    const response = await rateLimitedFetch(
      `${EDGAR_BASE_URL}/submissions/company_tickers.json`
    );

    if (!response.ok) {
      throw new Error(`EDGAR API error: ${response.status}`);
    }

    const data = (await response.json()) as Record<string, CompanyTickerEntry>;

    // Build cache and find our ticker
    for (const entry of Object.values(data)) {
      const ticker = entry.ticker.toUpperCase();
      const cik = entry.cik_str.toString().padStart(10, '0');
      cikCache.set(ticker, cik);
    }

    const cik = cikCache.get(upperSymbol);
    if (!cik) {
      throw new Error(`CIK not found for symbol: ${symbol}`);
    }

    return cik;
  }

  /**
   * Get recent filings for a company
   */
  async getFilings(
    symbol: string,
    formTypes?: string[], // e.g., ['10-K', '10-Q', '8-K']
    limit: number = 20
  ): Promise<FilingMetadata[]> {
    const cik = await this.getCik(symbol);

    const response = await rateLimitedFetch(
      `${EDGAR_BASE_URL}/submissions/CIK${cik}.json`
    );

    if (!response.ok) {
      throw new Error(`EDGAR API error: ${response.status}`);
    }

    const data = (await response.json()) as EdgarFilingsResponse;
    const recent = data.filings.recent;

    const filings: FilingMetadata[] = [];

    for (let i = 0; i < recent.accessionNumber.length && filings.length < limit; i++) {
      const form = recent.form[i] || '';

      // Filter by form type if specified
      if (formTypes && formTypes.length > 0) {
        if (!formTypes.some(ft => form.includes(ft))) {
          continue;
        }
      }

      const accessionNumber = (recent.accessionNumber[i] || '').replace(/-/g, '');
      const cikNum = cik.replace(/^0+/, '');

      filings.push({
        form,
        filedAt: recent.filingDate[i] || '',
        periodEnd: recent.reportDate[i],
        url: `${EDGAR_FULL_TEXT_URL}/${cikNum}/${accessionNumber}/${recent.primaryDocument[i] || ''}`,
        description: recent.primaryDocDescription[i],
      });
    }

    return filings;
  }

  /**
   * Get the text content of a specific filing
   */
  async getFilingText(
    symbol: string,
    formType: string = '10-K',
    index: number = 0 // 0 = most recent
  ): Promise<{ filing: FilingMetadata; text: string }> {
    const filings = await this.getFilings(symbol, [formType], index + 1);

    if (filings.length <= index) {
      throw new Error(`No ${formType} filing found at index ${index} for ${symbol}`);
    }

    const filing = filings[index]!;

    // Fetch the filing document
    const response = await rateLimitedFetch(filing.url);

    if (!response.ok) {
      throw new Error(`Failed to fetch filing: ${response.status}`);
    }

    let text = await response.text();

    // If HTML, strip tags for cleaner text
    if (text.includes('<html') || text.includes('<HTML')) {
      text = this.stripHtml(text);
    }

    // Truncate to reasonable size (Claude context limits)
    const maxLength = 100000; // ~25k tokens
    if (text.length > maxLength) {
      text = text.slice(0, maxLength) + '\n\n[TRUNCATED - Filing exceeds size limit]';
    }

    return { filing, text };
  }

  /**
   * Get key financial facts from company facts API
   */
  async getFinancialFacts(symbol: string): Promise<FinancialMetrics | null> {
    const cik = await this.getCik(symbol);

    const response = await rateLimitedFetch(
      `${EDGAR_BASE_URL}/api/xbrl/companyfacts/CIK${cik}.json`
    );

    if (!response.ok) {
      if (response.status === 404) {
        return null; // No XBRL data available
      }
      throw new Error(`EDGAR API error: ${response.status}`);
    }

    const data = (await response.json()) as CompanyFactsResponse;
    const gaap = data.facts['us-gaap'];

    if (!gaap) {
      return null;
    }

    // Extract most recent annual values
    const getLatestAnnual = (concept: string): number | undefined => {
      const fact = gaap[concept];
      if (!fact) return undefined;

      const units = fact.units.USD || fact.units.shares || Object.values(fact.units)[0];
      if (!units) return undefined;

      // Find most recent 10-K value
      const annual = units
        .filter(u => u.form === '10-K' && u.fp === 'FY')
        .sort((a, b) => b.fy - a.fy);

      return annual[0]?.val;
    };

    const getLatestQuarterly = (concept: string): number | undefined => {
      const fact = gaap[concept];
      if (!fact) return undefined;

      const units = fact.units.USD || fact.units.shares || Object.values(fact.units)[0];
      if (!units) return undefined;

      // Find most recent 10-Q value
      const quarterly = units
        .filter(u => u.form === '10-Q')
        .sort((a, b) => new Date(b.end).getTime() - new Date(a.end).getTime());

      return quarterly[0]?.val;
    };

    // Get period end date
    const revenueData = gaap['Revenues'] || gaap['RevenueFromContractWithCustomerExcludingAssessedTax'];
    const periodEnd = revenueData?.units?.USD?.filter(u => u.form === '10-K').sort((a, b) => b.fy - a.fy)[0]?.end;

    const revenue = getLatestAnnual('Revenues') ||
      getLatestAnnual('RevenueFromContractWithCustomerExcludingAssessedTax') ||
      getLatestAnnual('SalesRevenueNet');

    const netIncome = getLatestAnnual('NetIncomeLoss');
    const grossProfit = getLatestAnnual('GrossProfit');
    const operatingIncome = getLatestAnnual('OperatingIncomeLoss');
    const totalAssets = getLatestAnnual('Assets');
    const totalLiabilities = getLatestAnnual('Liabilities');
    const stockholdersEquity = getLatestAnnual('StockholdersEquity');
    const currentAssets = getLatestAnnual('AssetsCurrent');
    const currentLiabilities = getLatestAnnual('LiabilitiesCurrent');
    const eps = getLatestAnnual('EarningsPerShareBasic');
    const operatingCashFlow = getLatestAnnual('NetCashProvidedByUsedInOperatingActivities');
    const capex = getLatestAnnual('PaymentsToAcquirePropertyPlantAndEquipment');

    // Calculate ratios
    const grossMargin = revenue && grossProfit ? grossProfit / revenue : undefined;
    const operatingMargin = revenue && operatingIncome ? operatingIncome / revenue : undefined;
    const netMargin = revenue && netIncome ? netIncome / revenue : undefined;
    const debtToEquity = totalLiabilities && stockholdersEquity
      ? totalLiabilities / stockholdersEquity
      : undefined;
    const currentRatio = currentAssets && currentLiabilities
      ? currentAssets / currentLiabilities
      : undefined;
    const freeCashFlow = operatingCashFlow && capex
      ? operatingCashFlow - capex
      : undefined;
    const roe = netIncome && stockholdersEquity
      ? netIncome / stockholdersEquity
      : undefined;

    return {
      symbol: symbol.toUpperCase(),
      periodEnd: periodEnd || new Date().toISOString().split('T')[0]!,
      revenue,
      netIncome,
      eps,
      grossMargin,
      operatingMargin,
      netMargin,
      debtToEquity,
      currentRatio,
      freeCashFlow,
      roe,
    };
  }

  /**
   * Get specific sections from a 10-K filing
   */
  async get10KSections(
    symbol: string,
    sections: ('business' | 'risk_factors' | 'mda' | 'financials')[] = ['business', 'risk_factors', 'mda']
  ): Promise<Record<string, string>> {
    const { text } = await this.getFilingText(symbol, '10-K');

    const result: Record<string, string> = {};

    // Section markers in 10-K filings (approximate - varies by company)
    const sectionPatterns: Record<string, { start: RegExp; end: RegExp }> = {
      business: {
        start: /item\s*1[.\s]*business/i,
        end: /item\s*1a[.\s]*risk\s*factors|item\s*2[.\s]/i,
      },
      risk_factors: {
        start: /item\s*1a[.\s]*risk\s*factors/i,
        end: /item\s*1b|item\s*2[.\s]/i,
      },
      mda: {
        start: /item\s*7[.\s]*management['']?s?\s*discussion/i,
        end: /item\s*7a|item\s*8[.\s]/i,
      },
      financials: {
        start: /item\s*8[.\s]*financial\s*statements/i,
        end: /item\s*9[.\s]/i,
      },
    };

    for (const section of sections) {
      const pattern = sectionPatterns[section];
      if (!pattern) continue;

      const startMatch = text.match(pattern.start);
      if (!startMatch) continue;

      const startIndex = startMatch.index!;
      const afterStart = text.slice(startIndex);
      const endMatch = afterStart.match(pattern.end);
      const endIndex = endMatch ? endMatch.index! : Math.min(50000, afterStart.length);

      let sectionText = afterStart.slice(0, endIndex).trim();

      // Limit section size
      if (sectionText.length > 30000) {
        sectionText = sectionText.slice(0, 30000) + '\n\n[TRUNCATED]';
      }

      result[section] = sectionText;
    }

    return result;
  }

  /**
   * Check if EDGAR API is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await rateLimitedFetch(
        `${EDGAR_BASE_URL}/submissions/company_tickers.json`
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Strip HTML tags from text
   */
  private stripHtml(html: string): string {
    // Remove script and style content
    let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

    // Remove HTML tags
    text = text.replace(/<[^>]+>/g, ' ');

    // Decode HTML entities
    text = text.replace(/&nbsp;/g, ' ');
    text = text.replace(/&amp;/g, '&');
    text = text.replace(/&lt;/g, '<');
    text = text.replace(/&gt;/g, '>');
    text = text.replace(/&quot;/g, '"');
    text = text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)));

    // Normalize whitespace
    text = text.replace(/\s+/g, ' ');
    text = text.replace(/\n\s*\n/g, '\n\n');

    return text.trim();
  }
}

// Singleton instance
let edgarProvider: EdgarDataProvider | null = null;

export function getEdgarProvider(): EdgarDataProvider {
  if (!edgarProvider) {
    edgarProvider = new EdgarDataProvider();
  }
  return edgarProvider;
}
