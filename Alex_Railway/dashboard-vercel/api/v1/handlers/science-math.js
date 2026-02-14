/**
 * Science & Math Handlers — Computation, periodic table, statistics,
 * space facts (AI), and carbon footprint estimation.
 * CommonJS module consumed by router.js.
 */

const { callHaikuJSON } = require('./ai-helper');

// ─── 1. Math Expression Parser & Equation Solver ───────────────────────────

/**
 * Tokenizer for math expressions.
 * Produces an array of tokens: numbers, operators, parentheses, and variable 'x'.
 * @param {string} expr - Raw expression string
 * @returns {Array<{type: string, value: string|number}>} Token array
 */
function tokenize(expr) {
  const tokens = [];
  let i = 0;
  const s = expr.replace(/\s+/g, '');

  while (i < s.length) {
    const ch = s[i];

    if ((ch >= '0' && ch <= '9') || ch === '.') {
      let num = '';
      while (i < s.length && ((s[i] >= '0' && s[i] <= '9') || s[i] === '.')) {
        num += s[i++];
      }
      tokens.push({ type: 'number', value: parseFloat(num) });
      continue;
    }

    if (ch === 'x' || ch === 'X') {
      tokens.push({ type: 'variable', value: 'x' });
      i++;
      continue;
    }

    if ('+-*/^()='.includes(ch)) {
      tokens.push({ type: 'operator', value: ch });
      i++;
      continue;
    }

    throw new Error(`Unexpected character: ${ch}`);
  }

  return tokens;
}

/**
 * Recursive descent parser for arithmetic expressions.
 * Grammar:
 *   expression = term (('+' | '-') term)*
 *   term       = factor (('*' | '/') factor)*
 *   factor     = base ('^' factor)?
 *   base       = NUMBER | '(' expression ')' | '-' factor
 *
 * @param {Array} tokens - Token array from tokenize()
 * @returns {number} Evaluated result
 */
function evaluateArithmetic(tokens) {
  let pos = 0;

  function peek() {
    return pos < tokens.length ? tokens[pos] : null;
  }

  function consume() {
    return tokens[pos++];
  }

  function parseExpression() {
    let left = parseTerm();
    while (peek() && peek().type === 'operator' && (peek().value === '+' || peek().value === '-')) {
      const op = consume().value;
      const right = parseTerm();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  function parseTerm() {
    let left = parseFactor();
    while (peek() && peek().type === 'operator' && (peek().value === '*' || peek().value === '/')) {
      const op = consume().value;
      const right = parseFactor();
      if (op === '/' && right === 0) throw new Error('Division by zero');
      left = op === '*' ? left * right : left / right;
    }
    return left;
  }

  function parseFactor() {
    const base = parseBase();
    if (peek() && peek().type === 'operator' && peek().value === '^') {
      consume();
      const exp = parseFactor(); // right-associative
      return Math.pow(base, exp);
    }
    return base;
  }

  function parseBase() {
    const t = peek();
    if (!t) throw new Error('Unexpected end of expression');

    // Unary minus
    if (t.type === 'operator' && t.value === '-') {
      consume();
      return -parseFactor();
    }

    // Unary plus
    if (t.type === 'operator' && t.value === '+') {
      consume();
      return parseFactor();
    }

    // Parenthesized expression
    if (t.type === 'operator' && t.value === '(') {
      consume();
      const val = parseExpression();
      if (!peek() || peek().value !== ')') throw new Error('Missing closing parenthesis');
      consume();
      return val;
    }

    // Number
    if (t.type === 'number') {
      consume();
      return t.value;
    }

    throw new Error(`Unexpected token: ${t.value}`);
  }

  const result = parseExpression();
  if (pos < tokens.length) {
    throw new Error(`Unexpected token after expression: ${tokens[pos].value}`);
  }
  return result;
}

/**
 * Solve a simple linear equation of the form ax + b = c.
 * Collects x-coefficients and constants on each side, then solves.
 * @param {string} expr - Equation string containing '=' and 'x'
 * @returns {{ result: number, steps: string[] }} Solution and steps
 */
function solveLinearEquation(expr) {
  const sides = expr.split('=');
  if (sides.length !== 2) throw new Error('Equation must have exactly one "=" sign');

  const steps = [];
  steps.push(`Start: ${expr.trim()}`);

  /**
   * Parse one side of the equation into { coeff, constant }.
   * Handles patterns like: 2x, -3x, +5, -7, 2x+5, etc.
   */
  function parseSide(s) {
    s = s.replace(/\s+/g, '');
    let coeff = 0;
    let constant = 0;

    // Insert '+' before '-' for splitting, but not at the start or after operators
    let normalized = '';
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '-' && i > 0 && s[i - 1] !== '(' && s[i - 1] !== '+' && s[i - 1] !== '-' && s[i - 1] !== '*' && s[i - 1] !== '/') {
        normalized += '+-';
      } else {
        normalized += s[i];
      }
    }

    const parts = normalized.split('+').filter(p => p.length > 0);

    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed.includes('x') || trimmed.includes('X')) {
        const xPart = trimmed.replace(/[xX]/g, '');
        if (xPart === '' || xPart === '+') coeff += 1;
        else if (xPart === '-') coeff -= 1;
        else coeff += parseFloat(xPart);
      } else {
        constant += parseFloat(trimmed);
      }
    }

    return { coeff, constant };
  }

  const left = parseSide(sides[0]);
  const right = parseSide(sides[1]);

  steps.push(`Left side: ${left.coeff}x + ${left.constant}`);
  steps.push(`Right side: ${right.coeff}x + ${right.constant}`);

  // Move all x to left, constants to right: (left.coeff - right.coeff)x = right.constant - left.constant
  const netCoeff = left.coeff - right.coeff;
  const netConstant = right.constant - left.constant;

  steps.push(`Rearrange: ${netCoeff}x = ${netConstant}`);

  if (netCoeff === 0) {
    if (netConstant === 0) throw new Error('Infinite solutions (identity)');
    throw new Error('No solution (contradiction)');
  }

  const result = netConstant / netCoeff;
  steps.push(`x = ${netConstant} / ${netCoeff}`);
  steps.push(`x = ${result}`);

  return { result, steps };
}

