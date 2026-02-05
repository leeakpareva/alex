/**
 * Router — Maps endpoint names to handler functions.
 * Each handler receives (query) and returns a data object.
 * The main [endpoint].js file handles caching, auth, and response formatting.
 */

const finance = require('./finance');
const aiLanguage = require('./ai-language');
const dataReference = require('./data-reference');
const scienceMath = require('./science-math');
const webDev = require('./web-dev');
const education = require('./education');

/**
 * Dispatch map: endpoint name → handler function.
 * Each handler takes (query) where query is req.query (minus 'endpoint').
 * Returns a plain object that will be cached and returned as JSON.
 */
const handlers = {
  // Finance — Alpha Vantage (Tier 1)
  'stock-quote': finance.stockQuote,
  'crypto-rate': finance.cryptoRate,
  'forex-rate': finance.forexRate,
  'market-news': finance.marketNews,
  'economic-indicator': finance.economicIndicator,
  'company-overview': finance.companyOverview,
  'stock-search': finance.stockSearch,
  'commodity-price': finance.commodityPrice,

  // AI & Language — Claude Haiku (Tier 4)
  'text-summary': aiLanguage.textSummary,
  'sentiment-analysis': aiLanguage.sentimentAnalysis,
  'translate': aiLanguage.translate,
  'explain-concept': aiLanguage.explainConcept,
  'quiz-generator': aiLanguage.quizGenerator,

  // Data & Reference — Free APIs + AI (Tier 2/4)
  'country-info': dataReference.countryInfo,
  'weather': dataReference.weather,
  'news-headlines': dataReference.newsHeadlines,
  'historical-events': dataReference.historicalEvents,
  'unit-convert': dataReference.unitConvert,
  'time-zones': dataReference.timeZones,

  // Science & Math — Computation + AI (Tier 3/4)
  'math-solve': scienceMath.mathSolve,
  'periodic-table': scienceMath.periodicTable,
  'space-facts': scienceMath.spaceFacts,
  'statistics-calc': scienceMath.statisticsCalc,
  'carbon-footprint': scienceMath.carbonFootprint,

  // Web & Dev — Pure computation (Tier 3)
  'qr-generate': webDev.qrGenerate,
  'color-palette': webDev.colorPalette,
  'lorem-ipsum': webDev.loremIpsum,

  // Education — Dictionary API + AI (Tier 2/4)
  'word-definition': education.wordDefinition,
  'book-summary': education.bookSummary,
  'study-plan': education.studyPlan,
};

/**
 * Dispatch a request to the appropriate handler.
 * @param {string} endpoint - The endpoint name
 * @param {object} query - Query parameters (minus 'endpoint')
 * @returns {Promise<object>} Handler result
 * @throws {Error} If endpoint has no handler
 */
async function dispatch(endpoint, query) {
  const handler = handlers[endpoint];
  if (!handler) {
    throw new Error(`No handler for endpoint: ${endpoint}`);
  }
  return handler(query);
}

module.exports = { dispatch, handlers };
