/**
 * Education Handlers — Dictionary lookups, book summaries, and study plans.
 * CommonJS module. Each handler takes (query) and returns a plain object.
 * Uses the free Dictionary API for word definitions and Claude Haiku for
 * AI-generated book summaries and study plans.
 */

const { callHaikuJSON } = require('./ai-helper');

const DICTIONARY_API_BASE = 'https://api.dictionaryapi.dev/api/v2/entries/en';

// ---------------------------------------------------------------------------
// 1. wordDefinition
// ---------------------------------------------------------------------------

/**
 * Look up the definition of a word using the free Dictionary API.
 * Extracts phonetic information, audio URL, and structured meanings
 * with parts of speech, definitions, examples, and synonyms.
 *
 * @param {object} query - Query parameters
 * @param {string} query.word - The word to define (required)
 * @returns {Promise<object>} Word definition with phonetic, audio_url, meanings,
 *   and source_url. On failure: { error, suggestion, fallback }
 */
async function wordDefinition(query) {
  const { word } = query || {};
  if (!word) {
    return { error: 'Missing required parameter: word' };
  }

  const url = `${DICTIONARY_API_BASE}/${encodeURIComponent(word)}`;

  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    return {
      error: 'Word not found',
      suggestion: 'Check spelling and try again',
      fallback: true,
    };
  }

  if (!res.ok) {
    return {
      error: 'Word not found',
      suggestion: 'Check spelling and try again',
      fallback: true,
    };
  }

  let data;
  try {
    data = await res.json();
  } catch (err) {
    return {
      error: 'Word not found',
      suggestion: 'Check spelling and try again',
      fallback: true,
    };
  }

  if (!Array.isArray(data) || data.length === 0) {
    return {
      error: 'Word not found',
      suggestion: 'Check spelling and try again',
      fallback: true,
    };
  }

  const entry = data[0];

  // Extract phonetic text — prefer the top-level phonetic, fall back to phonetics array
  const phonetic = entry.phonetic
    || (entry.phonetics && entry.phonetics.find((p) => p.text)?.text)
    || null;

  // Extract audio URL — find the first phonetics entry with a non-empty audio field
  const audio_url = (entry.phonetics && entry.phonetics.find((p) => p.audio)?.audio)
    || null;

  // Build structured meanings
  const meanings = (entry.meanings || []).map((m) => ({
    part_of_speech: m.partOfSpeech || null,
    definitions: (m.definitions || []).map((d) => ({
      definition: d.definition || null,
      example: d.example || null,
      synonyms: d.synonyms && d.synonyms.length > 0 ? d.synonyms : [],
    })),
  }));

  // Source URL — use the first sourceUrls entry if available
  const source_url = (entry.sourceUrls && entry.sourceUrls.length > 0)
    ? entry.sourceUrls[0]
    : `https://en.wiktionary.org/wiki/${encodeURIComponent(word)}`;

  return {
    word: entry.word || word,
    phonetic,
    audio_url,
    meanings,
    source_url,
  };
}

// ---------------------------------------------------------------------------
// 2. bookSummary
// ---------------------------------------------------------------------------

/**
 * Generate an AI-powered book summary using Claude Haiku.
 * Returns structured information including author, genre, themes,
 * notable quotes, and a brief explanation of the book's significance.
 *
 * @param {object} query - Query parameters
 * @param {string} query.title - The book title to summarize (required)
 * @returns {Promise<object>} Book summary with title, author, year_published,
 *   genre, summary, themes, notable_quotes, why_read, page_count_approx,
 *   and source_note. On failure: { error, fallback }
 */
async function bookSummary(query) {
  const { title } = query || {};
  if (!title) {
    return { error: 'Missing required parameter: title' };
  }

  const systemPrompt =
    'You are a literary expert and book reviewer. Provide informative summaries of well-known books. Focus on educational value.';

  const userMessage =
    `Provide a summary of the book "${title}". ` +
    'Return a JSON object with these exact fields: ' +
    '{"title":"...", "author":"...", "year_published":YYYY, "genre":"...", ' +
    '"summary":"3-4 sentence summary", "themes":["theme1","theme2","theme3"], ' +
    '"notable_quotes":["quote1","quote2"], ' +
    '"why_read":"one sentence on why this book matters", "page_count_approx": N}';

  try {
    const result = await callHaikuJSON(systemPrompt, userMessage);
    return {
      ...result,
      source_note: 'AI-generated summary for educational purposes',
    };
  } catch (err) {
    return { error: 'Could not generate book summary', fallback: true };
  }
}

// ---------------------------------------------------------------------------
// 3. studyPlan
// ---------------------------------------------------------------------------

/**
 * Generate an AI-powered structured study plan using Claude Haiku.
 * Creates weekly objectives, activities, and resources for learning
 * a given subject at a specified difficulty level.
 *
 * @param {object} query - Query parameters
 * @param {string} query.subject - The subject to study (required)
 * @param {number} [query.weeks=4] - Number of weeks for the plan (1-12)
 * @param {string} [query.level="beginner"] - Difficulty level:
 *   "beginner" | "intermediate" | "advanced"
 * @returns {Promise<object>} Study plan with subject, level, total_weeks,
 *   overview, weeks array, tips, and source_note. On failure: { error, fallback }
 */
async function studyPlan(query) {
  const { subject, weeks: rawWeeks, level: rawLevel } = query || {};
  if (!subject) {
    return { error: 'Missing required parameter: subject' };
  }

  // Clamp weeks to 1-12 range
  const weeks = Math.min(Math.max(parseInt(rawWeeks, 10) || 4, 1), 12);

  // Validate and default level
  const validLevels = ['beginner', 'intermediate', 'advanced'];
  const level = validLevels.includes(rawLevel) ? rawLevel : 'beginner';

  const systemPrompt =
    "You are an expert academic tutor following ALEX's education-first philosophy. " +
    'Create structured, actionable study plans that break complex subjects into manageable weekly objectives.';

  const userMessage =
    `Create a ${weeks}-week study plan for "${subject}" at the ${level} level. ` +
    'Return a JSON object with these exact fields: ' +
    '{"subject":"...", "level":"...", "total_weeks":N, ' +
    '"overview":"brief description of what the student will learn", ' +
    '"weeks":[{"week":1, "title":"week theme", "objectives":["obj1","obj2"], ' +
    '"activities":["activity1","activity2"], "resources":["resource suggestion"]},...], ' +
    '"tips":["study tip 1","study tip 2"]}';

  try {
    const result = await callHaikuJSON(systemPrompt, userMessage);
    return {
      ...result,
      source_note: 'AI-generated study plan. Adjust pace to your needs.',
    };
  } catch (err) {
    return { error: 'Could not generate study plan', fallback: true };
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { wordDefinition, bookSummary, studyPlan };