/**
 * Solve a math expression or simple linear equation.
 * Supports arithmetic (+, -, *, /, ^, parentheses) and linear equations (ax+b=c).
 * Does NOT use eval(). Uses a safe recursive descent parser.
 *
 * @param {object} query - Query parameters
 * @param {string} query.expr - Math expression or equation to solve
 * @returns {object} Result with expression, result, type, and steps
 *
 * @example
 * mathSolve({ expr: "2+3*4" })
 * // => { expression: "2+3*4", result: 14, type: "arithmetic", steps: ["2+3*4 = 14"] }
 *
 * @example
 * mathSolve({ expr: "2x+5=15" })
 * // => { expression: "2x+5=15", result: 5, type: "equation", steps: [...] }
 */
async function mathSolve(query) {
  if (!query.expr) {
    return { error: 'Missing required parameter: expr' };
  }

  const expr = String(query.expr).trim();

  try {
    // Determine if this is an equation (contains '=' and 'x')
    const hasEquals = expr.includes('=');
    const hasVariable = /[xX]/.test(expr);

    if (hasEquals && hasVariable) {
      // Equation mode
      const { result, steps } = solveLinearEquation(expr);
      return {
        expression: expr,
        result,
        type: 'equation',
        steps,
      };
    }

    if (hasEquals || hasVariable) {
      return {
        expression: expr,
        error: 'Could not parse expression',
        supported: 'Arithmetic: 2+3*4, Equations: 2x+5=15',
      };
    }

    // Arithmetic mode
    const tokens = tokenize(expr);
    const result = evaluateArithmetic(tokens);
    const rounded = Math.round(result * 1e10) / 1e10; // avoid floating point noise

    return {
      expression: expr,
      result: rounded,
      type: 'arithmetic',
      steps: [`${expr} = ${rounded}`],
    };
  } catch (err) {
    return {
      expression: expr,
      error: 'Could not parse expression',
      supported: 'Arithmetic: 2+3*4, Equations: 2x+5=15',
    };
  }
}

// ─── 2. Periodic Table ─────────────────────────────────────────────────────

/**
 * Static periodic table data for all 118 elements.
 * First 36 elements include full data; remaining elements include basic data.
 * @type {Object<string, object>}
 */
