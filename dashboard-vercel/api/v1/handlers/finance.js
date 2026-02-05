/**
 * Finance Handlers — Alpha Vantage financial data endpoints.
 * CommonJS module. Each handler takes (query) and returns a plain object.
 * Uses native fetch() to call the Alpha Vantage API.
 */

const AV_BASE = 'https://www.alphavantage.co/query';
const DISCLAIMER = 'Educational data only. Not financial advice.';

/**
 * Get the Alpha Vantage API key from environment.
 * @returns {string|null} The API key, or null if not configured
 */
function getApiKey() {
  return process.env.ALPHAVANTAGE_API_KEY || null;
}

/**
 * Build an Alpha Vantage URL with the given parameters.
 * @param {object} params - Query parameters (function, symbol, etc.)
 * @returns {string} The full URL
 */
function buildUrl(params) {
  const qs = new URLSearchParams(params).toString();
  return `${AV_BASE}?${qs}`;
}

/**
 * Fetch data from Alpha Vantage and parse as JSON.
 * Returns an error object if the API key is missing, the request fails,
 * or AV returns a rate-limit note or error message.
 * @param {object} params - Query parameters to send to AV
 * @returns {Promise<{data: object}|{error: string, fallback: boolean}>}
 */
async function avFetch(params) {
  const apikey = getApiKey();
  if (!apikey) {
    return { error: 'Alpha Vantage API key not configured', fallback: true };
  }

  const url = buildUrl({ ...params, apikey });

  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    return { error: `Alpha Vantage request failed: ${err.message}`, fallback: true };
  }

  if (!res.ok) {
    return { error: `Alpha Vantage HTTP ${res.status}: ${res.statusText}`, fallback: true };
  }

  let data;
  try {
    data = await res.json();
  } catch (err) {
    return { error: 'Failed to parse Alpha Vantage response', fallback: true };
  }

  // Check for rate limit or error messages
  if (data['Note']) {
    return { error: `Alpha Vantage rate limit: ${data['Note']}`, fallback: true };
  }
  if (data['Error Message']) {
    return { error: `Alpha Vantage error: ${data['Error Message']}`, fallback: true };
  }
  if (data['Information']) {
    return { error: `Alpha Vantage: ${data['Information']}`, fallback: true };
  }

  return { data };
}

// ---------------------------------------------------------------------------
// 1. stockQuote
// ---------------------------------------------------------------------------

/**
 * Fetch a real-time stock quote from Alpha Vantage (GLOBAL_QUOTE).
 * @param {object} query - Query parameters
 * @param {string} query.symbol - Stock ticker symbol (required, e.g. "AAPL")
 * @returns {Promise<object>} Stock quote data with price, change, volume, etc.
 */
async function stockQuote(query) {
  const { symbol } = query || {};
  if (!symbol) {
    return { error: 'Missing required parameter: symbol' };
  }

  const result = await avFetch({ function: 'GLOBAL_QUOTE', symbol });
  if (result.error) return result;

  const gq = result.data['Global Quote'];
  if (!gq || Object.keys(gq).length === 0) {
    return { error: `No quote data found for symbol: ${symbol}`, fallback: true };
  }

  return {
    symbol: gq['01. symbol'] || symbol,
    price: gq['05. price'] || null,
    change: gq['09. change'] || null,
    change_percent: gq['10. change percent'] || null,
    volume: gq['06. volume'] || null,
    latest_trading_day: gq['07. latest trading day'] || null,
    previous_close: gq['08. previous close'] || null,
    open: gq['02. open'] || null,
    high: gq['03. high'] || null,
    low: gq['04. low'] || null,
    disclaimer: DISCLAIMER,
  };
}

// ---------------------------------------------------------------------------
// 2. cryptoRate
// ---------------------------------------------------------------------------

/**
 * Fetch a real-time cryptocurrency exchange rate (CURRENCY_EXCHANGE_RATE).
 * @param {object} query - Query parameters
 * @param {string} query.coin - Crypto currency code (required, e.g. "BTC")
 * @param {string} [query.currency="USD"] - Target fiat currency code
 * @returns {Promise<object>} Crypto rate with price, bid, ask, etc.
 */
