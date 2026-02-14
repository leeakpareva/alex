/**
 * Finance Handlers — Static stub data for financial endpoints.
 * CommonJS module. Each handler takes (query) and returns a plain object.
 * No external API calls — all data is realistic but static.
 */

const DISCLAIMER = 'Sample data for demonstration purposes. Not real-time financial data.';

// ---------------------------------------------------------------------------
// Stub data tables
// ---------------------------------------------------------------------------

const STOCK_DATA = {
  AAPL:  { name: 'Apple Inc.',          price: '189.84', open: '188.12', high: '190.95', low: '187.45', change: '+1.72', change_percent: '+0.91%', volume: '58234100', previous_close: '188.12' },
  TSLA:  { name: 'Tesla, Inc.',         price: '248.42', open: '245.80', high: '251.30', low: '244.15', change: '+2.62', change_percent: '+1.07%', volume: '112450000', previous_close: '245.80' },
  MSFT:  { name: 'Microsoft Corp.',     price: '378.91', open: '376.50', high: '380.20', low: '375.10', change: '+2.41', change_percent: '+0.64%', volume: '22145000', previous_close: '376.50' },
  GOOG:  { name: 'Alphabet Inc.',       price: '141.80', open: '140.55', high: '142.60', low: '139.90', change: '+1.25', change_percent: '+0.89%', volume: '25678000', previous_close: '140.55' },
  GOOGL: { name: 'Alphabet Inc.',       price: '140.92', open: '139.70', high: '141.75', low: '139.00', change: '+1.22', change_percent: '+0.87%', volume: '28901000', previous_close: '139.70' },
  AMZN:  { name: 'Amazon.com Inc.',     price: '178.25', open: '176.90', high: '179.50', low: '176.10', change: '+1.35', change_percent: '+0.76%', volume: '45230000', previous_close: '176.90' },
  META:  { name: 'Meta Platforms Inc.', price: '505.75', open: '502.30', high: '508.40', low: '501.00', change: '+3.45', change_percent: '+0.69%', volume: '18920000', previous_close: '502.30' },
  NVDA:  { name: 'NVIDIA Corp.',        price: '875.28', open: '868.50', high: '880.00', low: '865.20', change: '+6.78', change_percent: '+0.78%', volume: '41560000', previous_close: '868.50' },
  JPM:   { name: 'JPMorgan Chase & Co.',price: '196.32', open: '195.10', high: '197.80', low: '194.50', change: '+1.22', change_percent: '+0.63%', volume: '9870000', previous_close: '195.10' },
  V:     { name: 'Visa Inc.',           price: '279.55', open: '278.00', high: '280.90', low: '277.30', change: '+1.55', change_percent: '+0.56%', volume: '7654000', previous_close: '278.00' },
  DIS:   { name: 'Walt Disney Co.',     price: '112.40', open: '111.20', high: '113.50', low: '110.80', change: '+1.20', change_percent: '+1.08%', volume: '11230000', previous_close: '111.20' },
  NFLX:  { name: 'Netflix Inc.',        price: '628.90', open: '624.50', high: '632.00', low: '623.10', change: '+4.40', change_percent: '+0.70%', volume: '6543000', previous_close: '624.50' },
  AMD:   { name: 'AMD Inc.',            price: '164.72', open: '162.80', high: '166.10', low: '162.00', change: '+1.92', change_percent: '+1.18%', volume: '52340000', previous_close: '162.80' },
};

const CRYPTO_DATA = {
  bitcoin:  { symbol: 'BTC', price: '67432.50', bid: '67420.00', ask: '67445.00' },
  ethereum: { symbol: 'ETH', price: '3521.80',  bid: '3520.10', ask: '3523.50' },
  solana:   { symbol: 'SOL', price: '148.25',   bid: '148.10',  ask: '148.40' },
  dogecoin: { symbol: 'DOGE', price: '0.1542',  bid: '0.1540',  ask: '0.1544' },
  cardano:  { symbol: 'ADA', price: '0.6180',   bid: '0.6175',  ask: '0.6185' },
  ripple:   { symbol: 'XRP', price: '0.5234',   bid: '0.5230',  ask: '0.5238' },
  litecoin: { symbol: 'LTC', price: '84.50',    bid: '84.40',   ask: '84.60' },
  polkadot: { symbol: 'DOT', price: '7.85',     bid: '7.83',    ask: '7.87' },
};