const ELEMENTS = {
  H:   { symbol: 'H',  name: 'Hydrogen',      number: 1,   mass: 1.008,     category: 'Nonmetal',              period: 1, group: 1,  discovered_by: 'Henry Cavendish',         year_discovered: 1766 },
  He:  { symbol: 'He', name: 'Helium',         number: 2,   mass: 4.0026,    category: 'Noble gas',             period: 1, group: 18, discovered_by: 'Pierre Janssen',          year_discovered: 1868 },
  Li:  { symbol: 'Li', name: 'Lithium',        number: 3,   mass: 6.941,     category: 'Alkali metal',          period: 2, group: 1,  discovered_by: 'Johan August Arfwedson',  year_discovered: 1817 },
  Be:  { symbol: 'Be', name: 'Beryllium',      number: 4,   mass: 9.0122,    category: 'Alkaline earth metal',  period: 2, group: 2,  discovered_by: 'Louis Nicolas Vauquelin', year_discovered: 1798 },
  B:   { symbol: 'B',  name: 'Boron',          number: 5,   mass: 10.81,     category: 'Metalloid',             period: 2, group: 13, discovered_by: 'Joseph Louis Gay-Lussac', year_discovered: 1808 },
  C:   { symbol: 'C',  name: 'Carbon',         number: 6,   mass: 12.011,    category: 'Nonmetal',              period: 2, group: 14, discovered_by: 'Ancient',                 year_discovered: null },
  N:   { symbol: 'N',  name: 'Nitrogen',       number: 7,   mass: 14.007,    category: 'Nonmetal',              period: 2, group: 15, discovered_by: 'Daniel Rutherford',       year_discovered: 1772 },
  O:   { symbol: 'O',  name: 'Oxygen',         number: 8,   mass: 15.999,    category: 'Nonmetal',              period: 2, group: 16, discovered_by: 'Carl Wilhelm Scheele',    year_discovered: 1771 },
  F:   { symbol: 'F',  name: 'Fluorine',       number: 9,   mass: 18.998,    category: 'Halogen',               period: 2, group: 17, discovered_by: 'Andre-Marie Ampere',      year_discovered: 1810 },
  Ne:  { symbol: 'Ne', name: 'Neon',           number: 10,  mass: 20.18,     category: 'Noble gas',             period: 2, group: 18, discovered_by: 'William Ramsay',          year_discovered: 1898 },
  Na:  { symbol: 'Na', name: 'Sodium',         number: 11,  mass: 22.99,     category: 'Alkali metal',          period: 3, group: 1,  discovered_by: 'Humphry Davy',            year_discovered: 1807 },
  Mg:  { symbol: 'Mg', name: 'Magnesium',      number: 12,  mass: 24.305,    category: 'Alkaline earth metal',  period: 3, group: 2,  discovered_by: 'Joseph Black',            year_discovered: 1755 },
  Al:  { symbol: 'Al', name: 'Aluminium',      number: 13,  mass: 26.982,    category: 'Post-transition metal', period: 3, group: 13, discovered_by: 'Hans Christian Oersted',   year_discovered: 1825 },
  Si:  { symbol: 'Si', name: 'Silicon',        number: 14,  mass: 28.086,    category: 'Metalloid',             period: 3, group: 14, discovered_by: 'Jons Jacob Berzelius',    year_discovered: 1824 },
  P:   { symbol: 'P',  name: 'Phosphorus',     number: 15,  mass: 30.974,    category: 'Nonmetal',              period: 3, group: 15, discovered_by: 'Hennig Brand',            year_discovered: 1669 },
  S:   { symbol: 'S',  name: 'Sulfur',         number: 16,  mass: 32.06,     category: 'Nonmetal',              period: 3, group: 16, discovered_by: 'Ancient',                 year_discovered: null },
  Cl:  { symbol: 'Cl', name: 'Chlorine',       number: 17,  mass: 35.45,     category: 'Halogen',               period: 3, group: 17, discovered_by: 'Carl Wilhelm Scheele',    year_discovered: 1774 },
  Ar:  { symbol: 'Ar', name: 'Argon',          number: 18,  mass: 39.948,    category: 'Noble gas',             period: 3, group: 18, discovered_by: 'Lord Rayleigh',           year_discovered: 1894 },
  K:   { symbol: 'K',  name: 'Potassium',      number: 19,  mass: 39.098,    category: 'Alkali metal',          period: 4, group: 1,  discovered_by: 'Humphry Davy',            year_discovered: 1807 },
  Ca:  { symbol: 'Ca', name: 'Calcium',        number: 20,  mass: 40.078,    category: 'Alkaline earth metal',  period: 4, group: 2,  discovered_by: 'Humphry Davy',            year_discovered: 1808 },
  Sc:  { symbol: 'Sc', name: 'Scandium',       number: 21,  mass: 44.956,    category: 'Transition metal',      period: 4, group: 3,  discovered_by: 'Lars Fredrik Nilson',     year_discovered: 1879 },
  Ti:  { symbol: 'Ti', name: 'Titanium',       number: 22,  mass: 47.867,    category: 'Transition metal',      period: 4, group: 4,  discovered_by: 'William Gregor',          year_discovered: 1791 },
  V:   { symbol: 'V',  name: 'Vanadium',       number: 23,  mass: 50.942,    category: 'Transition metal',      period: 4, group: 5,  discovered_by: 'Andres Manuel del Rio',   year_discovered: 1801 },
  Cr:  { symbol: 'Cr', name: 'Chromium',       number: 24,  mass: 51.996,    category: 'Transition metal',      period: 4, group: 6,  discovered_by: 'Louis Nicolas Vauquelin', year_discovered: 1798 },
  Mn:  { symbol: 'Mn', name: 'Manganese',      number: 25,  mass: 54.938,    category: 'Transition metal',      period: 4, group: 7,  discovered_by: 'Torbern Olof Bergman',    year_discovered: 1774 },
  Fe:  { symbol: 'Fe', name: 'Iron',           number: 26,  mass: 55.845,    category: 'Transition metal',      period: 4, group: 8,  discovered_by: 'Ancient',                 year_discovered: null },
  Co:  { symbol: 'Co', name: 'Cobalt',         number: 27,  mass: 58.933,    category: 'Transition metal',      period: 4, group: 9,  discovered_by: 'Georg Brandt',            year_discovered: 1735 },
  Ni:  { symbol: 'Ni', name: 'Nickel',         number: 28,  mass: 58.693,    category: 'Transition metal',      period: 4, group: 10, discovered_by: 'Axel Fredrik Cronstedt',  year_discovered: 1751 },
  Cu:  { symbol: 'Cu', name: 'Copper',         number: 29,  mass: 63.546,    category: 'Transition metal',      period: 4, group: 11, discovered_by: 'Ancient',                 year_discovered: null },
  Zn:  { symbol: 'Zn', name: 'Zinc',           number: 30,  mass: 65.38,     category: 'Transition metal',      period: 4, group: 12, discovered_by: 'Andreas Sigismund Marggraf', year_discovered: 1746 },
  Ga:  { symbol: 'Ga', name: 'Gallium',        number: 31,  mass: 69.723,    category: 'Post-transition metal', period: 4, group: 13, discovered_by: 'Lecoq de Boisbaudran',    year_discovered: 1875 },
  Ge:  { symbol: 'Ge', name: 'Germanium',      number: 32,  mass: 72.63,     category: 'Metalloid',             period: 4, group: 14, discovered_by: 'Clemens Winkler',         year_discovered: 1886 },
  As:  { symbol: 'As', name: 'Arsenic',        number: 33,  mass: 74.922,    category: 'Metalloid',             period: 4, group: 15, discovered_by: 'Albertus Magnus',          year_discovered: 1250 },
  Se:  { symbol: 'Se', name: 'Selenium',       number: 34,  mass: 78.971,    category: 'Nonmetal',              period: 4, group: 16, discovered_by: 'Jons Jacob Berzelius',    year_discovered: 1817 },
  Br:  { symbol: 'Br', name: 'Bromine',        number: 35,  mass: 79.904,    category: 'Halogen',               period: 4, group: 17, discovered_by: 'Antoine Jerome Balard',   year_discovered: 1826 },
  Kr:  { symbol: 'Kr', name: 'Krypton',        number: 36,  mass: 83.798,    category: 'Noble gas',             period: 4, group: 18, discovered_by: 'William Ramsay',          year_discovered: 1898 },
  // Elements 37-118: basic data
  Rb:  { symbol: 'Rb', name: 'Rubidium',       number: 37,  mass: 85.468,    category: 'Alkali metal',          period: 5, group: 1,  discovered_by: 'Robert Bunsen',           year_discovered: 1861 },
  Sr:  { symbol: 'Sr', name: 'Strontium',      number: 38,  mass: 87.62,     category: 'Alkaline earth metal',  period: 5, group: 2,  discovered_by: 'William Cruickshank',     year_discovered: 1790 },
  Y:   { symbol: 'Y',  name: 'Yttrium',        number: 39,  mass: 88.906,    category: 'Transition metal',      period: 5, group: 3,  discovered_by: 'Johan Gadolin',           year_discovered: 1794 },
  Zr:  { symbol: 'Zr', name: 'Zirconium',      number: 40,  mass: 91.224,    category: 'Transition metal',      period: 5, group: 4,  discovered_by: 'Martin Heinrich Klaproth', year_discovered: 1789 },
  Nb:  { symbol: 'Nb', name: 'Niobium',        number: 41,  mass: 92.906,    category: 'Transition metal',      period: 5, group: 5,  discovered_by: 'Charles Hatchett',        year_discovered: 1801 },
  Mo:  { symbol: 'Mo', name: 'Molybdenum',     number: 42,  mass: 95.95,     category: 'Transition metal',      period: 5, group: 6,  discovered_by: 'Carl Wilhelm Scheele',    year_discovered: 1781 },
  Tc:  { symbol: 'Tc', name: 'Technetium',     number: 43,  mass: 98,        category: 'Transition metal',      period: 5, group: 7,  discovered_by: 'Emilio Segre',            year_discovered: 1937 },
  Ru:  { symbol: 'Ru', name: 'Ruthenium',      number: 44,  mass: 101.07,    category: 'Transition metal',      period: 5, group: 8,  discovered_by: 'Karl Ernst Claus',        year_discovered: 1844 },
  Rh:  { symbol: 'Rh', name: 'Rhodium',        number: 45,  mass: 102.91,    category: 'Transition metal',      period: 5, group: 9,  discovered_by: 'William Hyde Wollaston',  year_discovered: 1803 },
  Pd:  { symbol: 'Pd', name: 'Palladium',      number: 46,  mass: 106.42,    category: 'Transition metal',      period: 5, group: 10, discovered_by: 'William Hyde Wollaston',  year_discovered: 1803 },
  Ag:  { symbol: 'Ag', name: 'Silver',         number: 47,  mass: 107.87,    category: 'Transition metal',      period: 5, group: 11, discovered_by: 'Ancient',                 year_discovered: null },
  Cd:  { symbol: 'Cd', name: 'Cadmium',        number: 48,  mass: 112.41,    category: 'Transition metal',      period: 5, group: 12, discovered_by: 'Karl Samuel Leberecht Hermann', year_discovered: 1817 },
  In:  { symbol: 'In', name: 'Indium',         number: 49,  mass: 114.82,    category: 'Post-transition metal', period: 5, group: 13, discovered_by: 'Ferdinand Reich',         year_discovered: 1863 },
  Sn:  { symbol: 'Sn', name: 'Tin',            number: 50,  mass: 118.71,    category: 'Post-transition metal', period: 5, group: 14, discovered_by: 'Ancient',                 year_discovered: null },
  Sb:  { symbol: 'Sb', name: 'Antimony',       number: 51,  mass: 121.76,    category: 'Metalloid',             period: 5, group: 15, discovered_by: 'Ancient',                 year_discovered: null },
  Te:  { symbol: 'Te', name: 'Tellurium',      number: 52,  mass: 127.6,     category: 'Metalloid',             period: 5, group: 16, discovered_by: 'Franz-Joseph Muller von Reichenstein', year_discovered: 1782 },
  I:   { symbol: 'I',  name: 'Iodine',         number: 53,  mass: 126.9,     category: 'Halogen',               period: 5, group: 17, discovered_by: 'Bernard Courtois',        year_discovered: 1811 },
  Xe:  { symbol: 'Xe', name: 'Xenon',          number: 54,  mass: 131.29,    category: 'Noble gas',             period: 5, group: 18, discovered_by: 'William Ramsay',          year_discovered: 1898 },
  Cs:  { symbol: 'Cs', name: 'Caesium',        number: 55,  mass: 132.91,    category: 'Alkali metal',          period: 6, group: 1,  discovered_by: 'Robert Bunsen',           year_discovered: 1860 },
  Ba:  { symbol: 'Ba', name: 'Barium',         number: 56,  mass: 137.33,    category: 'Alkaline earth metal',  period: 6, group: 2,  discovered_by: 'Carl Wilhelm Scheele',    year_discovered: 1772 },
  La:  { symbol: 'La', name: 'Lanthanum',      number: 57,  mass: 138.91,    category: 'Lanthanide',            period: 6, group: 3,  discovered_by: 'Carl Gustaf Mosander',    year_discovered: 1839 },
  Ce:  { symbol: 'Ce', name: 'Cerium',         number: 58,  mass: 140.12,    category: 'Lanthanide',            period: 6, group: 3,  discovered_by: 'Jons Jacob Berzelius',    year_discovered: 1803 },
  Pr:  { symbol: 'Pr', name: 'Praseodymium',   number: 59,  mass: 140.91,    category: 'Lanthanide',            period: 6, group: 3,  discovered_by: 'Carl Auer von Welsbach',  year_discovered: 1885 },
  Nd:  { symbol: 'Nd', name: 'Neodymium',      number: 60,  mass: 144.24,    category: 'Lanthanide',            period: 6, group: 3,  discovered_by: 'Carl Auer von Welsbach',  year_discovered: 1885 },
  Pm:  { symbol: 'Pm', name: 'Promethium',     number: 61,  mass: 145,       category: 'Lanthanide',            period: 6, group: 3,  discovered_by: 'Chien Shiung Wu',         year_discovered: 1945 },
  Sm:  { symbol: 'Sm', name: 'Samarium',       number: 62,  mass: 150.36,    category: 'Lanthanide',            period: 6, group: 3,  discovered_by: 'Lecoq de Boisbaudran',    year_discovered: 1879 },
  Eu:  { symbol: 'Eu', name: 'Europium',       number: 63,  mass: 151.96,    category: 'Lanthanide',            period: 6, group: 3,  discovered_by: 'Eugene-Anatole Demarcay', year_discovered: 1901 },
  Gd:  { symbol: 'Gd', name: 'Gadolinium',     number: 64,  mass: 157.25,    category: 'Lanthanide',            period: 6, group: 3,  discovered_by: 'Jean Charles Galissard de Marignac', year_discovered: 1880 },
  Tb:  { symbol: 'Tb', name: 'Terbium',        number: 65,  mass: 158.93,    category: 'Lanthanide',            period: 6, group: 3,  discovered_by: 'Carl Gustaf Mosander',    year_discovered: 1843 },
  Dy:  { symbol: 'Dy', name: 'Dysprosium',     number: 66,  mass: 162.5,     category: 'Lanthanide',            period: 6, group: 3,  discovered_by: 'Lecoq de Boisbaudran',    year_discovered: 1886 },
  Ho:  { symbol: 'Ho', name: 'Holmium',        number: 67,  mass: 164.93,    category: 'Lanthanide',            period: 6, group: 3,  discovered_by: 'Marc Delafontaine',       year_discovered: 1878 },
  Er:  { symbol: 'Er', name: 'Erbium',         number: 68,  mass: 167.26,    category: 'Lanthanide',            period: 6, group: 3,  discovered_by: 'Carl Gustaf Mosander',    year_discovered: 1843 },
  Tm:  { symbol: 'Tm', name: 'Thulium',        number: 69,  mass: 168.93,    category: 'Lanthanide',            period: 6, group: 3,  discovered_by: 'Per Teodor Cleve',        year_discovered: 1879 },
  Yb:  { symbol: 'Yb', name: 'Ytterbium',      number: 70,  mass: 173.05,    category: 'Lanthanide',            period: 6, group: 3,  discovered_by: 'Jean Charles Galissard de Marignac', year_discovered: 1878 },
  Lu:  { symbol: 'Lu', name: 'Lutetium',       number: 71,  mass: 174.97,    category: 'Lanthanide',            period: 6, group: 3,  discovered_by: 'Georges Urbain',          year_discovered: 1907 },
  Hf:  { symbol: 'Hf', name: 'Hafnium',        number: 72,  mass: 178.49,    category: 'Transition metal',      period: 6, group: 4,  discovered_by: 'Dirk Coster',             year_discovered: 1923 },
  Ta:  { symbol: 'Ta', name: 'Tantalum',       number: 73,  mass: 180.95,    category: 'Transition metal',      period: 6, group: 5,  discovered_by: 'Anders Gustaf Ekeberg',   year_discovered: 1802 },
  W:   { symbol: 'W',  name: 'Tungsten',       number: 74,  mass: 183.84,    category: 'Transition metal',      period: 6, group: 6,  discovered_by: 'Carl Wilhelm Scheele',    year_discovered: 1783 },
  Re:  { symbol: 'Re', name: 'Rhenium',        number: 75,  mass: 186.21,    category: 'Transition metal',      period: 6, group: 7,  discovered_by: 'Masataka Ogawa',          year_discovered: 1925 },
  Os:  { symbol: 'Os', name: 'Osmium',         number: 76,  mass: 190.23,    category: 'Transition metal',      period: 6, group: 8,  discovered_by: 'Smithson Tennant',        year_discovered: 1803 },
  Ir:  { symbol: 'Ir', name: 'Iridium',        number: 77,  mass: 192.22,    category: 'Transition metal',      period: 6, group: 9,  discovered_by: 'Smithson Tennant',        year_discovered: 1803 },
  Pt:  { symbol: 'Pt', name: 'Platinum',       number: 78,  mass: 195.08,    category: 'Transition metal',      period: 6, group: 10, discovered_by: 'Antonio de Ulloa',        year_discovered: 1735 },
  Au:  { symbol: 'Au', name: 'Gold',           number: 79,  mass: 196.97,    category: 'Transition metal',      period: 6, group: 11, discovered_by: 'Ancient',                 year_discovered: null },
  Hg:  { symbol: 'Hg', name: 'Mercury',        number: 80,  mass: 200.59,    category: 'Transition metal',      period: 6, group: 12, discovered_by: 'Ancient',                 year_discovered: null },
  Tl:  { symbol: 'Tl', name: 'Thallium',       number: 81,  mass: 204.38,    category: 'Post-transition metal', period: 6, group: 13, discovered_by: 'William Crookes',         year_discovered: 1861 },
  Pb:  { symbol: 'Pb', name: 'Lead',           number: 82,  mass: 207.2,     category: 'Post-transition metal', period: 6, group: 14, discovered_by: 'Ancient',                 year_discovered: null },
  Bi:  { symbol: 'Bi', name: 'Bismuth',        number: 83,  mass: 208.98,    category: 'Post-transition metal', period: 6, group: 15, discovered_by: 'Claude Francois Geoffroy', year_discovered: 1753 },
  Po:  { symbol: 'Po', name: 'Polonium',       number: 84,  mass: 209,       category: 'Post-transition metal', period: 6, group: 16, discovered_by: 'Marie Curie',             year_discovered: 1898 },
  At:  { symbol: 'At', name: 'Astatine',       number: 85,  mass: 210,       category: 'Halogen',               period: 6, group: 17, discovered_by: 'Dale R. Corson',          year_discovered: 1940 },
  Rn:  { symbol: 'Rn', name: 'Radon',          number: 86,  mass: 222,       category: 'Noble gas',             period: 6, group: 18, discovered_by: 'Friedrich Ernst Dorn',    year_discovered: 1900 },
  Fr:  { symbol: 'Fr', name: 'Francium',       number: 87,  mass: 223,       category: 'Alkali metal',          period: 7, group: 1,  discovered_by: 'Marguerite Perey',        year_discovered: 1939 },
  Ra:  { symbol: 'Ra', name: 'Radium',         number: 88,  mass: 226,       category: 'Alkaline earth metal',  period: 7, group: 2,  discovered_by: 'Marie Curie',             year_discovered: 1898 },
  Ac:  { symbol: 'Ac', name: 'Actinium',       number: 89,  mass: 227,       category: 'Actinide',              period: 7, group: 3,  discovered_by: 'Friedrich Oskar Giesel',  year_discovered: 1899 },
  Th:  { symbol: 'Th', name: 'Thorium',        number: 90,  mass: 232.04,    category: 'Actinide',              period: 7, group: 3,  discovered_by: 'Jons Jacob Berzelius',    year_discovered: 1829 },
  Pa:  { symbol: 'Pa', name: 'Protactinium',   number: 91,  mass: 231.04,    category: 'Actinide',              period: 7, group: 3,  discovered_by: 'Kasimir Fajans',          year_discovered: 1913 },
  U:   { symbol: 'U',  name: 'Uranium',        number: 92,  mass: 238.03,    category: 'Actinide',              period: 7, group: 3,  discovered_by: 'Martin Heinrich Klaproth', year_discovered: 1789 },
  Np:  { symbol: 'Np', name: 'Neptunium',      number: 93,  mass: 237,       category: 'Actinide',              period: 7, group: 3,  discovered_by: 'Edwin McMillan',          year_discovered: 1940 },
  Pu:  { symbol: 'Pu', name: 'Plutonium',      number: 94,  mass: 244,       category: 'Actinide',              period: 7, group: 3,  discovered_by: 'Glenn T. Seaborg',        year_discovered: 1940 },
  Am:  { symbol: 'Am', name: 'Americium',      number: 95,  mass: 243,       category: 'Actinide',              period: 7, group: 3,  discovered_by: 'Glenn T. Seaborg',        year_discovered: 1944 },
  Cm:  { symbol: 'Cm', name: 'Curium',         number: 96,  mass: 247,       category: 'Actinide',              period: 7, group: 3,  discovered_by: 'Glenn T. Seaborg',        year_discovered: 1944 },
  Bk:  { symbol: 'Bk', name: 'Berkelium',      number: 97,  mass: 247,       category: 'Actinide',              period: 7, group: 3,  discovered_by: 'Glenn T. Seaborg',        year_discovered: 1949 },
  Cf:  { symbol: 'Cf', name: 'Californium',    number: 98,  mass: 251,       category: 'Actinide',              period: 7, group: 3,  discovered_by: 'Glenn T. Seaborg',        year_discovered: 1950 },
  Es:  { symbol: 'Es', name: 'Einsteinium',    number: 99,  mass: 252,       category: 'Actinide',              period: 7, group: 3,  discovered_by: 'Albert Ghiorso',          year_discovered: 1952 },
  Fm:  { symbol: 'Fm', name: 'Fermium',        number: 100, mass: 257,       category: 'Actinide',              period: 7, group: 3,  discovered_by: 'Albert Ghiorso',          year_discovered: 1952 },
  Md:  { symbol: 'Md', name: 'Mendelevium',    number: 101, mass: 258,       category: 'Actinide',              period: 7, group: 3,  discovered_by: 'Albert Ghiorso',          year_discovered: 1955 },
  No:  { symbol: 'No', name: 'Nobelium',       number: 102, mass: 259,       category: 'Actinide',              period: 7, group: 3,  discovered_by: 'Joint Institute for Nuclear Research', year_discovered: 1966 },
  Lr:  { symbol: 'Lr', name: 'Lawrencium',     number: 103, mass: 266,       category: 'Actinide',              period: 7, group: 3,  discovered_by: 'Albert Ghiorso',          year_discovered: 1961 },
  Rf:  { symbol: 'Rf', name: 'Rutherfordium',  number: 104, mass: 267,       category: 'Transition metal',      period: 7, group: 4,  discovered_by: 'Joint Institute for Nuclear Research', year_discovered: 1964 },
  Db:  { symbol: 'Db', name: 'Dubnium',        number: 105, mass: 268,       category: 'Transition metal',      period: 7, group: 5,  discovered_by: 'Joint Institute for Nuclear Research', year_discovered: 1968 },
  Sg:  { symbol: 'Sg', name: 'Seaborgium',     number: 106, mass: 269,       category: 'Transition metal',      period: 7, group: 6,  discovered_by: 'Albert Ghiorso',          year_discovered: 1974 },
  Bh:  { symbol: 'Bh', name: 'Bohrium',        number: 107, mass: 270,       category: 'Transition metal',      period: 7, group: 7,  discovered_by: 'Peter Armbruster',        year_discovered: 1981 },
  Hs:  { symbol: 'Hs', name: 'Hassium',        number: 108, mass: 277,       category: 'Transition metal',      period: 7, group: 8,  discovered_by: 'Peter Armbruster',        year_discovered: 1984 },
  Mt:  { symbol: 'Mt', name: 'Meitnerium',     number: 109, mass: 278,       category: 'Unknown',               period: 7, group: 9,  discovered_by: 'Peter Armbruster',        year_discovered: 1982 },
  Ds:  { symbol: 'Ds', name: 'Darmstadtium',   number: 110, mass: 281,       category: 'Unknown',               period: 7, group: 10, discovered_by: 'Peter Armbruster',        year_discovered: 1994 },
  Rg:  { symbol: 'Rg', name: 'Roentgenium',    number: 111, mass: 282,       category: 'Unknown',               period: 7, group: 11, discovered_by: 'Peter Armbruster',        year_discovered: 1994 },
  Cn:  { symbol: 'Cn', name: 'Copernicium',    number: 112, mass: 285,       category: 'Transition metal',      period: 7, group: 12, discovered_by: 'Sigurd Hofmann',          year_discovered: 1996 },
  Nh:  { symbol: 'Nh', name: 'Nihonium',       number: 113, mass: 286,       category: 'Unknown',               period: 7, group: 13, discovered_by: 'RIKEN',                   year_discovered: 2003 },
  Fl:  { symbol: 'Fl', name: 'Flerovium',      number: 114, mass: 289,       category: 'Post-transition metal', period: 7, group: 14, discovered_by: 'Joint Institute for Nuclear Research', year_discovered: 1998 },
  Mc:  { symbol: 'Mc', name: 'Moscovium',      number: 115, mass: 290,       category: 'Unknown',               period: 7, group: 15, discovered_by: 'Joint Institute for Nuclear Research', year_discovered: 2003 },
  Lv:  { symbol: 'Lv', name: 'Livermorium',    number: 116, mass: 293,       category: 'Unknown',               period: 7, group: 16, discovered_by: 'Joint Institute for Nuclear Research', year_discovered: 2000 },
  Ts:  { symbol: 'Ts', name: 'Tennessine',     number: 117, mass: 294,       category: 'Unknown',               period: 7, group: 17, discovered_by: 'Joint Institute for Nuclear Research', year_discovered: 2010 },
  Og:  { symbol: 'Og', name: 'Oganesson',      number: 118, mass: 294,       category: 'Noble gas',             period: 7, group: 18, discovered_by: 'Joint Institute for Nuclear Research', year_discovered: 2002 },
};

