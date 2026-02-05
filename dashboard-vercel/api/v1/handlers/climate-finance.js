/**
 * Climate Finance Handlers — Futuristic climate and environmental indices from 2036.
 * ALEX-ECON roleplays as an economist from the future with access to
 * climate finance databases that don't exist yet. All data is AI-generated fiction.
 *
 * CommonJS module. Each handler takes a query object and returns a plain object.
 */

const { callHaikuJSON } = require('./ai-helper');

const FUTURE_ECONOMIST = `You are ALEX-ECON, an economist and data analyst from the year 2036 with access to future economic databases. In your timeline: AI handles 60% of knowledge work globally. Global AI GDP contribution is ~$42 trillion. Carbon credit markets are $8.2 trillion. 4.2 billion people have sovereign digital IDs. 41% of internet content is AI-generated. Neural interfaces have 380 million users. Quantum computing handles 12% of financial transactions. Universal Basic Compute exists in 23 countries. Always provide specific numbers, percentages, trends, year-over-year changes, and confidence intervals. Format all monetary values clearly. Never break character — you are reporting real data from your time period.`;

function requireParam(query, param) {
  if (!query[param]) return { error: `Missing required parameter: ${param}` };
  return null;
}

// ---------------------------------------------------------------------------
// 1. carbon-credit-market
// ---------------------------------------------------------------------------

async function carbonCreditMarket(query) {
  const market = query.market || 'global';
  const creditType = query.credit_type || 'all';

  const systemPrompt = FUTURE_ECONOMIST + '\n\nYou specialise in carbon credit markets — tracking spot prices, trading volumes, market capitalisation, and performance by credit type (direct air capture, nature-based solutions, industrial carbon capture, ocean alkalinity, enhanced weathering). The global carbon market in 2036 is $8.2 trillion.';

  const userMessage = `Report the Carbon Credit Market data for market: ${market}, credit type: ${creditType}. Return JSON in this exact format:
{"market":"...","credit_type":"...","spot_price_usd_per_ton":N,"market_cap_usd":"...","daily_volume_tons":N,"yoy_price_change_pct":N,"credit_types":[{"type":"...","price_usd":N,"volume_pct":N,"verification_standard":"..."}],"top_exchanges":["..."],"regulatory_price_floor_usd":N,"retirement_rate_pct":N,"fraud_rate_pct":N,"ai_verification_pct":N,"projected_2040_price_usd":N,"confidence_interval":"..."}`;

  try {
    return await callHaikuJSON(systemPrompt, userMessage, { maxTokens: 1536 });
  } catch {
    return { error: 'Future data service temporarily unavailable', fallback: true };
  }
}

// ---------------------------------------------------------------------------
// 2. planetary-boundary-index
// ---------------------------------------------------------------------------

async function planetaryBoundaryIndex(query) {
  const boundary = query.boundary || 'all';

  const systemPrompt = FUTURE_ECONOMIST + '\n\nYou specialise in the Planetary Boundary Index — tracking the status of the 9 planetary boundaries (climate change, biodiversity loss, land-system change, freshwater use, biogeochemical flows, ocean acidification, atmospheric aerosols, ozone depletion, novel entities). You quantify distance to tipping points and economic impact.';

  const userMessage = `Report the Planetary Boundary Index for boundary: ${boundary}. Return JSON in this exact format:
{"boundary":"...","boundaries":[{"name":"...","status":"safe|increasing_risk|high_risk|critical","current_value":N,"threshold":N,"distance_to_tipping_pct":N,"trend":"...","economic_impact_usd":"..."}],"overall_earth_system_score":N,"boundaries_breached":N,"boundaries_recovering":N,"ai_monitoring_coverage_pct":N,"annual_mitigation_spend_usd":"...","most_urgent":"...","comparison_2025":{"boundaries_breached":N},"confidence_interval":"..."}`;

  try {
    return await callHaikuJSON(systemPrompt, userMessage, { maxTokens: 1536 });
  } catch {
    return { error: 'Future data service temporarily unavailable', fallback: true };
  }
}

// ---------------------------------------------------------------------------
// 3. ecosystem-service-valuation
// ---------------------------------------------------------------------------

async function ecosystemServiceValuation(query) {
  const missing = requireParam(query, 'region');
  if (missing) return missing;

  const service = query.service || 'all';

  const systemPrompt = FUTURE_ECONOMIST + '\n\nYou specialise in ecosystem service valuation — calculating the dollar value of services provided by natural ecosystems (pollination, water filtration, carbon sequestration, flood protection, soil formation, recreation, genetic resources). You compare preservation costs against technological replacement costs.';

  const userMessage = `Report the Ecosystem Service Valuation for region: ${query.region}, service: ${service}. Return JSON in this exact format:
{"region":"...","service":"...","total_annual_value_usd":"...","services":[{"service":"...","annual_value_usd":"...","preservation_cost_usd":"...","replacement_cost_usd":"...","status":"..."}],"value_per_hectare_usd":N,"total_area_km2":N,"degradation_rate_pct_per_year":N,"investment_gap_usd":"...","roi_of_preservation":N,"ai_monitoring_coverage_pct":N,"payment_schemes_active":N,"confidence_interval":"..."}`;

  try {
    return await callHaikuJSON(systemPrompt, userMessage, { maxTokens: 1536 });
  } catch {
    return { error: 'Future data service temporarily unavailable', fallback: true };
  }
}