const FOREX_DATA = {
  'EUR/USD': { rate: '1.0862', bid: '1.0860', ask: '1.0864' },
  'GBP/USD': { rate: '1.2715', bid: '1.2713', ask: '1.2717' },
  'USD/JPY': { rate: '149.85', bid: '149.83', ask: '149.87' },
  'USD/CHF': { rate: '0.8742', bid: '0.8740', ask: '0.8744' },
  'AUD/USD': { rate: '0.6578', bid: '0.6576', ask: '0.6580' },
  'USD/CAD': { rate: '1.3612', bid: '1.3610', ask: '1.3614' },
  'NZD/USD': { rate: '0.6124', bid: '0.6122', ask: '0.6126' },
  'EUR/GBP': { rate: '0.8542', bid: '0.8540', ask: '0.8544' },
  'EUR/JPY': { rate: '162.78', bid: '162.76', ask: '162.80' },
  'GBP/JPY': { rate: '190.45', bid: '190.43', ask: '190.47' },
};

const COMPANY_DATA = {
  AAPL:  { name: 'Apple Inc.',           description: 'Apple Inc. designs, manufactures, and markets smartphones, personal computers, tablets, wearables, and accessories.', sector: 'Technology', industry: 'Consumer Electronics', market_cap: '2943000000000', pe_ratio: '29.45', eps: '6.44', dividend_yield: '0.0055', fifty_two_week_high: '199.62', fifty_two_week_low: '164.08', exchange: 'NASDAQ', currency: 'USD', country: 'USA' },
  TSLA:  { name: 'Tesla, Inc.',          description: 'Tesla, Inc. designs, develops, manufactures, and sells electric vehicles and energy generation and storage systems.', sector: 'Consumer Cyclical', industry: 'Auto Manufacturers', market_cap: '789000000000', pe_ratio: '62.80', eps: '3.95', dividend_yield: '0', fifty_two_week_high: '278.98', fifty_two_week_low: '152.37', exchange: 'NASDAQ', currency: 'USD', country: 'USA' },
  MSFT:  { name: 'Microsoft Corp.',      description: 'Microsoft Corporation develops and supports software, services, devices, and solutions worldwide.', sector: 'Technology', industry: 'Software—Infrastructure', market_cap: '2815000000000', pe_ratio: '35.20', eps: '10.76', dividend_yield: '0.0072', fifty_two_week_high: '384.30', fifty_two_week_low: '309.45', exchange: 'NASDAQ', currency: 'USD', country: 'USA' },
  GOOG:  { name: 'Alphabet Inc.',        description: 'Alphabet Inc. offers various products and platforms in the United States, Europe, the Middle East, Africa, the Asia-Pacific, Canada, and Latin America.', sector: 'Communication Services', industry: 'Internet Content & Information', market_cap: '1756000000000', pe_ratio: '23.10', eps: '6.14', dividend_yield: '0', fifty_two_week_high: '153.78', fifty_two_week_low: '120.21', exchange: 'NASDAQ', currency: 'USD', country: 'USA' },
  AMZN:  { name: 'Amazon.com Inc.',      description: 'Amazon.com, Inc. engages in the retail sale of consumer products, advertising, and subscription services through online and physical stores.', sector: 'Consumer Cyclical', industry: 'Internet Retail', market_cap: '1862000000000', pe_ratio: '58.90', eps: '3.02', dividend_yield: '0', fifty_two_week_high: '189.77', fifty_two_week_low: '118.35', exchange: 'NASDAQ', currency: 'USD', country: 'USA' },
  META:  { name: 'Meta Platforms Inc.',  description: 'Meta Platforms, Inc. engages in the development of products for people to connect and share through mobile devices, PCs, VR headsets, and wearables.', sector: 'Communication Services', industry: 'Internet Content & Information', market_cap: '1295000000000', pe_ratio: '30.15', eps: '16.78', dividend_yield: '0.0040', fifty_two_week_high: '531.49', fifty_two_week_low: '279.40', exchange: 'NASDAQ', currency: 'USD', country: 'USA' },
  NVDA:  { name: 'NVIDIA Corp.',         description: 'NVIDIA Corporation provides graphics and compute and networking solutions in the United States, Taiwan, China, Hong Kong, and internationally.', sector: 'Technology', industry: 'Semiconductors', market_cap: '2156000000000', pe_ratio: '65.40', eps: '13.38', dividend_yield: '0.0002', fifty_two_week_high: '974.00', fifty_two_week_low: '390.00', exchange: 'NASDAQ', currency: 'USD', country: 'USA' },
  JPM:   { name: 'JPMorgan Chase & Co.', description: 'JPMorgan Chase & Co. operates as a financial services company worldwide.', sector: 'Financial Services', industry: 'Banks—Diversified', market_cap: '565000000000', pe_ratio: '11.85', eps: '16.56', dividend_yield: '0.0225', fifty_two_week_high: '200.94', fifty_two_week_low: '144.34', exchange: 'NYSE', currency: 'USD', country: 'USA' },
  V:     { name: 'Visa Inc.',            description: 'Visa Inc. operates as a payments technology company worldwide.', sector: 'Financial Services', industry: 'Credit Services', market_cap: '564000000000', pe_ratio: '30.80', eps: '9.07', dividend_yield: '0.0075', fifty_two_week_high: '290.96', fifty_two_week_low: '227.76', exchange: 'NYSE', currency: 'USD', country: 'USA' },
  DIS:   { name: 'Walt Disney Co.',      description: 'The Walt Disney Company operates as an entertainment company worldwide.', sector: 'Communication Services', industry: 'Entertainment', market_cap: '206000000000', pe_ratio: '72.50', eps: '1.55', dividend_yield: '0.0036', fifty_two_week_high: '123.74', fifty_two_week_low: '78.73', exchange: 'NYSE', currency: 'USD', country: 'USA' },
  NFLX:  { name: 'Netflix Inc.',         description: 'Netflix, Inc. provides entertainment services. It offers TV series, documentaries, feature films, and games across various genres and languages.', sector: 'Communication Services', industry: 'Entertainment', market_cap: '274000000000', pe_ratio: '47.20', eps: '13.32', dividend_yield: '0', fifty_two_week_high: '639.00', fifty_two_week_low: '344.73', exchange: 'NASDAQ', currency: 'USD', country: 'USA' },
  AMD:   { name: 'AMD Inc.',             description: 'Advanced Micro Devices, Inc. operates as a semiconductor company worldwide.', sector: 'Technology', industry: 'Semiconductors', market_cap: '266000000000', pe_ratio: '230.50', eps: '0.71', dividend_yield: '0', fifty_two_week_high: '227.30', fifty_two_week_low: '93.12', exchange: 'NASDAQ', currency: 'USD', country: 'USA' },
};