/**
 * Fun facts for common elements.
 * @type {Object<string, string>}
 */
const FUN_FACTS = {
  H:  'Hydrogen is the most abundant element in the universe, making up about 75% of all normal matter by mass.',
  He: 'Helium is the only element that was discovered in space before it was found on Earth, observed in the Sun\'s spectrum in 1868.',
  Li: 'Lithium is so light it can float on water, and it powers most of the rechargeable batteries in our devices.',
  C:  'Carbon can form nearly 10 million different compounds — more than any other element — making it the backbone of organic chemistry.',
  N:  'Nitrogen makes up 78% of Earth\'s atmosphere and is essential for all known life as a component of DNA and proteins.',
  O:  'Oxygen is the third most abundant element in the universe and makes up about 21% of Earth\'s atmosphere.',
  F:  'Fluorine is the most reactive of all elements and is found in toothpaste as fluoride to prevent tooth decay.',
  Ne: 'Neon signs actually only produce a red-orange glow; other "neon" sign colors use different gases like argon or mercury vapor.',
  Na: 'Sodium is so reactive that it explodes on contact with water, yet combined with chlorine it makes common table salt.',
  Al: 'Aluminium was once more expensive than gold. Napoleon III reportedly served his most honored guests with aluminium utensils.',
  Si: 'Silicon is the second most abundant element in Earth\'s crust and is the foundation of modern electronics and computing.',
  P:  'Phosphorus was the first element discovered by a named individual — Hennig Brand discovered it in 1669 by distilling urine.',
  S:  'Sulfur has been known since ancient times and was referred to as "brimstone" in the Bible.',
  Cl: 'Chlorine is used to purify drinking water worldwide, preventing countless waterborne diseases.',
  Ar: 'Argon gets its name from the Greek word "argos" meaning "lazy" or "idle" because it is so chemically inert.',
  K:  'Potassium is essential for nerve function. Bananas are famous for their potassium content, but avocados contain even more.',
  Ca: 'Calcium is the most abundant metal in the human body — your bones and teeth contain about 1 kg of it.',
  Fe: 'Iron is the most abundant element on Earth by mass, forming much of Earth\'s outer and inner core. It gives blood its red color.',
  Cu: 'Copper was the first metal used by humans, dating back over 10,000 years. The Statue of Liberty contains 80 tons of it.',
  Zn: 'Zinc is essential for the human immune system, and a zinc deficiency can impair your sense of taste and smell.',
  Ag: 'Silver has the highest electrical conductivity of any element and has been used as currency for thousands of years.',
  Sn: 'Tin cans are actually made of steel coated with a thin layer of tin. Pure tin makes a "tin cry" sound when bent.',
  Au: 'All the gold ever mined in human history would fit into a cube about 21 meters on each side. It is so malleable that one ounce can be beaten into a 300 square foot sheet.',
  Hg: 'Mercury is the only metal that is liquid at room temperature. Its chemical symbol Hg comes from the Greek "hydrargyrum" meaning "liquid silver."',
  Pb: 'The word "plumber" comes from the Latin "plumbum" (lead), because ancient Roman water pipes were made of lead.',
  U:  'A single kilogram of uranium-235 can produce as much energy as about 1,500 tonnes of coal.',
  Pt: 'Platinum is so rare that all the platinum ever mined would fit in an average living room.',
  W:  'Tungsten has the highest melting point of any element at 3,422 degrees Celsius, making it ideal for light bulb filaments.',
  Ti: 'Titanium is as strong as steel but 45% lighter, making it essential for aerospace, medical implants, and sports equipment.',
  He: 'Helium is the only element that cannot be solidified by cooling at normal atmospheric pressure — it requires about 25 atmospheres of pressure.',
};

