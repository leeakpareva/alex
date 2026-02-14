/**
 * AI Helper — Shared Claude Haiku caller for AI-powered endpoints.
 * Uses native fetch() to call the Anthropic Messages API directly.
 * No SDK dependency required.
 */

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-3-5-haiku-20241022';
const MAX_TOKENS = 1024;

/**
 * Call Claude Haiku with a system prompt and user message.
 * @param {string} systemPrompt - System instructions for the AI
 * @param {string} userMessage - The user's query/input
 * @param {object} [options] - Optional overrides
 * @param {number} [options.maxTokens] - Override max_tokens (default 1024)
 * @returns {Promise<string>} The AI's text response
 * @throws {Error} If API key is missing or API call fails
 */
async function callHaiku(systemPrompt, userMessage, options = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }

  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: options.maxTokens || MAX_TOKENS,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${errBody}`);
  }

  const data = await res.json();
  return data.content?.[0]?.text || '';
}

/**
 * Call Haiku and parse the response as JSON.
 * Extracts JSON from markdown code blocks if present.
 * @param {string} systemPrompt - System instructions
 * @param {string} userMessage - User query
 * @param {object} [options] - Optional overrides
 * @returns {Promise<object>} Parsed JSON response
 */
async function callHaikuJSON(systemPrompt, userMessage, options = {}) {
  const text = await callHaiku(
    systemPrompt + '\n\nIMPORTANT: Respond with valid JSON only. No markdown, no explanation, just the JSON object.',
    userMessage,
    options
  );

  // Try to extract JSON from code blocks or raw text
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
  const cleaned = jsonMatch[1].trim();
  return JSON.parse(cleaned);
}

module.exports = { callHaiku, callHaikuJSON };