const COMMODITY_DATA = {
  gold:        { price: '2342.50', unit: 'USD per troy ounce', date: '2025-01-15' },
  silver:      { price: '27.85',   unit: 'USD per troy ounce', date: '2025-01-15' },
  oil:         { price: '72.45',   unit: 'USD per barrel',     date: '2025-01-15' },
  copper:      { price: '4.12',    unit: 'USD per pound',      date: '2025-01-15' },
  aluminum:    { price: '2285.00', unit: 'USD per metric ton',  date: '2025-01-15' },
  wheat:       { price: '5.82',    unit: 'USD per bushel',     date: '2025-01-15' },
  corn:        { price: '4.58',    unit: 'USD per bushel',     date: '2025-01-15' },
  sugar:       { price: '0.2145',  unit: 'USD per pound',      date: '2025-01-15' },
  coffee:      { price: '1.92',    unit: 'USD per pound',      date: '2025-01-15' },
  cotton:      { price: '0.78',    unit: 'USD per pound',      date: '2025-01-15' },
  natural_gas: { price: '2.68',    unit: 'USD per million BTU', date: '2025-01-15' },
};

const MARKET_NEWS = [
  { title: 'Tech Stocks Rally as AI Spending Surges', source: 'Reuters', url: 'https://example.com/news/1', time_published: '20250115T143000', sentiment: 'Bullish', sentiment_score: '0.72' },
  { title: 'Federal Reserve Signals Potential Rate Cuts in 2025', source: 'Bloomberg', url: 'https://example.com/news/2', time_published: '20250115T120000', sentiment: 'Bullish', sentiment_score: '0.65' },
  { title: 'Oil Prices Dip Amid Global Demand Concerns', source: 'CNBC', url: 'https://example.com/news/3', time_published: '20250115T110000', sentiment: 'Bearish', sentiment_score: '-0.35' },
  { title: 'Semiconductor Shortage Eases as New Fabs Come Online', source: 'Wall Street Journal', url: 'https://example.com/news/4', time_published: '20250115T100000', sentiment: 'Bullish', sentiment_score: '0.48' },
  { title: 'Retail Sales Beat Expectations for Third Straight Month', source: 'Associated Press', url: 'https://example.com/news/5', time_published: '20250115T093000', sentiment: 'Bullish', sentiment_score: '0.52' },
  { title: 'Bitcoin Surges Past $67,000 on Institutional Demand', source: 'CoinDesk', url: 'https://example.com/news/6', time_published: '20250115T083000', sentiment: 'Bullish', sentiment_score: '0.68' },
  { title: 'European Markets Close Higher on Strong Earnings', source: 'Financial Times', url: 'https://example.com/news/7', time_published: '20250115T073000', sentiment: 'Bullish', sentiment_score: '0.41' },
  { title: 'Housing Market Shows Signs of Cooling in Major Cities', source: 'MarketWatch', url: 'https://example.com/news/8', time_published: '20250115T063000', sentiment: 'Bearish', sentiment_score: '-0.28' },
  { title: 'EV Sales Accelerate as Battery Costs Decline', source: 'Barron\'s', url: 'https://example.com/news/9', time_published: '20250115T053000', sentiment: 'Bullish', sentiment_score: '0.55' },
  { title: 'Trade Tensions Rise Between Major Economies', source: 'The Economist', url: 'https://example.com/news/10', time_published: '20250115T043000', sentiment: 'Bearish', sentiment_score: '-0.42' },
];