/**
 * Build a name-to-symbol lookup index from the ELEMENTS table.
 * Allows searching by element name (case-insensitive).
 * @type {Object<string, string>}
 */
const NAME_TO_SYMBOL = {};
for (const [sym, data] of Object.entries(ELEMENTS)) {
  NAME_TO_SYMBOL[data.name.toLowerCase()] = sym;
}

/**
 * Look up an element from the periodic table by symbol or name.
 * Returns full element data including an optional fun fact for common elements.
 *
 * @param {object} query - Query parameters
 * @param {string} query.element - Element symbol (e.g. "Fe") or name (e.g. "Iron")
 * @returns {object} Element data with symbol, name, number, atomic_mass, category, period, group, discovered_by, year_discovered, fun_fact
 *
 * @example
 * periodicTable({ element: "Au" })
 * // => { symbol: "Au", name: "Gold", number: 79, atomic_mass: 196.97, ... }
 */
async function periodicTable(query) {
  if (!query.element) {
    return { error: 'Missing required parameter: element' };
  }

  const input = String(query.element).trim();

  // Try exact symbol match (case-sensitive first, then capitalize-first)
  let el = ELEMENTS[input] || ELEMENTS[input.charAt(0).toUpperCase() + input.slice(1).toLowerCase()];

  // Try name lookup
  if (!el) {
    const sym = NAME_TO_SYMBOL[input.toLowerCase()];
    if (sym) el = ELEMENTS[sym];
  }

  if (!el) {
    return {
      error: `Element not found: "${input}"`,
      hint: 'Provide an element symbol (e.g. "Fe") or name (e.g. "Iron")',
    };
  }

  return {
    symbol: el.symbol,
    name: el.name,
    number: el.number,
    atomic_mass: el.mass,
    category: el.category,
    period: el.period,
    group: el.group,
    discovered_by: el.discovered_by,
    year_discovered: el.year_discovered,
    fun_fact: FUN_FACTS[el.symbol] || null,
  };
}

