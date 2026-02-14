/**
 * Data & Reference Handlers — Country info, weather, news, historical events,
 * unit conversions, and timezone lookups.
 * Mix of free public APIs, AI-powered endpoints, and pure computation.
 */

const { callHaikuJSON } = require('./ai-helper');

// ---------------------------------------------------------------------------
// 1. countryInfo
// ---------------------------------------------------------------------------

/**
 * Look up detailed information about a country by name.
 * Uses the free REST Countries API (v3.1).
 *
 * @param {object} query - Query parameters
 * @param {string} query.name - Country name, e.g. "Japan" or "United States" (required)
 * @returns {Promise<object>} Country data including name, capital, population,
 *   area, region, languages, currencies, flag, timezones, borders, and map URL.
 *   Returns { error, fallback } on failure.
 */
async function countryInfo(query) {
  const { name } = query || {};

  if (!name) {
    return { error: 'Missing required parameter: name' };
  }

  try {
    const url = `https://restcountries.com/v3.1/name/${encodeURIComponent(name)}?fullText=false`;
    const res = await fetch(url);

    if (!res.ok) {
      return { error: 'Could not find country information', fallback: true };
    }

    const data = await res.json();

    if (!Array.isArray(data) || data.length === 0) {
      return { error: 'Could not find country information', fallback: true };
    }

    const country = data[0];

    // Parse languages into a flat array
    const languages = country.languages
      ? Object.values(country.languages)
      : [];

    // Parse currencies into [{name, symbol}]
    const currencies = country.currencies
      ? Object.values(country.currencies).map(c => ({
          name: c.name,
          symbol: c.symbol || '',
        }))
      : [];

    return {
      name: country.name?.common || name,
      official_name: country.name?.official || '',
      capital: (country.capital && country.capital[0]) || '',
      population: country.population || 0,
      area_km2: country.area || 0,
      region: country.region || '',
      subregion: country.subregion || '',
      languages,
      currencies,
      flag_emoji: country.flag || '',
      flag_url: country.flags?.png || country.flags?.svg || '',
      timezones: country.timezones || [],
      borders: country.borders || [],
      maps_url: country.maps?.googleMaps || '',
    };
  } catch {
    return { error: 'Could not find country information', fallback: true };
  }
}

// ---------------------------------------------------------------------------
// 2. weather
// ---------------------------------------------------------------------------

/**
 * Map Open-Meteo WMO weather codes to human-readable condition strings.
 * @param {number} code - WMO weather code
 * @returns {string} Weather condition description
 */
function weatherCodeToCondition(code) {
  if (code === 0) return 'Clear sky';
  if (code >= 1 && code <= 3) return 'Partly cloudy';
  if (code >= 45 && code <= 48) return 'Foggy';
  if (code >= 51 && code <= 55) return 'Drizzle';
  if (code >= 56 && code <= 57) return 'Freezing drizzle';
  if (code >= 61 && code <= 65) return 'Rain';
  if (code >= 66 && code <= 67) return 'Freezing rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 80 && code <= 82) return 'Rain showers';
  if (code >= 85 && code <= 86) return 'Snow showers';
  if (code === 95) return 'Thunderstorm';
  if (code >= 96 && code <= 99) return 'Thunderstorm with hail';
  return 'Unknown';
}

/**
 * Get current weather and a 3-day forecast for a city.
 * Two-step process: geocode the city via Open-Meteo, then fetch weather data.
 *
 * @param {object} query - Query parameters
 * @param {string} query.city - City name, e.g. "London" or "New York" (required)
 * @returns {Promise<object>} Current conditions and 3-day forecast.
 *   Returns { error, fallback } if the city cannot be found.
 */