const ECONOMIC_INDICATOR_DATA = {
  GDP:                 [{ date: '2024-10-01', value: '23452.6' }, { date: '2024-07-01', value: '23213.8' }, { date: '2024-04-01', value: '22980.1' }, { date: '2024-01-01', value: '22741.5' }, { date: '2023-10-01', value: '22490.2' }],
  CPI:                 [{ date: '2024-12-01', value: '315.6' }, { date: '2024-11-01', value: '314.9' }, { date: '2024-10-01', value: '314.2' }, { date: '2024-09-01', value: '313.5' }, { date: '2024-08-01', value: '312.8' }],
  INFLATION:           [{ date: '2024-01-01', value: '3.1' }, { date: '2023-01-01', value: '4.1' }, { date: '2022-01-01', value: '8.0' }, { date: '2021-01-01', value: '4.7' }, { date: '2020-01-01', value: '1.2' }],
  UNEMPLOYMENT:        [{ date: '2024-12-01', value: '3.7' }, { date: '2024-11-01', value: '3.7' }, { date: '2024-10-01', value: '3.8' }, { date: '2024-09-01', value: '3.8' }, { date: '2024-08-01', value: '3.9' }],
  FEDERAL_FUNDS_RATE:  [{ date: '2024-12-01', value: '5.33' }, { date: '2024-11-01', value: '5.33' }, { date: '2024-10-01', value: '5.33' }, { date: '2024-09-01', value: '5.33' }, { date: '2024-08-01', value: '5.33' }],
  RETAIL_SALES:        [{ date: '2024-12-01', value: '714520' }, { date: '2024-11-01', value: '710340' }, { date: '2024-10-01', value: '705210' }, { date: '2024-09-01', value: '701820' }, { date: '2024-08-01', value: '698450' }],
  NONFARM_PAYROLL:     [{ date: '2024-12-01', value: '157200' }, { date: '2024-11-01', value: '156980' }, { date: '2024-10-01', value: '156750' }, { date: '2024-09-01', value: '156520' }, { date: '2024-08-01', value: '156290' }],
};