// ─── 3. Space Facts (AI-powered) ───────────────────────────────────────────

/**
 * Get fascinating facts about a space/astronomy topic using AI.
 * Calls Claude Haiku to generate educational astronomy content.
 *
 * Educational disclaimer: Results are AI-generated and should be verified
 * with authoritative sources for academic use.
 *
 * @param {object} query - Query parameters
 * @param {string} query.topic - Space topic (e.g. "mars", "black holes", "sun")
 * @returns {Promise<object>} Object with topic, facts array, and source note
 *
 * @example
 * spaceFacts({ topic: "mars" })
 * // => { topic: "mars", facts: ["...", "...", ...], source_note: "AI-generated educational content" }
 */
async function spaceFacts(query) {
  if (!query.topic) {
    return { error: 'Missing required parameter: topic' };
  }

  const systemPrompt = 'You are an astronomy educator. Provide fascinating, accurate facts about space topics. Target audience: students and curious learners.';

  try {
    const result = await callHaikuJSON(
      systemPrompt,
      `Give me 5 fascinating facts about: ${query.topic}. Return JSON: {"topic":"...","facts":["fact1","fact2","fact3","fact4","fact5"]}`
    );

    return {
      topic: result.topic || query.topic,
      facts: result.facts || [],
      source_note: 'AI-generated educational content',
    };
  } catch (err) {
    return {
      topic: query.topic,
      facts: [],
      error: `Failed to generate space facts: ${err.message}`,
      source_note: 'AI-generated educational content',
    };
  }
}

