# QR Code System

Scannable QR code that links to `alexnavada.xyz/qr`. The `/qr` endpoint performs a 302 redirect to a configurable destination, so the printed QR never needs reprinting.

## Flow

```
Phone camera scans QR
  → decodes https://alexnavada.xyz/qr
  → Vercel serves api/qr.js
  → 302 redirect to QR_DESTINATION_URL (default: https://alexnavada.xyz)
  → user lands on the main site
```

## Files

| File | Purpose |
|------|---------|
| `scripts/generate-qr.mjs` | Generates PNG + SVG QR codes |
| `dashboard-vercel/api/qr.js` | Serverless 302 redirect handler |
| `dashboard-vercel/public/qr/alex-qr.png` | 1024x1024 neon QR (generated) |
| `dashboard-vercel/public/qr/alex-qr.svg` | SVG QR with center "ALEX" text (generated) |
| `dashboard-vercel/vercel.json` | Routes `/qr` to the API handler |
| `src/gateway.js` | Telegram `/qr` command sends the PNG |

## Regenerating QR Codes

```bash
cd /home/head/navada-1
npm run generate:qr
```

Override the encoded URL:

```bash
QR_TARGET_URL=https://custom-url.com npm run generate:qr
```

Output goes to `dashboard-vercel/public/qr/`.

## Configuration

### Redirect destination (Vercel)

Set `QR_DESTINATION_URL` in Vercel environment variables. Defaults to `https://alexnavada.xyz`.

```bash
# Vercel dashboard → Settings → Environment Variables
# Or via CLI:
cd dashboard-vercel && vercel env add QR_DESTINATION_URL
```

### Encoded URL (QR image)

Set `QR_TARGET_URL` when running the generation script. Defaults to `https://alexnavada.xyz/qr`.

## QR Styling

- **Error correction**: H (30% redundancy) — tolerates a center logo or damage
- **Colors**: neon pink `#FF2D78` modules on dark `#0D0D0D` background
- **Size**: 1024x1024 PNG, scalable SVG
- **Margin**: 4 modules quiet zone
- **Center text** (SVG only): "ALEX" in monospace with neon glow filter

### Scannability rules

- Keep minimum 4-module quiet zone (white/light border)
- Finder patterns (three corner squares) must remain intact
- Maintain high contrast between modules and background
- H-level error correction allows up to 30% of modules to be obscured
- Test with both iPhone and Android native camera apps

## Testing

1. **Scan test**: Open `alex-qr.png`, scan with phone camera — should open `https://alexnavada.xyz/qr`
2. **Local redirect**: `node dashboard-vercel/local-server.js` then `curl -v localhost:3333/qr` — expect 302
3. **Production redirect**: `curl -v https://alexnavada.xyz/qr` — expect 302
4. **Telegram**: Send `/qr` to ALEX bot — should receive the QR image
5. **Cross-app scan**: Test via Telegram, WhatsApp, and native camera on both iOS and Android

## Telegram Command

`/qr` — Sends the QR PNG image to the chat. Available to all authorized users.