async function cryptoRate(query) {
  const { coin, currency = 'USD' } = query || {};
  if (!coin) {
    return { error: 'Missing required parameter: coin' };
  }

  const result = await avFetch({
    function: 'CURRENCY_EXCHANGE_RATE',
    from_currency: coin.toUpperCase(),
    to_currency: currency.toUpperCase(),
  });
  if (result.error) return result;

  const rate = result.data['Realtime Currency Exchange Rate'];
  if (!rate) {
    return { error: `No exchange rate data found for ${coin}/${currency}`, fallback: true };
  }

  return {
    coin: coin.toUpperCase(),
    currency: currency.toUpperCase(),
    price: rate['5. Exchange Rate'] || null,
    bid: rate['8. Bid Price'] || null,
    ask: rate['9. Ask Price'] || null,
    last_refreshed: rate['6. Last Refreshed'] || null,
    disclaimer: DISCLAIMER,
  };
}

// ---------------------------------------------------------------------------
// 3. forexRate
// ---------------------------------------------------------------------------

/**
 * Fetch a real-time forex exchange rate (CURRENCY_EXCHANGE_RATE).
 * @param {object} query - Query parameters
 * @param {string} query.from - Source currency code (required, e.g. "EUR")
 * @param {string} query.to - Target currency code (required, e.g. "USD")
 * @returns {Promise<object>} Forex rate with rate, bid, ask, etc.
 */
async function forexRate(query) {
  const { from, to } = query || {};
  if (!from) {
    return { error: 'Missing required parameter: from' };
  }
  if (!to) {
    return { error: 'Missing required parameter: to' };
  }

  const result = await avFetch({
    function: 'CURRENCY_EXCHANGE_RATE',
    from_currency: from.toUpperCase(),
    to_currency: to.toUpperCase(),
  });
  if (result.error) return result;

  const rate = result.data['Realtime Currency Exchange Rate'];
  if (!rate) {
    return { error: `No exchange rate data found for ${from}/${to}`, fallback: true };
  }

  return {
    from: from.toUpperCase(),
    to: to.toUpperCase(),
    rate: rate['5. Exchange Rate'] || null,
    bid: rate['8. Bid Price'] || null,
    ask: rate['9. Ask Price'] || null,
    last_refreshed: rate['6. Last Refreshed'] || null,
    disclaimer: DISCLAIMER,
  };
}

// ---------------------------------------------------------------------------
// 4. marketNews
// ---------------------------------------------------------------------------

/**
 * Fetch market news and sentiment data (NEWS_SENTIMENT).
 * Returns the latest 10 headlines with sentiment analysis.
 * @param {object} query - Query parameters (none required)
 * @returns {Promise<object>} News headlines with titles, sources, sentiment, etc.
 */
async function marketNews(query) {
  const result = await avFetch({ function: 'NEWS_SENTIMENT' });
  if (result.error) return result;

  const feed = result.data['feed'];
  if (!feed || !Array.isArray(feed)) {
    return { error: 'No news data available', fallback: true };
  }

  const headlines = feed.slice(0, 10).map((item) => ({
    title: item.title || null,
    source: item.source || null,
    url: item.url || null,
    time_published: item.time_published || null,
    sentiment: item.overall_sentiment_label || null,
    sentiment_score: item.overall_sentiment_score || null,
  }));

  return {
    headlines,
    count: headlines.length,
    disclaimer: DISCLAIMER,
  };
}

// ---------------------------------------------------------------------------
// 5. economicIndicator
// ---------------------------------------------------------------------------

/**
 * Map of supported economic indicator names to Alpha Vantage function names
 * and human-readable labels.
 */
const ECONOMIC_INDICATORS = {
  GDP: { avFunction: 'REAL_GDP', name: 'Real Gross Domestic Product', unit: 'billions of dollars', interval: 'quarterly' },
  CPI: { avFunction: 'CPI', name: 'Consumer Price Index', unit: 'index', interval: 'monthly' },
  INFLATION: { avFunction: 'INFLATION', name: 'Inflation Rate', unit: 'percent', interval: 'annual' },
  UNEMPLOYMENT: { avFunction: 'UNEMPLOYMENT', name: 'Unemployment Rate', unit: 'percent', interval: 'monthly' },
  FEDERAL_FUNDS_RATE: { avFunction: 'FEDERAL_FUNDS_RATE', name: 'Federal Funds Rate', unit: 'percent', interval: 'monthly' },
  RETAIL_SALES: { avFunction: 'RETAIL_SALES', name: 'Retail Sales', unit: 'millions of dollars', interval: 'monthly' },
  NONFARM_PAYROLL: { avFunction: 'NONFARM_PAYROLL', name: 'Total Nonfarm Payroll', unit: 'thousands of persons', interval: 'monthly' },
};