// ─── 4. Statistics Calculator ───────────────────────────────────────────────

/**
 * Round a number to a specified number of decimal places.
 * @param {number} value - The number to round
 * @param {number} places - Decimal places
 * @returns {number} Rounded number
 */
function roundTo(value, places) {
  const factor = Math.pow(10, places);
  return Math.round(value * factor) / factor;
}

/**
 * Calculate descriptive statistics for a dataset.
 * Computes mean, median, mode, standard deviation, variance, min, max, range, count, and sum.
 * All floating-point results are rounded to 4 decimal places.
 *
 * @param {object} query - Query parameters
 * @param {string} query.data - Comma-separated numbers (e.g. "1,2,3,4,5")
 * @returns {object} Statistics object with all computed values
 *
 * @example
 * statisticsCalc({ data: "10,20,30,40,50" })
 * // => { data: [10,20,30,40,50], count: 5, sum: 150, mean: 30, median: 30, ... }
 */
async function statisticsCalc(query) {
  if (!query.data) {
    return { error: 'Missing required parameter: data' };
  }

  const parts = String(query.data).split(',').map(s => s.trim()).filter(s => s.length > 0);
  const numbers = parts.map(Number);

  if (numbers.some(isNaN)) {
    return { error: 'Invalid data: all values must be numbers. Provide comma-separated numbers like "1,2,3,4,5"' };
  }

  if (numbers.length === 0) {
    return { error: 'No data provided. Provide comma-separated numbers like "1,2,3,4,5"' };
  }

  const sorted = [...numbers].sort((a, b) => a - b);
  const count = numbers.length;
  const sum = roundTo(numbers.reduce((a, b) => a + b, 0), 4);
  const mean = roundTo(sum / count, 4);

  // Median
  let median;
  const mid = Math.floor(count / 2);
  if (count % 2 === 0) {
    median = roundTo((sorted[mid - 1] + sorted[mid]) / 2, 4);
  } else {
    median = sorted[mid];
  }

  // Mode — find most frequent value(s)
  const freq = {};
  for (const n of numbers) {
    freq[n] = (freq[n] || 0) + 1;
  }
  const maxFreq = Math.max(...Object.values(freq));
  const mode = Object.keys(freq)
    .filter(k => freq[k] === maxFreq)
    .map(Number);

  // Variance and standard deviation (population)
  const variance = roundTo(
    numbers.reduce((acc, n) => acc + Math.pow(n - (sum / count), 2), 0) / count,
    4
  );
  const standard_deviation = roundTo(Math.sqrt(variance), 4);

  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const range = roundTo(max - min, 4);

  return {
    data: numbers,
    count,
    sum,
    mean,
    median,
    mode,
    min,
    max,
    range,
    variance,
    standard_deviation,
  };
}

