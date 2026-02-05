/**
 * AI Economy Handlers — Futuristic AI-powered economic indices from 2036.
 * ALEX-ECON roleplays as an economist from the future with access to
 * databases that don't exist yet. All data is AI-generated fiction.
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
// 1. ai-gdp-contribution
// ---------------------------------------------------------------------------

async function aiGdpContribution(query) {
  const country = query.country || 'global';
  const sector = query.sector || 'all';

  const systemPrompt = FUTURE_ECONOMIST + '\n\nYou specialise in measuring AI\'s contribution to national and global GDP. You track AI value-add across sectors including healthcare, finance, manufacturing, education, creative industries, and government services.';

  const userMessage = `Report AI's GDP contribution for ${country}, sector focus: ${sector}. Return JSON in this exact format:
{"country":"...","year":2036,"ai_gdp_share_pct":N,"ai_gdp_value_usd":"...","yoy_growth_pct":N,"sector_breakdown":[{"sector":"...","ai_share_pct":N,"value_usd":"..."}],"top_ai_industries":["..."],"comparison_2025":{"ai_gdp_share_pct":N,"growth_multiple":N},"confidence_interval":"...","methodology":"..."}`;

  try {
    return await callHaikuJSON(systemPrompt, userMessage, { maxTokens: 1536 });
  } catch {
    return { error: 'Future data service temporarily unavailable', fallback: true };
  }
}

// ---------------------------------------------------------------------------
// 2. automation-velocity-index
// ---------------------------------------------------------------------------

async function automationVelocityIndex(query) {
  const missing = requireParam(query, 'industry');
  if (missing) return missing;

  const region = query.region || 'global';

  const systemPrompt = FUTURE_ECONOMIST + '\n\nYou specialise in tracking the rate of job task automation across industries. You measure tasks automated per quarter, projected saturation timelines, and the velocity of AI adoption in specific workflows.';

  const userMessage = `Report the Automation Velocity Index for industry: ${query.industry}, region: ${region}. Return JSON in this exact format:
{"industry":"...","region":"...","automation_velocity_score":N,"tasks_automated_per_quarter":N,"total_tasks_automated_pct":N,"saturation_timeline":"...","automation_phases":[{"phase":"...","status":"...","pct_complete":N}],"fastest_automating_roles":["..."],"resistant_roles":["..."],"yoy_acceleration_pct":N,"confidence_interval":"..."}`;

  try {
    return await callHaikuJSON(systemPrompt, userMessage, { maxTokens: 1536 });
  } catch {
    return { error: 'Future data service temporarily unavailable', fallback: true };
  }
}

// ---------------------------------------------------------------------------
// 3. ai-labor-displacement-rate
// ---------------------------------------------------------------------------

async function aiLaborDisplacementRate(query) {
  const missing = requireParam(query, 'country');
  if (missing) return missing;

  const timeframe = query.timeframe || '2030-2036';

  const systemPrompt = FUTURE_ECONOMIST + '\n\nYou specialise in labour market transitions driven by AI. You track net jobs displaced vs created, reskilling rates, and the evolution of the workforce composition.';

  const userMessage = `Report the AI Labor Displacement Rate for country: ${query.country}, timeframe: ${timeframe}. Return JSON in this exact format:
{"country":"...","timeframe":"...","net_jobs_displaced":N,"jobs_lost":N,"jobs_created":N,"displacement_rate_pct":N,"reskilling_rate_pct":N,"avg_reskilling_duration_months":N,"top_displaced_roles":["..."],"top_created_roles":["..."],"wage_impact":{"median_change_pct":N,"bottom_quartile_pct":N,"top_quartile_pct":N},"government_response":"...","confidence_interval":"..."}`;

  try {
    return await callHaikuJSON(systemPrompt, userMessage, { maxTokens: 1536 });
  } catch {
    return { error: 'Future data service temporarily unavailable', fallback: true };
  }
}

// ---------------------------------------------------------------------------
// 4. model-market-index
// ---------------------------------------------------------------------------

async function modelMarketIndex(query) {
  const model = query.model || 'all';
  const metric = query.metric || 'overview';

  const systemPrompt = FUTURE_ECONOMIST + '\n\nYou specialise in the AI model marketplace — a Bloomberg-style index tracking AI model valuations, compute costs, capability benchmarks, and market dynamics. Major model families include successors to GPT, Claude, Gemini, DeepSeek, and open-source coalitions.';

  const userMessage = `Report the Model Market Index for model: ${model}, metric focus: ${metric}. Return JSON in this exact format:
{"index_name":"Model Market Index","date":"2036-Q1","overall_index_value":N,"yoy_change_pct":N,"top_models":[{"name":"...","developer":"...","valuation_usd":"...","compute_cost_per_1m_tokens":"...","capability_score":N}],"market_cap_total_usd":"...","compute_cost_trend":"...","open_source_share_pct":N,"enterprise_adoption_pct":N,"emerging_architectures":["..."],"confidence_interval":"..."}`;

  try {
    return await callHaikuJSON(systemPrompt, userMessage, { maxTokens: 1536 });
  } catch {
    return { error: 'Future data service temporarily unavailable', fallback: true };
  }
}

// ---------------------------------------------------------------------------
// 5. ai-dependency-score
// ---------------------------------------------------------------------------

async function aiDependencyScore(query) {
  const missing = requireParam(query, 'entity');
  if (missing) return missing;

  const type = query.type || 'country';

  const systemPrompt = FUTURE_ECONOMIST + '\n\nYou specialise in systemic AI dependency risk assessment. You measure how dependent countries, industries, or corporations are on AI systems, and what would happen if those systems failed. You track human fallback capacity, single-point-of-failure risks, and resilience scores.';

  const userMessage = `Report the AI Dependency Score for entity: ${query.entity}, type: ${type}. Return JSON in this exact format:
{"entity":"...","type":"...","dependency_score":N,"risk_level":"...","infrastructure_breakdown":{"critical_ai_systems":N,"human_fallback_capacity_pct":N,"recovery_time_hours":N},"single_points_of_failure":["..."],"sector_dependency":[{"sector":"...","dependency_pct":N}],"mitigation_measures":["..."],"comparison_2025":{"dependency_score":N,"change":N},"confidence_interval":"..."}`;

  try {
    return await callHaikuJSON(systemPrompt, userMessage, { maxTokens: 1536 });
  } catch {
    return { error: 'Future data service temporarily unavailable', fallback: true };
  }
}

// ---------------------------------------------------------------------------
// 6. compute-purchasing-power
// ---------------------------------------------------------------------------

async function computePurchasingPower(query) {
  const missing = requireParam(query, 'country');
  if (missing) return missing;

  const compareTo = query.compare_to || 'USA';

  const systemPrompt = FUTURE_ECONOMIST + '\n\nYou specialise in Compute Purchasing Power Parity (CPPP) — a 2036 economic metric that measures how many GPU-hours of AI compute a median worker can afford. This is the modern equivalent of the Big Mac Index but for the AI economy.';

  const userMessage = `Report the Compute Purchasing Power for country: ${query.country}, compare to: ${compareTo}. Return JSON in this exact format:
{"country":"...","compare_to":"...","gpu_hours_per_median_monthly_wage":N,"compute_gini_coefficient":N,"cppp_index":N,"global_rank":N,"cost_per_gpu_hour_usd":N,"median_monthly_wage_usd":N,"compute_access_pct":N,"subsidized_compute_available":true,"yoy_improvement_pct":N,"comparison":{"country":"...","gpu_hours_per_median_monthly_wage":N,"cppp_index":N},"confidence_interval":"..."}`;

  try {
    return await callHaikuJSON(systemPrompt, userMessage, { maxTokens: 1536 });
  } catch {
    return { error: 'Future data service temporarily unavailable', fallback: true };
  }
}

module.exports = {
  aiGdpContribution,
  automationVelocityIndex,
  aiLaborDisplacementRate,
  modelMarketIndex,
  aiDependencyScore,
  computePurchasingPower,
};