async function weather(query) {
  const { city } = query || {};

  if (!city) {
    return { error: 'Missing required parameter: city' };
  }

  try {
    // Step 1 — Geocode
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`;
    const geoRes = await fetch(geoUrl);

    if (!geoRes.ok) {
      return { error: 'City not found', fallback: true };
    }

    const geoData = await geoRes.json();

    if (!geoData.results || geoData.results.length === 0) {
      return { error: 'City not found', fallback: true };
    }

    const location = geoData.results[0];
    const lat = location.latitude;
    const lon = location.longitude;
    const country = location.country || '';

    // Step 2 — Weather
    const weatherUrl =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum` +
      `&timezone=auto&forecast_days=3`;

    const weatherRes = await fetch(weatherUrl);

    if (!weatherRes.ok) {
      return { error: 'City not found', fallback: true };
    }

    const weatherData = await weatherRes.json();
    const current = weatherData.current || {};
    const daily = weatherData.daily || {};

    // Build forecast array
    const forecast = [];
    const dates = daily.time || [];
    const highs = daily.temperature_2m_max || [];
    const lows = daily.temperature_2m_min || [];
    const precip = daily.precipitation_sum || [];

    for (let i = 0; i < dates.length; i++) {
      forecast.push({
        date: dates[i],
        high: highs[i],
        low: lows[i],
        precipitation_mm: precip[i],
      });
    }

    return {
      city: location.name || city,
      country,
      latitude: lat,
      longitude: lon,
      current: {
        temp_c: current.temperature_2m,
        humidity: current.relative_humidity_2m,
        wind_speed_kmh: current.wind_speed_10m,
        condition: weatherCodeToCondition(current.weather_code),
      },
      forecast,
    };
  } catch {
    return { error: 'City not found', fallback: true };
  }
}

// ---------------------------------------------------------------------------
// 3. newsHeadlines
// ---------------------------------------------------------------------------

/**
 * Get recent notable news headlines using AI knowledge.
 * Uses Claude Haiku to generate headlines based on its training data.
 *
 * @param {object} query - Query parameters
 * @param {string} [query.topic] - Optional topic focus (e.g. "technology", "sports").
 *   Defaults to general news if omitted.
 * @returns {Promise<object>} Array of headline objects with title, source, category,
 *   and summary. Includes a note about AI knowledge limitations.
 */
async function newsHeadlines(query) {
  const { topic } = query || {};

  const topicStr = topic ? `about "${topic}"` : '(general/world news)';

  try {
    const systemPrompt =
      'You are a news analyst. Based on your knowledge, provide the most recent and ' +
      'notable news headlines you\'re aware of. Be honest about your knowledge cutoff date.';

    const userMessage =
      `Provide 5 to 8 notable recent news headlines ${topicStr}. ` +
      'Respond with JSON in this exact format: ' +
      '{"headlines":[{"title":"...","source":"...","category":"...","summary":"one sentence"},...], ' +
      '"note":"Based on AI knowledge, may not reflect latest breaking news"}';

    const result = await callHaikuJSON(systemPrompt, userMessage);
    return result;
  } catch {
    return {
      headlines: [],
      note: 'News service temporarily unavailable',
      fallback: true,
    };
  }
}

// ---------------------------------------------------------------------------
// 4. historicalEvents
// ---------------------------------------------------------------------------

/**
 * Get notable historical events that occurred on a specific date (month and day).
 * Uses Claude Haiku to provide well-documented historical events.
 *
 * @param {object} query - Query parameters
 * @param {string} query.date - Date in MM-DD format, e.g. "07-20" (required)
 * @returns {Promise<object>} Object with date and array of events, each containing
 *   year, event description, and significance. Returns error on invalid format.
 */
async function historicalEvents(query) {
  const { date } = query || {};

  if (!date) {
    return { error: 'Missing required parameter: date' };
  }

  // Validate MM-DD format
  const dateMatch = date.match(/^(\d{2})-(\d{2})$/);
  if (!dateMatch) {
    return { error: 'Invalid date format. Use MM-DD (e.g. 07-20)' };
  }

  const month = parseInt(dateMatch[1], 10);
  const day = parseInt(dateMatch[2], 10);

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return { error: 'Invalid date format. Use MM-DD (e.g. 07-20)' };
  }

  try {
    const systemPrompt =
      'You are a history educator. Provide notable historical events that occurred on a ' +
      'specific date. Focus on well-documented, significant events.';

    const userMessage =
      `Provide exactly 5 notable historical events that occurred on ${date} (month-day). ` +
      'Respond with JSON in this exact format: ' +
      `{"date":"${date}","events":[{"year":YYYY,"event":"description","significance":"why it matters"}]}`;

    const result = await callHaikuJSON(systemPrompt, userMessage);
    return result;
  } catch {
    return {
      date,
      events: [],
      fallback: true,
    };
  }
}