// ─── 5. Carbon Footprint Estimator ─────────────────────────────────────────

/**
 * Emission factors for common activities.
 * Values represent kg CO2 per unit (km, hour, kg, kWh).
 * Based on global averages — actual emissions vary by region and conditions.
 * @type {Object<string, {factor: number, unit: string, description: string}>}
 */
const EMISSION_FACTORS = {
  flight:      { factor: 0.255,  unit: 'km',  description: 'Economy class flight' },
  car:         { factor: 0.21,   unit: 'km',  description: 'Average car journey' },
  bus:         { factor: 0.089,  unit: 'km',  description: 'Bus journey' },
  train:       { factor: 0.041,  unit: 'km',  description: 'Train journey' },
  streaming:   { factor: 0.036,  unit: 'hours', description: 'Video streaming' },
  beef:        { factor: 27,     unit: 'kg',  description: 'Beef production' },
  chicken:     { factor: 6.9,    unit: 'kg',  description: 'Chicken production' },
  rice:        { factor: 2.7,    unit: 'kg',  description: 'Rice production' },
  electricity: { factor: 0.42,   unit: 'kWh', description: 'Electricity (global average)' },
};

/**
 * Estimate the carbon footprint of a given activity.
 * Uses built-in emission factors for common activities (transport, food, energy).
 * Calculates total kg CO2 and the number of trees needed to offset annually.
 *
 * Disclaimer: Estimates are based on global averages. Actual emissions vary
 * significantly by region, vehicle type, energy source, and specific conditions.
 *
 * @param {object} query - Query parameters
 * @param {string} query.activity - Activity type (e.g. "car", "flight", "beef", "streaming")
 * @param {string|number} [query.km] - Distance in kilometers (for transport activities)
 * @param {string|number} [query.hours] - Duration in hours (for time-based activities)
 * @param {string|number} [query.kg] - Weight in kilograms (for food activities)
 * @param {string|number} [query.kwh] - Energy in kilowatt-hours (for electricity)
 * @returns {object} Footprint data with kg_co2, trees_to_offset, and equivalent_description
 *
 * @example
 * carbonFootprint({ activity: "flight", km: 1000 })
 * // => { activity: "flight", amount: 1000, unit: "km", kg_co2: 255, trees_to_offset: 12, ... }
 */
async function carbonFootprint(query) {
  if (!query.activity) {
    return { error: 'Missing required parameter: activity' };
  }

  const activity = String(query.activity).toLowerCase().trim();
  const factorData = EMISSION_FACTORS[activity];

  if (!factorData) {
    return {
      error: `Unknown activity: "${query.activity}"`,
      supported_activities: Object.keys(EMISSION_FACTORS),
      hint: 'Provide one of the supported activity types',
    };
  }

  // Determine the amount based on the activity's expected unit
  let amount = null;
  let unit = factorData.unit;

  if (unit === 'km') {
    amount = query.km != null ? parseFloat(query.km) : null;
  } else if (unit === 'hours') {
    amount = query.hours != null ? parseFloat(query.hours) : null;
  } else if (unit === 'kg') {
    amount = query.kg != null ? parseFloat(query.kg) : null;
  } else if (unit === 'kWh') {
    amount = query.kwh != null ? parseFloat(query.kwh) : null;
  }

  if (amount == null || isNaN(amount) || amount <= 0) {
    return {
      error: `Missing or invalid amount for activity "${activity}". Provide "${unit}" parameter as a positive number.`,
      expected_parameter: unit === 'kWh' ? 'kwh' : unit,
      example: `?activity=${activity}&${unit === 'kWh' ? 'kwh' : unit}=100`,
    };
  }

  const kg_co2 = roundTo(amount * factorData.factor, 4);
  const trees_to_offset = Math.ceil(kg_co2 / 22);

  // Build an equivalent description comparing to car driving
  const car_km = roundTo(kg_co2 / 0.21, 1);
  const equivalent_description = `Equivalent to driving a car approximately ${car_km} km`;

  return {
    activity,
    amount,
    unit,
    kg_co2,
    trees_to_offset,
    equivalent_description,
    disclaimer: 'Estimates based on global averages. Actual emissions vary by region and specific conditions.',
  };
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
  mathSolve,
  periodicTable,
  spaceFacts,
  statisticsCalc,
  carbonFootprint,
};