/**
 * Fetch an economic indicator time series from Alpha Vantage.
 * Supported indicators: GDP, CPI, INFLATION, UNEMPLOYMENT,
 * FEDERAL_FUNDS_RATE, RETAIL_SALES, NONFARM_PAYROLL.
 * @param {object} query - Query parameters
 * @param {string} query.name - Indicator name (required, e.g. "GDP")
 * @returns {Promise<object>} Latest 5 data points for the indicator
 */
async function economicIndicator(query) {
  const { name } = query || {};
  if (!name) {
    return { error: 'Missing required parameter: name' };
  }

  const key = name.toUpperCase();
  const indicator = ECONOMIC_INDICATORS[key];
  if (!indicator) {
    const valid = Object.keys(ECONOMIC_INDICATORS).join(', ');
    return { error: `Unknown indicator: ${name}. Valid options: ${valid}` };
  }

  const params = { function: indicator.avFunction };
  // GDP uses quarterly interval; others use their defined intervals
  if (key === 'GDP') {
    params.interval = 'quarterly';
  } else if (indicator.interval !== 'annual') {
    params.interval = indicator.interval;
  }
  // For annual indicators like INFLATION, no interval param is needed
  // (AV defaults to annual)

  const result = await avFetch(params);
  if (result.error) return result;

  const dataArr = result.data['data'];
  if (!dataArr || !Array.isArray(dataArr)) {
    return { error: `No data available for indicator: ${name}`, fallback: true };
  }

  const latest = dataArr.slice(0, 5).map((entry) => ({
    date: entry.date || null,
    value: entry.value || null,
  }));

  return {
    indicator: key,
    name: indicator.name,
    data: latest,
    unit: indicator.unit,
    disclaimer: DISCLAIMER,
  };
}

// ---------------------------------------------------------------------------
// 6. companyOverview
// ---------------------------------------------------------------------------

/**
 * Fetch a company overview / fundamental data from Alpha Vantage (OVERVIEW).
 * @param {object} query - Query parameters
 * @param {string} query.symbol - Stock ticker symbol (required, e.g. "MSFT")
 * @returns {Promise<object>} Company info including sector, market cap, PE ratio, etc.
 */
async function companyOverview(query) {
  const { symbol } = query || {};
  if (!symbol) {
    return { error: 'Missing required parameter: symbol' };
  }

  const result = await avFetch({ function: 'OVERVIEW', symbol: symbol.toUpperCase() });
  if (result.error) return result;

  const d = result.data;
  if (!d || !d['Symbol']) {
    return { error: `No overview data found for symbol: ${symbol}`, fallback: true };
  }

  return {
    symbol: d['Symbol'] || symbol.toUpperCase(),
    name: d['Name'] || null,
    description: d['Description'] || null,
    sector: d['Sector'] || null,
    industry: d['Industry'] || null,
    market_cap: d['MarketCapitalization'] || null,
    pe_ratio: d['PERatio'] || null,
    eps: d['EPS'] || null,
    dividend_yield: d['DividendYield'] || null,
    fifty_two_week_high: d['52WeekHigh'] || null,
    fifty_two_week_low: d['52WeekLow'] || null,
    exchange: d['Exchange'] || null,
    currency: d['Currency'] || null,
    country: d['Country'] || null,
    disclaimer: DISCLAIMER,
  };
}

// ---------------------------------------------------------------------------
// 7. stockSearch
// ---------------------------------------------------------------------------

/**
 * Search for stock ticker symbols by keywords (SYMBOL_SEARCH).
 * @param {object} query - Query parameters
 * @param {string} query.q - Search keywords (required, e.g. "Tesla")
 * @returns {Promise<object>} Matching symbols with name, type, region, etc.
 */
async function stockSearch(query) {
  const { q } = query || {};
  if (!q) {
    return { error: 'Missing required parameter: q' };
  }

  const result = await avFetch({ function: 'SYMBOL_SEARCH', keywords: q });
  if (result.error) return result;

  const matches = result.data['bestMatches'];
  if (!matches || !Array.isArray(matches)) {
    return { error: `No search results for: ${q}`, fallback: true };
  }

  const results = matches.map((m) => ({
    symbol: m['1. symbol'] || null,
    name: m['2. name'] || null,
    type: m['3. type'] || null,
    region: m['4. region'] || null,
    currency: m['8. currency'] || null,
    match_score: m['9. matchScore'] || null,
  }));

  return {
    query: q,
    results,
    count: results.length,
    disclaimer: DISCLAIMER,
  };
}

