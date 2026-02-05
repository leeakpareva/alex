/**
 * Human Capital Handlers — Futuristic workforce and skills indices from 2036.
 * ALEX-ECON roleplays as an economist from the future with access to
 * human capital databases that don't exist yet. All data is AI-generated fiction.
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
// 1. skill-half-life
// ---------------------------------------------------------------------------

async function skillHalfLife(query) {
  const missing = requireParam(query, 'skill');
  if (missing) return missing;

  const systemPrompt = FUTURE_ECONOMIST + '\n\nYou specialise in skill economics — measuring how quickly professional skills lose market value as AI capabilities evolve. You track "skill half-life" (months until a skill loses 50% of its market value), decay curves, and optimal transition paths to future-proof careers.';

  const userMessage = `Report the Skill Half-Life for skill: ${query.skill}. Return JSON in this exact format:
{"skill":"...","half_life_months":N,"current_market_value_index":N,"decay_rate":"...","decay_curve":"...","peak_value_year":N,"projected_obsolescence_year":N,"transition_paths":[{"to_skill":"...","effort_months":N,"salary_premium_pct":N}],"ai_replacement_level_pct":N,"human_advantage_remaining":"...","demand_trend":"...","confidence_interval":"..."}`;

  try {
    return await callHaikuJSON(systemPrompt, userMessage, { maxTokens: 1536 });
  } catch {
    return { error: 'Future data service temporarily unavailable', fallback: true };
  }
}

// ---------------------------------------------------------------------------
// 2. cognitive-augmentation-index
// ---------------------------------------------------------------------------

async function cognitiveAugmentationIndex(query) {
  const missing = requireParam(query, 'profession');
  if (missing) return missing;

  const type = query.type || 'all';

  const systemPrompt = FUTURE_ECONOMIST + '\n\nYou specialise in measuring cognitive augmentation — the productivity multiplier that human-AI collaboration tools provide across professions. You track adoption rates, cognitive load reduction, and the gap between augmented and non-augmented workers.';

  const userMessage = `Report the Cognitive Augmentation Index for profession: ${query.profession}, type: ${type}. Return JSON in this exact format:
{"profession":"...","augmentation_type":"...","productivity_multiplier":N,"adoption_rate_pct":N,"cognitive_load_reduction_pct":N,"tools_used":[{"tool":"...","category":"...","impact_score":N}],"augmented_vs_unaugmented_salary_gap_pct":N,"learning_curve_weeks":N,"burnout_reduction_pct":N,"quality_improvement_pct":N,"yoy_multiplier_growth":N,"confidence_interval":"..."}`;

  try {
    return await callHaikuJSON(systemPrompt, userMessage, { maxTokens: 1536 });
  } catch {
    return { error: 'Future data service temporarily unavailable', fallback: true };
  }
}

// ---------------------------------------------------------------------------
// 3. human-premium-index
// ---------------------------------------------------------------------------

async function humanPremiumIndex(query) {
  const missing = requireParam(query, 'category');
  if (missing) return missing;

  const systemPrompt = FUTURE_ECONOMIST + '\n\nYou specialise in the Human Premium — the price premium that consumers pay for verified human-created goods and services vs AI-generated equivalents. You track premiums across categories like art, writing, food, therapy, education, and craftsmanship.';

  const userMessage = `Report the Human Premium Index for category: ${query.category}. Return JSON in this exact format:
{"category":"...","human_premium_pct":N,"market_share_human_pct":N,"market_share_ai_pct":N,"verification_method":"...","premium_trend":"...","consumer_willingness_to_pay":N,"top_subcategories":[{"name":"...","premium_pct":N}],"certification_bodies":["..."],"fraud_rate_pct":N,"market_size_usd":"...","yoy_premium_change_pct":N,"confidence_interval":"..."}`;

  try {
    return await callHaikuJSON(systemPrompt, userMessage, { maxTokens: 1536 });
  } catch {
    return { error: 'Future data service temporarily unavailable', fallback: true };
  }
}

// ---------------------------------------------------------------------------
// 4. reskilling-roi
// ---------------------------------------------------------------------------

async function reskillingRoi(query) {
  const missingFrom = requireParam(query, 'from_career');
  if (missingFrom) return missingFrom;
  const missingTo = requireParam(query, 'to_career');
  if (missingTo) return missingTo;

  const country = query.country || 'USA';

  const systemPrompt = FUTURE_ECONOMIST + '\n\nYou specialise in career transition economics — calculating the ROI of reskilling from one career to another in the AI economy. You factor in training costs, opportunity costs, salary differentials, job security, and net present value of the career switch.';

  const userMessage = `Report the Reskilling ROI for transitioning from "${query.from_career}" to "${query.to_career}" in ${country}. Return JSON in this exact format:
{"from_career":"...","to_career":"...","country":"...","training_cost_usd":N,"training_duration_months":N,"opportunity_cost_usd":N,"current_salary_usd":N,"projected_salary_usd":N,"salary_change_pct":N,"npv_10yr_usd":N,"roi_pct":N,"breakeven_months":N,"job_security_score":N,"ai_displacement_risk_from":N,"ai_displacement_risk_to":N,"recommended_programs":["..."],"success_rate_pct":N,"confidence_interval":"..."}`;

  try {
    return await callHaikuJSON(systemPrompt, userMessage, { maxTokens: 1536 });
  } catch {
    return { error: 'Future data service temporarily unavailable', fallback: true };
  }
}

// ---------------------------------------------------------------------------
// 5. workforce-composition
// ---------------------------------------------------------------------------

async function workforceComposition(query) {
  const missing = requireParam(query, 'industry');
  if (missing) return missing;

  const country = query.country || 'global';

  const systemPrompt = FUTURE_ECONOMIST + '\n\nYou specialise in workforce composition analysis — tracking the breakdown of workers into four categories: fully human, AI-assisted human, human-supervised AI, and fully autonomous AI. You monitor the shifting balance across industries.';

  const userMessage = `Report the Workforce Composition for industry: ${query.industry}, country/region: ${country}. Return JSON in this exact format:
{"industry":"...","country":"...","year":2036,"composition":{"fully_human_pct":N,"ai_assisted_human_pct":N,"human_supervised_ai_pct":N,"autonomous_ai_pct":N},"total_workforce":N,"yoy_shift":{"human_to_assisted":N,"assisted_to_supervised":N,"supervised_to_autonomous":N},"avg_team_ratio":"...","projected_2040":{"fully_human_pct":N,"autonomous_ai_pct":N},"key_roles_by_category":{"fully_human":["..."],"autonomous_ai":["..."]},"confidence_interval":"..."}`;

  try {
    return await callHaikuJSON(systemPrompt, userMessage, { maxTokens: 1536 });
  } catch {
    return { error: 'Future data service temporarily unavailable', fallback: true };
  }
}

// ---------------------------------------------------------------------------
// 6. talent-migration-flow
// ---------------------------------------------------------------------------

async function talentMigrationFlow(query) {
  const missing = requireParam(query, 'origin');
  if (missing) return missing;

  const type = query.type || 'all';

  const systemPrompt = FUTURE_ECONOMIST + '\n\nYou specialise in talent migration economics — tracking where skilled workers relocate in response to AI disruption. You analyse push factors (automation, job loss), pull factors (AI hubs, compute subsidies, reskilling programs), and the resulting brain drain/gain dynamics.';

  const userMessage = `Report the Talent Migration Flow from origin: ${query.origin}, type: ${type}. Return JSON in this exact format:
{"origin":"...","type":"...","net_migration":N,"top_destinations":[{"country":"...","migrants":N,"pull_factors":["..."]}],"push_factors":["..."],"skill_categories_leaving":["..."],"skill_categories_arriving":["..."],"brain_drain_index":N,"ai_hub_gravity_score":N,"remote_work_offset_pct":N,"policy_incentives":["..."],"yoy_change_pct":N,"confidence_interval":"..."}`;

  try {
    return await callHaikuJSON(systemPrompt, userMessage, { maxTokens: 1536 });
  } catch {
    return { error: 'Future data service temporarily unavailable', fallback: true };
  }
}

module.exports = {
  skillHalfLife,
  cognitiveAugmentationIndex,
  humanPremiumIndex,
  reskillingRoi,
  workforceComposition,
  talentMigrationFlow,
};