// ---------------------------------------------------------------------------
// 5. unitConvert
// ---------------------------------------------------------------------------

/**
 * Conversion factors to base units.
 * Each category maps unit names to their multiplier relative to the base unit.
 *
 * Length base: meters
 * Weight base: grams
 * Volume base: milliliters
 * Speed base: m/s
 * Data base: bytes
 * Area base: sqm (square meters)
 * Time base: seconds
 */
const UNIT_CATEGORIES = {
  length: {
    base: 'meters',
    units: {
      km: 1000,
      m: 1,
      cm: 0.01,
      mm: 0.001,
      miles: 1609.344,
      yards: 0.9144,
      feet: 0.3048,
      inches: 0.0254,
      nautical_miles: 1852,
    },
  },
  weight: {
    base: 'grams',
    units: {
      kg: 1000,
      g: 1,
      mg: 0.001,
      lb: 453.592,
      oz: 28.3495,
      stone: 6350.29,
      ton: 907184.74,
      metric_ton: 1000000,
    },
  },
  volume: {
    base: 'milliliters',
    units: {
      liters: 1000,
      ml: 1,
      gallons: 3785.41,
      quarts: 946.353,
      pints: 473.176,
      cups: 236.588,
      fl_oz: 29.5735,
      tablespoons: 14.7868,
      teaspoons: 4.92892,
    },
  },
  speed: {
    base: 'm/s',
    units: {
      kmh: 1 / 3.6,
      mph: 0.44704,
      ms: 1,
      knots: 0.514444,
    },
  },
  data: {
    base: 'bytes',
    units: {
      bytes: 1,
      kb: 1024,
      mb: 1024 ** 2,
      gb: 1024 ** 3,
      tb: 1024 ** 4,
      pb: 1024 ** 5,
    },
  },
  area: {
    base: 'sqm',
    units: {
      sqm: 1,
      sqkm: 1e6,
      sqft: 0.092903,
      sqmi: 2.59e6,
      hectares: 10000,
      acres: 4046.86,
    },
  },
  time: {
    base: 'seconds',
    units: {
      seconds: 1,
      minutes: 60,
      hours: 3600,
      days: 86400,
      weeks: 604800,
      years: 31557600,
    },
  },
};

/** Temperature is handled separately with direct formulas. */
const TEMPERATURE_UNITS = new Set(['celsius', 'fahrenheit', 'kelvin']);

/**
 * Find which category a unit belongs to.
 * @param {string} unit - The unit name (lowercase)
 * @returns {{ category: string, factor: number } | null}
 */
function findUnitCategory(unit) {
  for (const [category, info] of Object.entries(UNIT_CATEGORIES)) {
    if (info.units[unit] !== undefined) {
      return { category, factor: info.units[unit] };
    }
  }
  return null;
}

/**
 * Convert a temperature value between celsius, fahrenheit, and kelvin.
 * @param {number} value - The numeric value to convert
 * @param {string} from - Source unit
 * @param {string} to - Target unit
 * @returns {{ result: number, formula: string }}
 */
function convertTemperature(value, from, to) {
  // Convert to celsius first
  let celsius;
  switch (from) {
    case 'celsius':
      celsius = value;
      break;
    case 'fahrenheit':
      celsius = (value - 32) * (5 / 9);
      break;
    case 'kelvin':
      celsius = value - 273.15;
      break;
  }

  // Convert from celsius to target
  let result;
  let formula;
  switch (to) {
    case 'celsius':
      result = celsius;
      break;
    case 'fahrenheit':
      result = celsius * (9 / 5) + 32;
      break;
    case 'kelvin':
      result = celsius + 273.15;
      break;
  }

  // Build formula description
  if (from === 'celsius' && to === 'fahrenheit') {
    formula = '(C * 9/5) + 32 = F';
  } else if (from === 'fahrenheit' && to === 'celsius') {
    formula = '(F - 32) * 5/9 = C';
  } else if (from === 'celsius' && to === 'kelvin') {
    formula = 'C + 273.15 = K';
  } else if (from === 'kelvin' && to === 'celsius') {
    formula = 'K - 273.15 = C';
  } else if (from === 'fahrenheit' && to === 'kelvin') {
    formula = '(F - 32) * 5/9 + 273.15 = K';
  } else if (from === 'kelvin' && to === 'fahrenheit') {
    formula = '(K - 273.15) * 9/5 + 32 = F';
  } else {
    formula = 'Same unit, no conversion needed';
  }

  return { result, formula };
}