// Search index for stockSearch
const SEARCH_INDEX = [
  { symbol: 'AAPL',  name: 'Apple Inc.',                type: 'Equity', region: 'United States', currency: 'USD' },
  { symbol: 'TSLA',  name: 'Tesla, Inc.',               type: 'Equity', region: 'United States', currency: 'USD' },
  { symbol: 'MSFT',  name: 'Microsoft Corporation',     type: 'Equity', region: 'United States', currency: 'USD' },
  { symbol: 'GOOG',  name: 'Alphabet Inc.',             type: 'Equity', region: 'United States', currency: 'USD' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.',             type: 'Equity', region: 'United States', currency: 'USD' },
  { symbol: 'AMZN',  name: 'Amazon.com, Inc.',          type: 'Equity', region: 'United States', currency: 'USD' },
  { symbol: 'META',  name: 'Meta Platforms, Inc.',      type: 'Equity', region: 'United States', currency: 'USD' },
  { symbol: 'NVDA',  name: 'NVIDIA Corporation',        type: 'Equity', region: 'United States', currency: 'USD' },
  { symbol: 'JPM',   name: 'JPMorgan Chase & Co.',      type: 'Equity', region: 'United States', currency: 'USD' },
  { symbol: 'V',     name: 'Visa Inc.',                 type: 'Equity', region: 'United States', currency: 'USD' },
  { symbol: 'DIS',   name: 'The Walt Disney Company',   type: 'Equity', region: 'United States', currency: 'USD' },
  { symbol: 'NFLX',  name: 'Netflix, Inc.',             type: 'Equity', region: 'United States', currency: 'USD' },
  { symbol: 'AMD',   name: 'Advanced Micro Devices',    type: 'Equity', region: 'United States', currency: 'USD' },
];

// ---------------------------------------------------------------------------
// Metadata maps (kept for validation)
// ---------------------------------------------------------------------------

const ECONOMIC_INDICATORS = {
  GDP: { name: 'Real Gross Domestic Product', unit: 'billions of dollars', interval: 'quarterly' },
  CPI: { name: 'Consumer Price Index', unit: 'index', interval: 'monthly' },
  INFLATION: { name: 'Inflation Rate', unit: 'percent', interval: 'annual' },
  UNEMPLOYMENT: { name: 'Unemployment Rate', unit: 'percent', interval: 'monthly' },
  FEDERAL_FUNDS_RATE: { name: 'Federal Funds Rate', unit: 'percent', interval: 'monthly' },
  RETAIL_SALES: { name: 'Retail Sales', unit: 'millions of dollars', interval: 'monthly' },
  NONFARM_PAYROLL: { name: 'Total Nonfarm Payroll', unit: 'thousands of persons', interval: 'monthly' },
};

const COMMODITY_MAP = {
  gold: { unit: 'USD per troy ounce' },
  silver: { unit: 'USD per troy ounce' },
  oil: { unit: 'USD per barrel' },
  copper: { unit: 'USD per pound' },
  aluminum: { unit: 'USD per metric ton' },
  wheat: { unit: 'USD per bushel' },
  corn: { unit: 'USD per bushel' },
  sugar: { unit: 'USD per pound' },
  coffee: { unit: 'USD per pound' },
  cotton: { unit: 'USD per pound' },
  natural_gas: { unit: 'USD per million BTU' },
};

// ---------------------------------------------------------------------------
// Helper: generate a timestamp string
// ---------------------------------------------------------------------------

function timestamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

// ---------------------------------------------------------------------------
// 1. stockQuote
// ---------------------------------------------------------------------------

async function stockQuote(query) {
  const { symbol } = query || {};
  if (!symbol) {
    return { error: 'Missing required parameter: symbol' };
  }

  const key = symbol.toUpperCase();
  const stock = STOCK_DATA[key];

  if (stock) {
    return {
      symbol: key,
      price: stock.price,
      change: stock.change,
      change_percent: stock.change_percent,
      volume: stock.volume,
      latest_trading_day: '2025-01-15',
      previous_close: stock.previous_close,
      open: stock.open,
      high: stock.high,
      low: stock.low,
      disclaimer: DISCLAIMER,
    };
  }

  // Fallback for unknown tickers — return plausible stub
  return {
    symbol: key,
    price: '52.30',
    change: '+0.45',
    change_percent: '+0.87%',
    volume: '3450000',
    latest_trading_day: '2025-01-15',
    previous_close: '51.85',
    open: '51.90',
    high: '52.75',
    low: '51.60',
    disclaimer: DISCLAIMER,
  };
}

// ---------------------------------------------------------------------------
// 2. cryptoRate
// ---------------------------------------------------------------------------

async function cryptoRate(query) {
  const { coin, currency = 'USD' } = query || {};
  if (!coin) {
    return { error: 'Missing required parameter: coin' };
  }

  const key = coin.toLowerCase();
  const crypto = CRYPTO_DATA[key];

  if (crypto) {
    return {
      coin: crypto.symbol,
      currency: currency.toUpperCase(),
      price: crypto.price,
      bid: crypto.bid,
      ask: crypto.ask,
      last_refreshed: timestamp(),
      disclaimer: DISCLAIMER,
    };
  }

  // Fallback for unknown coins
  return {
    coin: coin.toUpperCase(),
    currency: currency.toUpperCase(),
    price: '1.2500',
    bid: '1.2480',
    ask: '1.2520',
    last_refreshed: timestamp(),
    disclaimer: DISCLAIMER,
  };
}

// ---------------------------------------------------------------------------
// 3. forexRate
// ---------------------------------------------------------------------------

async function forexRate(query) {
  const { from, to } = query || {};
  if (!from) {
    return { error: 'Missing required parameter: from' };
  }
  if (!to) {
    return { error: 'Missing required parameter: to' };
  }

  const pair = `${from.toUpperCase()}/${to.toUpperCase()}`;
  const fx = FOREX_DATA[pair];

  if (fx) {
    return {
      from: from.toUpperCase(),
      to: to.toUpperCase(),
      rate: fx.rate,
      bid: fx.bid,
      ask: fx.ask,
      last_refreshed: timestamp(),
      disclaimer: DISCLAIMER,
    };
  }

  // Fallback for unknown pairs
  return {
    from: from.toUpperCase(),
    to: to.toUpperCase(),
    rate: '1.0000',
    bid: '0.9998',
    ask: '1.0002',
    last_refreshed: timestamp(),
    disclaimer: DISCLAIMER,
  };
}

// ---------------------------------------------------------------------------
// 4. marketNews
// ---------------------------------------------------------------------------

async function marketNews(query) {
  return {
    headlines: MARKET_NEWS,
    count: MARKET_NEWS.length,
    disclaimer: DISCLAIMER,
  };
}

// ---------------------------------------------------------------------------
// 5. economicIndicator
// ---------------------------------------------------------------------------

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

  return {
    indicator: key,
    name: indicator.name,
    data: ECONOMIC_INDICATOR_DATA[key],
    unit: indicator.unit,
    disclaimer: DISCLAIMER,
  };
}

