/**
 * Post-Scarcity Indicators — Futuristic prosperity and abundance indices from 2036.
 * ALEX-ECON roleplays as an economist from the future with access to
 * post-scarcity databases that don't exist yet. All data is AI-generated fiction.
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
// 1. ubi-effectiveness-index
// ---------------------------------------------------------------------------

async function ubiEffectivenessIndex(query) {
  const missing = requireParam(query, 'country');
  if (missing) return missing;

  const systemPrompt = FUTURE_ECONOMIST + '\n\nYou specialise in Universal Basic Income/Compute programme evaluation — tracking poverty reduction, entrepreneurship rates, mental health outcomes, labour market participation, and fiscal sustainability of UBI/UBC programs worldwide. By 2036, 23 countries have some form of universal basic income or compute.';

  const userMessage = `Report the UBI Effectiveness Index for country: ${query.country}. Return JSON in this exact format:
{"country":"...","program_type":"...","monthly_amount_usd":N,"coverage_pct":N,"poverty_reduction_pct":N,"entrepreneurship_change_pct":N,"mental_health_improvement_pct":N,"labor_participation_change_pct":N,"fiscal_cost_gdp_pct":N,"funding_sources":["..."],"child_poverty_impact_pct":N,"public_approval_pct":N,"started_year":N,"key_outcomes":["..."],"comparison_pre_program":{"poverty_rate":N,"entrepreneurship_rate":N},"confidence_interval":"..."}`;

  try {
    return await callHaikuJSON(systemPrompt, userMessage, { maxTokens: 1536 });
  } catch {
    return { error: 'Future data service temporarily unavailable', fallback: true };
  }
}

// ---------------------------------------------------------------------------
// 2. abundance-index
// ---------------------------------------------------------------------------

async function abundanceIndex(query) {
  const missing = requireParam(query, 'country');
  if (missing) return missing;

  const need = query.need || 'all';

  const systemPrompt = FUTURE_ECONOMIST + '\n\nYou specialise in the Abundance Index — measuring how close countries are to post-scarcity across 6 basic needs: food, housing, energy, healthcare, education, and compute. You track cost as a percentage of income, access rates, quality scores, and the role of AI in driving costs toward zero.';

  const userMessage = `Report the Abundance Index for country: ${query.country}, need: ${need}. Return JSON in this exact format:
{"country":"...","overall_abundance_score":N,"needs":[{"need":"...","abundance_score":N,"cost_pct_of_income":N,"access_rate_pct":N,"quality_score":N,"ai_cost_reduction_pct":N,"trend":"..."}],"global_rank":N,"years_to_full_abundance":N,"biggest_gap":"...","comparison_2025":{"overall_score":N,"improvement":N},"population_below_threshold_pct":N,"key_innovations":["..."],"confidence_interval":"..."}`;

  try {
    return await callHaikuJSON(systemPrompt, userMessage, { maxTokens: 1536 });
  } catch {
    return { error: 'Future data service temporarily unavailable', fallback: true };
  }
}

// ---------------------------------------------------------------------------
// 3. prosperity-beyond-gdp
// ---------------------------------------------------------------------------

async function prosperityBeyondGdp(query) {
  const missing = requireParam(query, 'country');
  if (missing) return missing;

  const compareTo = query.compare_to || 'global_avg';

  const systemPrompt = FUTURE_ECONOMIST + '\n\nYou specialise in post-GDP prosperity measurement — an 8-component index that has largely replaced GDP as the primary national success metric by 2036. Components: material wellbeing, health & longevity, education & skills, time sovereignty, social connection, environmental quality, digital equity, and civic trust.';

  const userMessage = `Report the Prosperity Beyond GDP index for country: ${query.country}, compare to: ${compareTo}. Return JSON in this exact format:
{"country":"...","compare_to":"...","prosperity_index":N,"global_rank":N,"components":[{"name":"...","score":N,"trend":"...","rank":N}],"gdp_per_capita_usd":N,"prosperity_per_capita":"...","gdp_prosperity_gap":"...","strongest_component":"...","weakest_component":"...","yoy_change":N,"comparison":{"entity":"...","prosperity_index":N},"adopted_as_primary_metric":true,"confidence_interval":"..."}`;

  try {
    return await callHaikuJSON(systemPrompt, userMessage, { maxTokens: 1536 });
  } catch {
    return { error: 'Future data service temporarily unavailable', fallback: true };
  }
}

// ---------------------------------------------------------------------------
// 4. creative-economy-index
// ---------------------------------------------------------------------------

async function creativeEconomyIndex(query) {
  const country = query.country || 'global';
  const sector = query.sector || 'all';

  const systemPrompt = FUTURE_ECONOMIST + '\n\nYou specialise in the creative economy — tracking the market for human creativity in a world where AI can generate most content. You measure market size, human vs AI creative output share, creator income distributions, and the emergence of new creative categories that didn\'t exist before AI.';

  const userMessage = `Report the Creative Economy Index for country: ${country}, sector: ${sector}. Return JSON in this exact format:
{"country":"...","sector":"...","market_size_usd":"...","human_share_pct":N,"ai_share_pct":N,"hybrid_share_pct":N,"creator_count":N,"avg_creator_income_usd":N,"median_creator_income_usd":N,"income_growth_yoy_pct":N,"top_sectors":[{"sector":"...","market_usd":"...","human_share_pct":N}],"new_categories_since_2025":["..."],"platform_revenue_share_avg_pct":N,"nft_and_provenance_pct":N,"confidence_interval":"..."}`;

  try {
    return await callHaikuJSON(systemPrompt, userMessage, { maxTokens: 1536 });
  } catch {
    return { error: 'Future data service temporarily unavailable', fallback: true };
  }
}

// ---------------------------------------------------------------------------
// 5. time-sovereignty-index
// ---------------------------------------------------------------------------

async function timeSovereigntyIndex(query) {
  const missing = requireParam(query, 'country');
  if (missing) return missing;

  const systemPrompt = FUTURE_ECONOMIST + '\n\nYou specialise in time sovereignty — measuring how much discretionary time citizens have per day, how many hours of tasks they delegate to AI, and how time use has changed since 2025. Time sovereignty is a key component of the post-GDP prosperity framework.';

  const userMessage = `Report the Time Sovereignty Index for country: ${query.country}. Return JSON in this exact format:
{"country":"...","time_sovereignty_score":N,"discretionary_hours_per_day":N,"ai_delegation_hours_per_day":N,"work_hours_per_week":N,"commute_hours_per_week":N,"time_breakdown":{"work":N,"ai_delegated":N,"leisure":N,"social":N,"sleep":N,"personal_growth":N},"comparison_2025":{"work_hours_per_week":N,"discretionary_hours_per_day":N},"four_day_week_adoption_pct":N,"remote_work_pct":N,"time_poverty_rate_pct":N,"global_rank":N,"yoy_improvement_pct":N,"confidence_interval":"..."}`;

  try {
    return await callHaikuJSON(systemPrompt, userMessage, { maxTokens: 1536 });
  } catch {
    return { error: 'Future data service temporarily unavailable', fallback: true };
  }
}

// ---------------------------------------------------------------------------
// 6. inequality-adjusted-ai-dividend
// ---------------------------------------------------------------------------

async function inequalityAdjustedAiDividend(query) {
  const missing = requireParam(query, 'country');
  if (missing) return missing;

  const systemPrompt = FUTURE_ECONOMIST + '\n\nYou specialise in the AI dividend — measuring how equitably the economic gains from AI are distributed within countries. You track Gini coefficient changes, bottom quintile benefit share, wealth concentration in AI ownership, tax policy effectiveness, and the gap between AI-haves and AI-have-nots.';

  const userMessage = `Report the Inequality-Adjusted AI Dividend for country: ${query.country}. Return JSON in this exact format:
{"country":"...","ai_dividend_index":N,"gini_coefficient":N,"gini_change_since_2025":N,"bottom_quintile_benefit_pct":N,"top_decile_capture_pct":N,"ai_wealth_concentration":{"top_1pct_ai_assets_pct":N,"top_10pct_ai_assets_pct":N},"policy_mechanisms":["..."],"ai_tax_revenue_usd":"...","redistribution_effectiveness_score":N,"digital_divide_index":N,"compute_access_equality":N,"social_mobility_score":N,"comparison_pre_ai":{"gini":N,"bottom_quintile_income_usd":N},"confidence_interval":"..."}`;

  try {
    return await callHaikuJSON(systemPrompt, userMessage, { maxTokens: 1536 });
  } catch {
    return { error: 'Future data service temporarily unavailable', fallback: true };
  }
}

module.exports = {
  ubiEffectivenessIndex,
  abundanceIndex,
  prosperityBeyondGdp,
  creativeEconomyIndex,
  timeSovereigntyIndex,
  inequalityAdjustedAiDividend,
};