/**
 * Build the full list of supported units grouped by category, for error messages.
 * @returns {object} Map of category name to array of unit names
 */
function getSupportedUnits() {
  const supported = {};
  for (const [category, info] of Object.entries(UNIT_CATEGORIES)) {
    supported[category] = Object.keys(info.units);
  }
  supported.temperature = ['celsius', 'fahrenheit', 'kelvin'];
  return supported;
}

/**
 * Convert a numeric value from one unit to another.
 * Supports length, weight, temperature, volume, speed, data, area, and time
 * conversions using a base-unit strategy (convert to base, then to target).
 * Temperature uses direct formulas instead.
 *
 * @param {object} query - Query parameters
 * @param {number|string} query.value - The numeric value to convert (required)
 * @param {string} query.from - Source unit name (required)
 * @param {string} query.to - Target unit name (required)
 * @returns {object} Conversion result with from/to values, units, and formula.
 *   Returns error if units are incompatible or unrecognized.
 */
function unitConvert(query) {
  const { value: rawValue, from: rawFrom, to: rawTo } = query || {};

  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return { error: 'Missing required parameter: value' };
  }
  if (!rawFrom) {
    return { error: 'Missing required parameter: from' };
  }
  if (!rawTo) {
    return { error: 'Missing required parameter: to' };
  }

  const value = parseFloat(rawValue);
  if (isNaN(value)) {
    return { error: 'Parameter "value" must be a valid number' };
  }

  const from = rawFrom.toLowerCase().trim();
  const to = rawTo.toLowerCase().trim();

  // Same unit — trivial
  if (from === to) {
    return {
      from: { value, unit: from },
      to: { value, unit: to },
      formula: 'Same unit, no conversion needed',
    };
  }

  // Temperature — special handling
  const fromIsTemp = TEMPERATURE_UNITS.has(from);
  const toIsTemp = TEMPERATURE_UNITS.has(to);

  if (fromIsTemp && toIsTemp) {
    const { result, formula } = convertTemperature(value, from, to);
    return {
      from: { value, unit: from },
      to: { value: Math.round(result * 1e6) / 1e6, unit: to },
      formula,
    };
  }

  if (fromIsTemp || toIsTemp) {
    const otherUnit = fromIsTemp ? to : from;
    // Check if the other unit exists anywhere
    const otherInfo = findUnitCategory(otherUnit);
    if (otherInfo) {
      return {
        error: `Cannot convert between ${from} and ${to} (different unit types)`,
      };
    }
    // Other unit not recognized at all
    return {
      error: `Unrecognized unit: ${otherUnit}`,
      supported: getSupportedUnits(),
    };
  }

  // Standard category-based conversion
  const fromInfo = findUnitCategory(from);
  const toInfo = findUnitCategory(to);

  if (!fromInfo && !toInfo) {
    return {
      error: `Unrecognized unit: ${from}`,
      supported: getSupportedUnits(),
    };
  }
  if (!fromInfo) {
    return {
      error: `Unrecognized unit: ${from}`,
      supported: getSupportedUnits(),
    };
  }
  if (!toInfo) {
    return {
      error: `Unrecognized unit: ${to}`,
      supported: getSupportedUnits(),
    };
  }

  if (fromInfo.category !== toInfo.category) {
    return {
      error: `Cannot convert between ${from} and ${to} (different unit types)`,
    };
  }

  // Convert: value * fromFactor gives base units, then divide by toFactor
  const baseValue = value * fromInfo.factor;
  const result = baseValue / toInfo.factor;
  const baseName = UNIT_CATEGORIES[fromInfo.category].base;

  return {
    from: { value, unit: from },
    to: { value: Math.round(result * 1e6) / 1e6, unit: to },
    formula: `${from} -> ${baseName} -> ${to} (multiply by ${fromInfo.factor}, divide by ${toInfo.factor})`,
  };
}

