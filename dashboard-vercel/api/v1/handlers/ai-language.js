/**
 * AI Language Handlers — Text summarisation, sentiment analysis, translation,
 * concept explanation, and quiz generation powered by Claude Haiku.
 *
 * CommonJS module. Each handler takes a query object and returns a plain object.
 */

const { callHaikuJSON } = require('./ai-helper');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Validate that a required parameter is present in the query object.
 * @param {object} query - The incoming query parameters
 * @param {string} param - The parameter name to check
 * @returns {object|null} An error object if missing, or null if present
 */
function requireParam(query, param) {
  if (!query[param]) {
    return { error: `Missing required parameter: ${param}` };
  }
  return null;
}

/**
 * Validate that a text parameter meets the minimum length requirement.
 * @param {string} text - The text to validate
 * @param {number} [minLength=3] - Minimum character count
 * @returns {object|null} An error object if too short, or null if valid
 */
function validateTextLength(text, minLength = 3) {
  if (typeof text === 'string' && text.trim().length < minLength) {
    return { error: 'Text too short. Please provide at least a sentence.' };
  }
  return null;
}

// ---------------------------------------------------------------------------
// 1. textSummary
// ---------------------------------------------------------------------------

/**
 * Summarise a block of text into key points and a concise summary.
 *
 * @param {object} query
 * @param {string} query.text - The text to summarise (required, min 3 chars)
 * @returns {Promise<object>} Parsed JSON with summary, key_points,
 *   word_count_original, and word_count_summary — or an error object.
 */
async function textSummary(query) {
  const missing = requireParam(query, 'text');
  if (missing) return missing;

  const tooShort = validateTextLength(query.text);
  if (tooShort) return tooShort;

  const systemPrompt =
    'You are a concise text summariser. Extract the key points from the given text.';

  const userMessage =
    `Summarise the following text and return JSON in this exact format:\n` +
    `{"summary":"...", "key_points":["point1","point2",...], "word_count_original": N, "word_count_summary": N}\n\n` +
    `Text:\n${query.text}`;

  try {
    return await callHaikuJSON(systemPrompt, userMessage);
  } catch {
    return { error: 'AI service temporarily unavailable', fallback: true };
  }
}

// ---------------------------------------------------------------------------
// 2. sentimentAnalysis
// ---------------------------------------------------------------------------

/**
 * Analyse the sentiment of the provided text.
 *
 * @param {object} query
 * @param {string} query.text - The text to analyse (required, min 3 chars)
 * @returns {Promise<object>} Parsed JSON with sentiment, score, confidence,
 *   emotions, and explanation — or an error object.
 */
async function sentimentAnalysis(query) {
  const missing = requireParam(query, 'text');
  if (missing) return missing;

  const tooShort = validateTextLength(query.text);
  if (tooShort) return tooShort;

  const systemPrompt =
    'You are a sentiment analysis expert. Analyse the sentiment of the given text.';

  const userMessage =
    `Analyse the sentiment of the following text and return JSON in this exact format:\n` +
    `{"sentiment":"positive"|"negative"|"neutral"|"mixed", "score": 0.0-1.0, "confidence": 0.0-1.0, "emotions":["emotion1","emotion2"], "explanation":"brief explanation"}\n\n` +
    `Text:\n${query.text}`;

  try {
    return await callHaikuJSON(systemPrompt, userMessage);
  } catch {
    return { error: 'AI service temporarily unavailable', fallback: true };
  }
}

// ---------------------------------------------------------------------------
// 3. translate
// ---------------------------------------------------------------------------

/**
 * Translate text from one language to another.
 *
 * @param {object} query
 * @param {string} query.text - The text to translate (required)
 * @param {string} query.to   - Target language code or name, e.g. "es", "French", "ja" (required)
 * @param {string} [query.from="auto-detect"] - Source language (optional)
 * @returns {Promise<object>} Parsed JSON with original, translated,
 *   from_language, to_language, and optionally transliteration — or an error object.
 */
