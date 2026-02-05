/**
 * Digital Society Handlers — Futuristic digital infrastructure indices from 2036.
 * ALEX-ECON roleplays as an economist from the future with access to
 * digital society databases that don't exist yet. All data is AI-generated fiction.
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
// 1. synthetic-media-index
// ---------------------------------------------------------------------------

async function syntheticMediaIndex(query) {
  const missing = requireParam(query, 'domain');
  if (missing) return missing;

  const systemPrompt = FUTURE_ECONOMIST + '\n\nYou specialise in synthetic media economics — tracking what percentage of content across domains (news, social media, entertainment, advertising, education) is AI-generated. You measure detection accuracy, consumer trust, and the economic impact of synthetic content.';

  const userMessage = `Report the Synthetic Media Index for domain: ${query.domain}. Return JSON in this exact format:
{"domain":"...","synthetic_content_pct":N,"detection_accuracy_pct":N,"consumer_trust_score":N,"content_breakdown":{"fully_ai_pct":N,"ai_assisted_pct":N,"fully_human_pct":N},"top_generation_tools":["..."],"regulation_status":"...","labelling_compliance_pct":N,"economic_impact_usd":"...","yoy_synthetic_growth_pct":N,"consumer_preference":{"prefers_human_pct":N,"no_preference_pct":N},"confidence_interval":"..."}`;

  try {
    return await callHaikuJSON(systemPrompt, userMessage, { maxTokens: 1536 });
  } catch {
    return { error: 'Future data service temporarily unavailable', fallback: true };
  }
}

// ---------------------------------------------------------------------------
// 2. digital-identity-index
// ---------------------------------------------------------------------------

async function digitalIdentityIndex(query) {
  const missing = requireParam(query, 'country');
  if (missing) return missing;

  const systemPrompt = FUTURE_ECONOMIST + '\n\nYou specialise in sovereign digital identity systems — tracking adoption rates, identity theft metrics, cross-border recognition treaties, data sovereignty frameworks, and the economic value of verified digital identity.';

  const userMessage = `Report the Digital Identity Index for country: ${query.country}. Return JSON in this exact format:
{"country":"...","sovereign_id_adoption_pct":N,"identity_theft_rate_per_100k":N,"cross_border_recognition_treaties":N,"data_sovereignty_score":N,"id_system_type":"...","biometric_methods":["..."],"privacy_score":N,"economic_value_per_citizen_usd":N,"digital_services_accessible":N,"fraud_reduction_since_2025_pct":N,"interoperability_score":N,"global_rank":N,"confidence_interval":"..."}`;

  try {
    return await callHaikuJSON(systemPrompt, userMessage, { maxTokens: 1536 });
  } catch {
    return { error: 'Future data service temporarily unavailable', fallback: true };
  }
}

// ---------------------------------------------------------------------------
// 3. algorithmic-governance-score
// ---------------------------------------------------------------------------

async function algorithmicGovernanceScore(query) {
  const missing = requireParam(query, 'country');
  if (missing) return missing;

  const domain = query.domain || 'overall';

  const systemPrompt = FUTURE_ECONOMIST + '\n\nYou specialise in algorithmic governance — measuring how transparently, fairly, and explainably governments use AI in public decision-making. You track domains like taxation, criminal justice, social benefits, immigration, healthcare allocation, and urban planning.';

  const userMessage = `Report the Algorithmic Governance Score for country: ${query.country}, domain: ${domain}. Return JSON in this exact format:
{"country":"...","domain":"...","overall_score":N,"transparency_score":N,"fairness_score":N,"explainability_score":N,"accountability_score":N,"domains_using_ai":[{"domain":"...","ai_decision_pct":N,"audit_frequency":"..."}],"citizen_satisfaction_pct":N,"appeal_success_rate_pct":N,"bias_incidents_per_year":N,"regulatory_framework":"...","global_rank":N,"confidence_interval":"..."}`;

  try {
    return await callHaikuJSON(systemPrompt, userMessage, { maxTokens: 1536 });
  } catch {
    return { error: 'Future data service temporarily unavailable', fallback: true };
  }
}

// ---------------------------------------------------------------------------
// 4. attention-economy-price
// ---------------------------------------------------------------------------

async function attentionEconomyPrice(query) {
  const platform = query.platform || 'all';
  const demographic = query.demographic || 'general';

  const systemPrompt = FUTURE_ECONOMIST + '\n\nYou specialise in the attention economy — tracking the price of verified human attention-minutes across platforms and demographics. In 2036, with AI-generated content flooding platforms, verified human attention has become a scarce and traded commodity.';

  const userMessage = `Report the Attention Economy Price for platform: ${platform}, demographic: ${demographic}. Return JSON in this exact format:
{"platform":"...","demographic":"...","price_per_verified_attention_minute_usd":N,"scarcity_index":N,"attention_fatigue_score":N,"daily_avg_attention_minutes":N,"ai_content_exposure_pct":N,"verification_method":"...","price_trend":"...","top_platforms":[{"name":"...","price_per_min_usd":N,"monthly_active_humans":N}],"advertiser_demand_index":N,"yoy_price_change_pct":N,"bot_traffic_pct":N,"confidence_interval":"..."}`;

  try {
    return await callHaikuJSON(systemPrompt, userMessage, { maxTokens: 1536 });
  } catch {
    return { error: 'Future data service temporarily unavailable', fallback: true };
  }
}

// ---------------------------------------------------------------------------
// 5. digital-commons-health
// ---------------------------------------------------------------------------

async function digitalCommonsHealth(query) {
  const domain = query.domain || 'overall';

  const systemPrompt = FUTURE_ECONOMIST + '\n\nYou specialise in the digital commons — tracking the health of open source software, open data, open knowledge (Wikipedia etc.), and open science. You measure AI vs human contributions, funding sustainability, corporate capture risk, and accessibility.';

  const userMessage = `Report the Digital Commons Health for domain: ${domain}. Return JSON in this exact format:
{"domain":"...","overall_health_score":N,"components":{"open_source":{"health":N,"ai_contribution_pct":N,"funding_gap_usd":"..."},"open_data":{"health":N,"datasets_available":N,"accessibility_score":N},"open_knowledge":{"health":N,"ai_edits_pct":N,"human_editors_active":N},"open_science":{"health":N,"papers_open_access_pct":N}},"total_contributors":N,"ai_vs_human_ratio":"...","corporate_capture_risk":N,"funding_total_usd":"...","biggest_threats":["..."],"yoy_health_change":N,"confidence_interval":"..."}`;

  try {
    return await callHaikuJSON(systemPrompt, userMessage, { maxTokens: 1536 });
  } catch {
    return { error: 'Future data service temporarily unavailable', fallback: true };
  }
}

// ---------------------------------------------------------------------------
// 6. trust-infrastructure-index
// ---------------------------------------------------------------------------

async function trustInfrastructureIndex(query) {
  const country = query.country || 'global';
  const sector = query.sector || 'all';

  const systemPrompt = FUTURE_ECONOMIST + '\n\nYou specialise in digital trust infrastructure — tracking the adoption and effectiveness of verification systems, zero-knowledge proofs, verifiable credentials, content provenance, and trust networks. In 2036, trust infrastructure is as critical as physical infrastructure.';

  const userMessage = `Report the Trust Infrastructure Index for country: ${country}, sector: ${sector}. Return JSON in this exact format:
{"country":"...","sector":"...","trust_index_score":N,"verification_adoption_pct":N,"zkp_usage_pct":N,"credential_fraud_rate_pct":N,"content_provenance_adoption_pct":N,"trust_systems":[{"system":"...","adoption_pct":N,"effectiveness_score":N}],"digital_signature_coverage_pct":N,"trust_cost_per_transaction_usd":N,"incidents_prevented_per_year":N,"investment_usd":"...","yoy_improvement_pct":N,"confidence_interval":"..."}`;

  try {
    return await callHaikuJSON(systemPrompt, userMessage, { maxTokens: 1536 });
  } catch {
    return { error: 'Future data service temporarily unavailable', fallback: true };
  }
}

module.exports = {
  syntheticMediaIndex,
  digitalIdentityIndex,
  algorithmicGovernanceScore,
  attentionEconomyPrice,
  digitalCommonsHealth,
  trustInfrastructureIndex,
};
