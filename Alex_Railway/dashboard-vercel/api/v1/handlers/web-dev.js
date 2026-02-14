/**
 * Web & Dev Handlers — Pure computation tools for web developers.
 * QR code generation, color palette creation, and Lorem Ipsum text.
 * No external API calls required (except QR code URL construction).
 */

// ---------------------------------------------------------------------------
// Helpers — HSL / RGB / Hex conversion
// ---------------------------------------------------------------------------

/**
 * Parse a hex color string (with or without leading '#') to {r, g, b}.
 * @param {string} hex - e.g. "#3b82f6" or "3b82f6"
 * @returns {{r: number, g: number, b: number}} RGB values 0-255
 */
function hexToRgb(hex) {
  const clean = hex.replace(/^#/, '');
  const num = parseInt(clean, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

/**
 * Convert RGB (0-255) to HSL (h: 0-360, s: 0-100, l: 0-100).
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {{h: number, s: number, l: number}}
 */
function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

/**
 * Convert HSL (h: 0-360, s: 0-100, l: 0-100) to RGB (0-255).
 * @param {number} h
 * @param {number} s
 * @param {number} l
 * @returns {{r: number, g: number, b: number}}
 */
function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s /= 100;
  l /= 100;

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;

  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }

  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

/**
 * Convert RGB to a hex color string with leading '#'.
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {string} e.g. "#3b82f6"
 */
function rgbToHex(r, g, b) {
  return '#' + [r, g, b]
    .map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Build a color entry object from HSL values.
 * @param {number} h - Hue 0-360
 * @param {number} s - Saturation 0-100
 * @param {number} l - Lightness 0-100
 * @returns {{hex: string, rgb: string, hsl: string}}
 */
function colorEntry(h, s, l) {
  const { r, g, b } = hslToRgb(h, s, l);
  const hex = rgbToHex(r, g, b);
  return {
    hex,
    rgb: `rgb(${r}, ${g}, ${b})`,
    hsl: `hsl(${((h % 360) + 360) % 360}, ${s}%, ${l}%)`,
  };
}

// ---------------------------------------------------------------------------
// Lorem Ipsum word pool
// ---------------------------------------------------------------------------

const LOREM_WORDS = [
  'lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit',
  'sed', 'do', 'eiusmod', 'tempor', 'incididunt', 'ut', 'labore', 'et', 'dolore',
  'magna', 'aliqua', 'enim', 'ad', 'minim', 'veniam', 'quis', 'nostrud',
  'exercitation', 'ullamco', 'laboris', 'nisi', 'aliquip', 'ex', 'ea', 'commodo',
  'consequat', 'duis', 'aute', 'irure', 'in', 'reprehenderit', 'voluptate',
  'velit', 'esse', 'cillum', 'fugiat', 'nulla', 'pariatur', 'excepteur', 'sint',
  'occaecat', 'cupidatat', 'non', 'proident', 'sunt', 'culpa', 'qui', 'officia',
  'deserunt', 'mollit', 'anim', 'id', 'est', 'laborum', 'semper', 'risus',
  'viverra', 'maecenas', 'accumsan', 'lacus', 'vel', 'facilisis', 'volutpat',
  'consequatur', 'vitae', 'congue', 'eu', 'augue', 'pellentesque', 'habitant',
  'morbi', 'tristique', 'senectus', 'netus', 'fames', 'ac', 'turpis', 'egestas',
  'integer', 'feugiat', 'scelerisque', 'varius', 'nunc', 'mattis', 'enim',
  'blandit', 'cursus', 'leo', 'urna', 'molestie', 'at', 'elementum', 'praesent',
  'pretium', 'quam', 'vulputate', 'dignissim', 'suspendisse', 'potenti',
  'nullam', 'porttitor', 'lacinia', 'pulvinar', 'diam', 'donec', 'massa',
  'sapien', 'faucibus', 'nisl', 'tincidunt', 'ornare', 'arcu', 'odio',
  'pellentesque', 'dapibus', 'ultrices', 'purus', 'lectus', 'libero', 'cras',
  'fermentum', 'sollicitudin', 'pharetra', 'ligula', 'placerat', 'vestibulum',
  'malesuada', 'fringilla', 'orci', 'sagittis', 'porta', 'posuere', 'rhoncus',
  'tortor', 'condimentum', 'interdum', 'semper', 'auctor', 'neque', 'gravida',
  'justo', 'laoreet', 'aliquam', 'etiam', 'quisque', 'imperdiet', 'fusce',
  'bibendum', 'ante', 'primis', 'ullamcorper', 'nam', 'metus', 'hendrerit',
  'convallis', 'a', 'curabitur', 'tempus', 'iaculis', 'dictum', 'commodo',
  'dui', 'mi', 'erat', 'felis', 'eget', 'nec', 'proin', 'nibh', 'mauris',
  'sodales', 'hac', 'habitasse', 'platea', 'dictumst', 'aenean', 'euismod',
  'lobortis', 'facilisi', 'adipisci', 'numquam', 'eius', 'modi', 'tempora',
  'magnam', 'quaerat', 'voluptatem', 'quia', 'voluptas', 'aspernatur', 'aut',
  'odit', 'fugit', 'illo', 'inventore', 'veritatis', 'quasi', 'architecto',
  'beatae', 'dicta', 'explicabo', 'nemo', 'ipsam', 'voluptatibus', 'maiores',
  'alias', 'perferendis', 'doloribus', 'asperiores', 'repellat',
];

const CLASSIC_OPENING = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.';

/**
 * Pick a random integer in [min, max] (inclusive).
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Pick a random word from the Lorem Ipsum pool.
 * @returns {string}
 */
function randomWord() {
  return LOREM_WORDS[Math.floor(Math.random() * LOREM_WORDS.length)];
}

/**
 * Generate a single sentence of random Latin words.
 * @param {number} wordCount - Number of words in the sentence
 * @returns {string}
 */
function generateSentence(wordCount) {
  const words = [];
  for (let i = 0; i < wordCount; i++) {
    words.push(randomWord());
  }
  // Capitalize first word, end with period
  words[0] = words[0].charAt(0).toUpperCase() + words[0].slice(1);
  return words.join(' ') + '.';
}

/**
 * Generate a paragraph of random Latin sentences.
 * @param {number} targetWords - Approximate word count for the paragraph
 * @returns {string}
 */
function generateParagraph(targetWords) {
  const sentences = [];
  let total = 0;
  while (total < targetWords) {
    const len = randInt(8, 15);
    sentences.push(generateSentence(len));
    total += len;
  }
  return sentences.join(' ');
}

// ---------------------------------------------------------------------------
// Handler functions
// ---------------------------------------------------------------------------

/**
 * Generate a QR code URL for the given text or URL.
 * Uses the free goqr.me API. Does not fetch the image — returns the URL
 * so the client can render it directly in an <img> tag.
 *
 * @param {object} query - Query parameters
 * @param {string} query.text - The text or URL to encode (required)
 * @param {number} [query.size=200] - Image dimensions in pixels (square)
 * @returns {object} { text, qr_url, size, format }
 */
function qrGenerate(query) {
  const { text, size: rawSize } = query || {};

  if (!text) {
    return { error: 'Missing required parameter: text' };
  }

  const size = parseInt(rawSize, 10) || 200;
  const qr_url = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(text)}`;

  return {
    text,
    qr_url,
    size,
    format: 'png',
  };
}

/**
 * Generate a color palette from a base hex color using HSL math.
 * Supports complementary, analogous, triadic, shades, and
 * split-complementary modes.
 *
 * @param {object} query - Query parameters
 * @param {string} query.base - Base hex color, e.g. "#3b82f6" or "3b82f6" (required)
 * @param {string} [query.mode="complementary"] - Palette mode:
 *   "complementary" | "analogous" | "triadic" | "shades" | "split-complementary"
 * @returns {object} { base, mode, colors: [{hex, rgb, hsl},...], css_gradient }
 */
function colorPalette(query) {
  const { base: rawBase, mode: rawMode } = query || {};

  if (!rawBase) {
    return { error: 'Missing required parameter: base' };
  }

  const base = rawBase.startsWith('#') ? rawBase : `#${rawBase}`;
  const mode = rawMode || 'complementary';

  // Parse base color to HSL
  const { r, g, b } = hexToRgb(base);
  const { h, s, l } = rgbToHsl(r, g, b);

  let colors;

  switch (mode) {
    case 'complementary':
      colors = [
        colorEntry(h, s, l),
        colorEntry(h + 180, s, l),
      ];
      break;

    case 'analogous':
      colors = [
        colorEntry(h - 30, s, l),
        colorEntry(h, s, l),
        colorEntry(h + 30, s, l),
        colorEntry(h + 60, s, l),
      ];
      break;

    case 'triadic':
      colors = [
        colorEntry(h, s, l),
        colorEntry(h + 120, s, l),
        colorEntry(h + 240, s, l),
      ];
      break;

    case 'shades':
      colors = [
        colorEntry(h, s, l),
        colorEntry(h, s, Math.round(l * 0.75)),
        colorEntry(h, s, Math.round(l * 0.50)),
        colorEntry(h, s, Math.round(l * 0.25)),
      ];
      break;

    case 'split-complementary':
      colors = [
        colorEntry(h, s, l),
        colorEntry(h + 150, s, l),
        colorEntry(h + 210, s, l),
      ];
      break;

    default:
      // Fall back to complementary for unknown modes
      colors = [
        colorEntry(h, s, l),
        colorEntry(h + 180, s, l),
      ];
      break;
  }

  // Build CSS gradient from all colors in the palette
  const hexList = colors.map(c => c.hex);
  const css_gradient = `linear-gradient(135deg, ${hexList.join(', ')})`;

  return {
    base,
    mode,
    colors,
    css_gradient,
  };
}

/**
 * Generate Lorem Ipsum placeholder text.
 * Supports paragraphs, sentences, or individual words.
 * The first paragraph always begins with the classic
 * "Lorem ipsum dolor sit amet..." opening.
 *
 * @param {object} query - Query parameters
 * @param {number} [query.paragraphs=3] - Number of paragraphs (max 10, used when type is "paragraphs")
 * @param {string} [query.type="paragraphs"] - Output type: "paragraphs" | "sentences" | "words"
 * @param {number} [query.count] - Number of sentences or words (used when type is "sentences" or "words")
 * @returns {object} { type, count, text }
 */
function loremIpsum(query) {
  const { paragraphs: rawParagraphs, type: rawType, count: rawCount } = query || {};

  const type = rawType || 'paragraphs';

  if (type === 'paragraphs') {
    const paragraphs = Math.min(Math.max(parseInt(rawParagraphs, 10) || 3, 1), 10);
    const parts = [];

    for (let i = 0; i < paragraphs; i++) {
      if (i === 0) {
        // First paragraph starts with the classic opening
        const targetWords = randInt(40, 80);
        const openingWordCount = CLASSIC_OPENING.split(/\s+/).length;
        const remaining = targetWords - openingWordCount;
        if (remaining > 0) {
          parts.push(CLASSIC_OPENING + ' ' + generateParagraph(remaining));
        } else {
          parts.push(CLASSIC_OPENING);
        }
      } else {
        parts.push(generateParagraph(randInt(40, 80)));
      }
    }

    return {
      type,
      count: paragraphs,
      text: parts.join('\n\n'),
    };
  }

  if (type === 'sentences') {
    const count = Math.min(Math.max(parseInt(rawCount, 10) || 5, 1), 100);
    const sentences = [];
    for (let i = 0; i < count; i++) {
      sentences.push(generateSentence(randInt(8, 15)));
    }
    return {
      type,
      count,
      text: sentences.join(' '),
    };
  }

  if (type === 'words') {
    const count = Math.min(Math.max(parseInt(rawCount, 10) || 20, 1), 500);
    const words = [];
    for (let i = 0; i < count; i++) {
      words.push(randomWord());
    }
    return {
      type,
      count,
      text: words.join(' '),
    };
  }

  // Unknown type — default to paragraphs
  return loremIpsum({ ...query, type: 'paragraphs' });
}

module.exports = { qrGenerate, colorPalette, loremIpsum };