// ---------------------------------------------------------------------------
// 4. climate-adaptation-bond
// ---------------------------------------------------------------------------

async function climateAdaptationBond(query) {
  const region = query.region || 'global';
  const assetClass = query.asset_class || 'all';

  const systemPrompt = FUTURE_ECONOMIST + '\n\nYou specialise in climate adaptation bonds and resilience finance — tracking a new asset class that funds climate adaptation infrastructure. You measure yields, default rates, avoided damage ratios, and the growing market for parametric insurance and resilience bonds.';

  const userMessage = `Report the Climate Adaptation Bond market for region: ${region}, asset class: ${assetClass}. Return JSON in this exact format:
{"region":"...","asset_class":"...","market_size_usd":"...","avg_yield_pct":N,"default_rate_pct":N,"avoided_damage_ratio":N,"bond_types":[{"type":"...","outstanding_usd":"...","avg_yield_pct":N,"maturity_years":N}],"top_issuers":["..."],"insurance_linked_pct":N,"parametric_triggers":["..."],"investor_demand_index":N,"yoy_market_growth_pct":N,"total_damage_avoided_usd":"...","confidence_interval":"..."}`;

  try {
    return await callHaikuJSON(systemPrompt, userMessage, { maxTokens: 1536 });
  } catch {
    return { error: 'Future data service temporarily unavailable', fallback: true };
  }
}

// ---------------------------------------------------------------------------
// 5. energy-transition-tracker
// ---------------------------------------------------------------------------

async function energyTransitionTracker(query) {
  const missing = requireParam(query, 'country');
  if (missing) return missing;

  const systemPrompt = FUTURE_ECONOMIST + '\n\nYou specialise in energy transition economics — tracking each country\'s progress from fossil fuels to renewables. You measure renewable percentage, fossil phaseout timelines, AI-managed grid capacity, cost per kWh, energy storage capacity, and comparison with 2025 baselines.';

  const userMessage = `Report the Energy Transition Tracker for country: ${query.country}. Return JSON in this exact format:
{"country":"...","renewable_pct":N,"fossil_pct":N,"nuclear_pct":N,"fossil_phaseout_target_year":N,"on_track":true,"energy_mix":[{"source":"...","pct":N,"cost_per_kwh_usd":N}],"ai_grid_management_pct":N,"storage_capacity_gwh":N,"avg_cost_per_kwh_usd":N,"comparison_2025":{"renewable_pct":N,"cost_per_kwh_usd":N},"investment_ytd_usd":"...","jobs_in_clean_energy":N,"energy_independence_score":N,"confidence_interval":"..."}`;

  try {
    return await callHaikuJSON(systemPrompt, userMessage, { maxTokens: 1536 });
  } catch {
    return { error: 'Future data service temporarily unavailable', fallback: true };
  }
}

// ---------------------------------------------------------------------------
// 6. stranded-asset-risk
// ---------------------------------------------------------------------------

async function strandedAssetRisk(query) {
  const missing = requireParam(query, 'sector');
  if (missing) return missing;

  const region = query.region || 'global';

  const systemPrompt = FUTURE_ECONOMIST + '\n\nYou specialise in stranded asset risk — measuring the devaluation risk of fossil fuel assets, carbon-intensive infrastructure, and legacy industrial capacity. You track write-down timelines, insurance withdrawal, and the cascade effects on financial systems.';

  const userMessage = `Report the Stranded Asset Risk for sector: ${query.sector}, region: ${region}. Return JSON in this exact format:
{"sector":"...","region":"...","total_at_risk_usd":"...","already_stranded_usd":"...","write_down_timeline_years":N,"risk_score":N,"asset_categories":[{"category":"...","at_risk_usd":"...","stranded_pct":N,"timeline":"..."}],"insurance_withdrawal_pct":N,"banking_exposure_usd":"...","pension_fund_exposure_usd":"...","transition_opportunities":["..."],"policy_triggers":["..."],"yoy_risk_change_pct":N,"confidence_interval":"..."}`;

  try {
    return await callHaikuJSON(systemPrompt, userMessage, { maxTokens: 1536 });
  } catch {
    return { error: 'Future data service temporarily unavailable', fallback: true };
  }
}

module.exports = {
  carbonCreditMarket,
  planetaryBoundaryIndex,
  ecosystemServiceValuation,
  climateAdaptationBond,
  energyTransitionTracker,
  strandedAssetRisk,
};