// ---------------------------------------------------------------------------
// 8. commodityPrice
// ---------------------------------------------------------------------------

/**
 * Map of commodity names to their Alpha Vantage function names.
 * Gold and silver use the CURRENCY_EXCHANGE_RATE endpoint (XAU, XAG).
 * Other commodities use dedicated AV commodity functions with monthly interval.
 */
const COMMODITY_MAP = {
  gold: { type: 'forex', from_currency: 'XAU', unit: 'USD per troy ounce' },
  silver: { type: 'forex', from_currency: 'XAG', unit: 'USD per troy ounce' },
  oil: { type: 'commodity', avFunction: 'WTI', unit: 'USD per barrel' },
  copper: { type: 'commodity', avFunction: 'COPPER', unit: 'USD per pound' },
  aluminum: { type: 'commodity', avFunction: 'ALUMINUM', unit: 'USD per metric ton' },
  wheat: { type: 'commodity', avFunction: 'WHEAT', unit: 'USD per bushel' },
  corn: { type: 'commodity', avFunction: 'CORN', unit: 'USD per bushel' },
  sugar: { type: 'commodity', avFunction: 'SUGAR', unit: 'USD per pound' },
  coffee: { type: 'commodity', avFunction: 'COFFEE', unit: 'USD per pound' },
  cotton: { type: 'commodity', avFunction: 'COTTON', unit: 'USD per pound' },
  natural_gas: { type: 'commodity', avFunction: 'NATURAL_GAS', unit: 'USD per million BTU' },
};

/**
 * Fetch the latest price for a commodity.
 * Supports: gold, silver, oil, copper, aluminum, wheat, corn, sugar,
 * coffee, cotton, natural_gas.
 *
 * Gold and silver are fetched via CURRENCY_EXCHANGE_RATE (XAU/XAG to USD).
 * Other commodities use dedicated AV commodity endpoints with monthly data.
 *
 * @param {object} query - Query parameters
 * @param {string} query.name - Commodity name (required, e.g. "gold", "oil")
 * @returns {Promise<object>} Latest commodity price with unit and date
 */
async function commodityPrice(query) {
  const { name } = query || {};
  if (!name) {
    return { error: 'Missing required parameter: name' };
  }

  const key = name.toLowerCase().replace(/\s+/g, '_');
  const commodity = COMMODITY_MAP[key];
  if (!commodity) {
    const valid = Object.keys(COMMODITY_MAP).join(', ');
    return { error: `Unknown commodity: ${name}. Valid options: ${valid}` };
  }

  // Gold and silver: use forex exchange rate (XAU/XAG → USD)
  if (commodity.type === 'forex') {
    const result = await avFetch({
      function: 'CURRENCY_EXCHANGE_RATE',
      from_currency: commodity.from_currency,
      to_currency: 'USD',
    });
    if (result.error) return result;

    const rate = result.data['Realtime Currency Exchange Rate'];
    if (!rate) {
      return { error: `No price data available for ${name}`, fallback: true };
    }

    return {
      commodity: name.toLowerCase(),
      price: rate['5. Exchange Rate'] || null,
      unit: commodity.unit,
      date: rate['6. Last Refreshed'] || null,
      currency: 'USD',
      disclaimer: DISCLAIMER,
    };
  }

  // Other commodities: use dedicated AV commodity endpoint with monthly data
  const result = await avFetch({
    function: commodity.avFunction,
    interval: 'monthly',
  });
  if (result.error) return result;

  const dataArr = result.data['data'];
  if (!dataArr || !Array.isArray(dataArr) || dataArr.length === 0) {
    return { error: `No price data available for ${name}`, fallback: true };
  }

  // Get the latest non-"." entry
  const latest = dataArr.find((entry) => entry.value && entry.value !== '.');
  if (!latest) {
    return { error: `No valid price data available for ${name}`, fallback: true };
  }

  return {
    commodity: name.toLowerCase(),
    price: latest.value,
    unit: commodity.unit,
    date: latest.date || null,
    currency: 'USD',
    disclaimer: DISCLAIMER,
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  stockQuote,
  cryptoRate,
  forexRate,
  marketNews,
  economicIndicator,
  companyOverview,
  stockSearch,
  commodityPrice,
};