// ---------------------------------------------------------------------------
// 6. companyOverview
// ---------------------------------------------------------------------------

async function companyOverview(query) {
  const { symbol } = query || {};
  if (!symbol) {
    return { error: 'Missing required parameter: symbol' };
  }

  const key = symbol.toUpperCase();
  const company = COMPANY_DATA[key];

  if (company) {
    return {
      symbol: key,
      name: company.name,
      description: company.description,
      sector: company.sector,
      industry: company.industry,
      market_cap: company.market_cap,
      pe_ratio: company.pe_ratio,
      eps: company.eps,
      dividend_yield: company.dividend_yield,
      fifty_two_week_high: company.fifty_two_week_high,
      fifty_two_week_low: company.fifty_two_week_low,
      exchange: company.exchange,
      currency: company.currency,
      country: company.country,
      disclaimer: DISCLAIMER,
    };
  }

  // Fallback for unknown symbols
  return {
    symbol: key,
    name: `${key} Inc.`,
    description: `Company data for ${key}.`,
    sector: 'N/A',
    industry: 'N/A',
    market_cap: 'N/A',
    pe_ratio: 'N/A',
    eps: 'N/A',
    dividend_yield: 'N/A',
    fifty_two_week_high: 'N/A',
    fifty_two_week_low: 'N/A',
    exchange: 'N/A',
    currency: 'USD',
    country: 'USA',
    disclaimer: DISCLAIMER,
  };
}

// ---------------------------------------------------------------------------
// 7. stockSearch
// ---------------------------------------------------------------------------

async function stockSearch(query) {
  const { q } = query || {};
  if (!q) {
    return { error: 'Missing required parameter: q' };
  }

  const term = q.toLowerCase();
  const matches = SEARCH_INDEX.filter(
    (s) => s.symbol.toLowerCase().includes(term) || s.name.toLowerCase().includes(term)
  );

  const results = matches.map((m) => ({
    symbol: m.symbol,
    name: m.name,
    type: m.type,
    region: m.region,
    currency: m.currency,
    match_score: '1.0000',
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

async function commodityPrice(query) {
  const { name } = query || {};
  if (!name) {
    return { error: 'Missing required parameter: name' };
  }

  const key = name.toLowerCase().replace(/\s+/g, '_');
  const commodity = COMMODITY_DATA[key];
  if (!commodity) {
    const valid = Object.keys(COMMODITY_MAP).join(', ');
    return { error: `Unknown commodity: ${name}. Valid options: ${valid}` };
  }

  return {
    commodity: key,
    price: commodity.price,
    unit: commodity.unit,
    date: commodity.date,
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