async function translate(query) {
  const missingText = requireParam(query, 'text');
  if (missingText) return missingText;

  const missingTo = requireParam(query, 'to');
  if (missingTo) return missingTo;

  const fromLang = query.from || 'auto-detect';

  const systemPrompt =
    'You are a professional translator. Translate text accurately while preserving meaning and tone.';

  const userMessage =
    `Translate the following text from ${fromLang} to ${query.to} and return JSON in this exact format:\n` +
    `{"original":"...", "translated":"...", "from_language":"...", "to_language":"...", "transliteration":"..." }\n` +
    `Include the "transliteration" field only if the target script is non-Latin. Otherwise omit it.\n\n` +
    `Text:\n${query.text}`;

  try {
    return await callHaikuJSON(systemPrompt, userMessage);
  } catch {
    return { error: 'AI service temporarily unavailable', fallback: true };
  }
}

// ---------------------------------------------------------------------------
// 4. explainConcept
// ---------------------------------------------------------------------------

/**
 * Explain a concept at the requested difficulty level with analogies and examples.
 *
 * @param {object} query
 * @param {string} query.topic - The topic to explain (required)
 * @param {string} [query.level="beginner"] - Difficulty: "beginner"|"intermediate"|"advanced"
 * @returns {Promise<object>} Parsed JSON with topic, explanation, analogy,
 *   key_points, related_topics, and difficulty_level — or an error object.
 */
async function explainConcept(query) {
  const missing = requireParam(query, 'topic');
  if (missing) return missing;

  const level = query.level || 'beginner';

  const systemPrompt =
    "You are an educational expert following ALEX's teaching philosophy: make complex ideas " +
    'accessible through clear analogies and real-world examples. Target audience: students and curious learners.';

  const userMessage =
    `Explain the topic "${query.topic}" at a ${level} level and return JSON in this exact format:\n` +
    `{"topic":"...", "explanation":"clear 2-3 sentence explanation", "analogy":"a relatable real-world analogy", ` +
    `"key_points":["point1","point2","point3"], "related_topics":["topic1","topic2"], ` +
    `"difficulty_level":"beginner|intermediate|advanced"}`;

  try {
    return await callHaikuJSON(systemPrompt, userMessage);
  } catch {
    return { error: 'AI service temporarily unavailable', fallback: true };
  }
}

// ---------------------------------------------------------------------------
// 5. quizGenerator
// ---------------------------------------------------------------------------

/**
 * Generate multiple-choice quiz questions on a given subject.
 *
 * @param {object} query
 * @param {string} query.subject - The subject to quiz on (required)
 * @param {number} [query.count=5] - Number of questions (1-10, default 5)
 * @param {string} [query.difficulty="medium"] - Difficulty: "easy"|"medium"|"hard"
 * @returns {Promise<object>} Parsed JSON with subject, difficulty, and questions
 *   array — or an error object.
 */
async function quizGenerator(query) {
  const missing = requireParam(query, 'subject');
  if (missing) return missing;

  const count = Math.min(Math.max(parseInt(query.count, 10) || 5, 1), 10);
  const difficulty = query.difficulty || 'medium';

  const systemPrompt =
    'You are an educational quiz creator. Generate engaging multiple-choice questions ' +
    'that test understanding, not just memorisation.';

  const userMessage =
    `Generate ${count} multiple-choice questions about "${query.subject}" at ${difficulty} difficulty.\n` +
    `Return JSON in this exact format:\n` +
    `{"subject":"...", "difficulty":"...", "questions":[{"question":"...", "options":["A","B","C","D"], ` +
    `"correct_answer":"A", "explanation":"why this is correct"}]}`;

  try {
    return await callHaikuJSON(systemPrompt, userMessage, { maxTokens: 2048 });
  } catch {
    return { error: 'AI service temporarily unavailable', fallback: true };
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  textSummary,
  sentimentAnalysis,
  translate,
  explainConcept,
  quizGenerator,
};
