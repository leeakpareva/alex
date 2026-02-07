/**
 * Generate retro neon QR codes for alexnavada.xyz
 * Outputs PNG (1024px) + SVG to dashboard-vercel/public/qr/
 *
 * Usage: node scripts/generate-qr.mjs
 * Override URL: QR_TARGET_URL=https://example.com node scripts/generate-qr.mjs
 */

import QRCode from 'qrcode';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TARGET_URL = process.env.QR_TARGET_URL || 'https://alexnavada.xyz/qr';
const OUT_DIR = join(__dirname, '..', 'dashboard-vercel', 'public', 'qr');

const COLORS = {
  module: '#FF2D78',   // neon pink
  background: '#0D0D0D', // near-black
};

mkdirSync(OUT_DIR, { recursive: true });

// --- PNG (1024x1024) ---
const pngBuffer = await QRCode.toBuffer(TARGET_URL, {
  errorCorrectionLevel: 'H',
  width: 1024,
  margin: 4,
  color: {
    dark: COLORS.module,
    light: COLORS.background,
  },
});

const pngPath = join(OUT_DIR, 'alex-qr.png');
writeFileSync(pngPath, pngBuffer);
console.log(`PNG: ${pngPath} (${pngBuffer.length} bytes)`);

// --- SVG with center ALEX text ---
const svgRaw = await QRCode.toString(TARGET_URL, {
  type: 'svg',
  errorCorrectionLevel: 'H',
  margin: 4,
  color: {
    dark: COLORS.module,
    light: COLORS.background,
  },
});

// Inject center "ALEX" text with neon glow into the SVG
// The SVG viewBox tells us the coordinate space
const viewBoxMatch = svgRaw.match(/viewBox="0 0 (\d+) (\d+)"/);
const vbWidth = viewBoxMatch ? parseInt(viewBoxMatch[1]) : 49;
const vbHeight = viewBoxMatch ? parseInt(viewBoxMatch[2]) : 49;
const cx = vbWidth / 2;
const cy = vbHeight / 2;
const fontSize = Math.round(vbWidth * 0.08);

const glowFilter = `
  <defs>
    <filter id="neonGlow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="0.5" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>`;

const textEl = `
  <rect x="${cx - fontSize * 1.6}" y="${cy - fontSize * 0.7}" width="${fontSize * 3.2}" height="${fontSize * 1.4}" rx="0.5" fill="${COLORS.background}"/>
  <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central"
        font-family="monospace" font-weight="bold" font-size="${fontSize}"
        fill="${COLORS.module}" filter="url(#neonGlow)">ALEX</text>`;

// Insert defs + text before closing </svg>
const svg = svgRaw
  .replace('</svg>', `${glowFilter}${textEl}\n</svg>`);

const svgPath = join(OUT_DIR, 'alex-qr.svg');
writeFileSync(svgPath, svg);
console.log(`SVG: ${svgPath} (${svg.length} bytes)`);

console.log(`\nEncoded URL: ${TARGET_URL}`);
console.log('Error correction: H (30% redundancy)');
console.log(`Colors: ${COLORS.module} on ${COLORS.background}`);