// ---------------------------------------------------------------------------
// 6. timeZones
// ---------------------------------------------------------------------------

/** Major world city timezones used when no specific timezone is requested. */
const MAJOR_TIMEZONES = [
  { city: 'London', tz: 'Europe/London' },
  { city: 'New York', tz: 'America/New_York' },
  { city: 'Tokyo', tz: 'Asia/Tokyo' },
  { city: 'Sydney', tz: 'Australia/Sydney' },
  { city: 'Dubai', tz: 'Asia/Dubai' },
  { city: 'Mumbai', tz: 'Asia/Kolkata' },
  { city: 'Singapore', tz: 'Asia/Singapore' },
  { city: 'Los Angeles', tz: 'America/Los_Angeles' },
  { city: 'São Paulo', tz: 'America/Sao_Paulo' },
  { city: 'Lagos', tz: 'Africa/Lagos' },
];

/**
 * Build a timezone info object for a given IANA timezone string.
 * Uses Intl.DateTimeFormat for locale-aware formatting.
 *
 * @param {string} tz - IANA timezone identifier, e.g. "Asia/Tokyo"
 * @returns {object} Timezone details including datetime, date, time,
 *   day_of_week, utc_offset, and is_dst.
 */
function getTimezoneInfo(tz) {
  const now = new Date();

  const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const dayFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'long',
  });

  const parts = dateTimeFormatter.formatToParts(now);
  const get = (type) => (parts.find(p => p.type === type) || {}).value || '';

  const year = get('year');
  const month = get('month');
  const day = get('day');
  const hour = get('hour');
  const minute = get('minute');
  const second = get('second');

  const date = `${year}-${month}-${day}`;
  const time = `${hour}:${minute}:${second}`;
  const datetime = `${date} ${time}`;
  const day_of_week = dayFormatter.format(now);

  // Calculate UTC offset
  // Create a formatter that includes the timezone offset
  const offsetFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'longOffset',
  });
  const offsetParts = offsetFormatter.formatToParts(now);
  const tzNamePart = offsetParts.find(p => p.type === 'timeZoneName');
  const utc_offset = tzNamePart ? tzNamePart.value : '';

  // Detect DST by comparing offsets in January vs July
  const jan = new Date(now.getFullYear(), 0, 1);
  const jul = new Date(now.getFullYear(), 6, 1);

  const janOffset = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'longOffset',
  }).formatToParts(jan).find(p => p.type === 'timeZoneName')?.value || '';

  const julOffset = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'longOffset',
  }).formatToParts(jul).find(p => p.type === 'timeZoneName')?.value || '';

  const currentOffset = utc_offset;
  // If January and July have different offsets, DST is observed in this timezone.
  // If the current offset differs from the January offset, we're likely in DST.
  const is_dst = janOffset !== julOffset && currentOffset !== janOffset;

  return {
    timezone: tz,
    datetime,
    date,
    time,
    day_of_week,
    utc_offset,
    is_dst,
  };
}

/**
 * Get the current time in a specific IANA timezone, or show times across
 * major world cities if no timezone is specified.
 * Pure JS computation using Intl.DateTimeFormat — no external API needed.
 *
 * @param {object} query - Query parameters
 * @param {string} [query.tz] - IANA timezone identifier, e.g. "Asia/Tokyo".
 *   If omitted, returns times for 10 major world cities.
 * @returns {object} Single timezone info object (if tz provided) or
 *   { timezones: [...] } array of major city times. Returns error for
 *   invalid timezone names.
 */
function timeZones(query) {
  const { tz } = query || {};

  if (tz) {
    try {
      const info = getTimezoneInfo(tz);
      return info;
    } catch {
      return { error: `Invalid timezone: "${tz}". Use IANA format like "America/New_York" or "Asia/Tokyo".` };
    }
  }

  // No timezone specified — return major world cities
  const timezones = [];
  for (const entry of MAJOR_TIMEZONES) {
    try {
      const info = getTimezoneInfo(entry.tz);
      info.city = entry.city;
      timezones.push(info);
    } catch {
      // Skip any timezone that fails (should not happen with hardcoded values)
    }
  }

  return { timezones };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  countryInfo,
  weather,
  newsHeadlines,
  historicalEvents,
  unitConvert,
  timeZones,
};
