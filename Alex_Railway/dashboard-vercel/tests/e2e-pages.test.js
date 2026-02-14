/**
 * E2E Page Tests for ALEX Dashboard (alexnavada.xyz)
 *
 * Tests all pages for:
 * - HTTP 200 status codes
 * - Expected content presence
 * - Theme integration (CSS, JS)
 * - Navigation elements
 * - Mobile meta tags
 *
 * Run: node /home/head/navada-1/dashboard-vercel/tests/e2e-pages.test.js
 *
 * Requires the local dev server running at http://localhost:3333
 * Start with: cd /home/head/navada-1/dashboard-vercel && node local-server.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3333';

let passed = 0;
let failed = 0;
const results = [];
const startTime = Date.now();

// Page response cache to avoid redundant fetches
const pageCache = {};

function log(status, name, detail) {
  const icon = status === 'PASS' ? '[PASS]' : '[FAIL]';
  const line = `${icon} ${name}${detail ? ' -- ' + detail : ''}`;
  console.log(line);
  results.push({ status, name, detail: detail || '' });
  if (status === 'PASS') passed++;
  else failed++;
}

function test(name, fn) {
  return fn().then(
    () => log('PASS', name),
    (err) => log('FAIL', name, String(err.message || err))
  );
}

function fetchPage(urlPath) {
  if (pageCache[urlPath]) return Promise.resolve(pageCache[urlPath]);
  return new Promise((resolve, reject) => {
    const fullUrl = BASE_URL + urlPath;
    const req = http.get(fullUrl, { timeout: 10000 }, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        const result = { statusCode: res.statusCode, headers: res.headers, body };
        pageCache[urlPath] = result;
        resolve(result);
      });
    });
    req.on('error', (err) => reject(new Error(`Fetch failed for ${urlPath}: ${err.message}`)));
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout fetching ${urlPath}`)); });
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertContains(body, text, pageName) {
  if (!body.toLowerCase().includes(text.toLowerCase())) {
    throw new Error(`Page "${pageName}" does not contain expected text: "${text}"`);
  }
}

// =============================================
// Define all pages using clean URLs (Vercel rewrites)
// =============================================

const ALL_PAGES = [
  { path: '/', name: 'Home' },
  { path: '/dashboard', name: 'Dashboard' },
  { path: '/api-library', name: 'API Library' },
  { path: '/chat', name: 'Chat' },
  { path: '/experiment', name: 'Experiment' },
  { path: '/experiment/phase-1', name: 'Phase 1' },
  { path: '/experiment/phase-2', name: 'Phase 2' },
  { path: '/experiment/phase-3', name: 'Phase 3' },
  { path: '/experiment/phase-4', name: 'Phase 4' },
  { path: '/live-log', name: 'Live Log' },
  { path: '/articles', name: 'Articles' },
  { path: '/articles/alex-vs-openclaw', name: 'ALEX vs OpenClaw' },
  { path: '/contact', name: 'Contact' },
  { path: '/faq', name: 'FAQ' },
  { path: '/terms', name: 'Terms' },
  { path: '/navada-admin', name: 'NAVADA Admin' },
];

// =============================================
// Test Suite
// =============================================

async function runTests() {
  console.log('='.repeat(60));
  console.log('ALEX Dashboard E2E Page Tests');
  console.log('Server: ' + BASE_URL);
  console.log('Date: ' + new Date().toISOString());
  console.log('='.repeat(60));
  console.log('');

  // ------------------------------------------
  // 1. PAGE LOADING (all return 200)
  // ------------------------------------------
  console.log('--- Page Loading (HTTP 200) ---');
  for (const page of ALL_PAGES) {
    await test(`${page.name} (${page.path}) returns 200`, async () => {
      const res = await fetchPage(page.path);
      assert(res.statusCode === 200, `Expected 200, got ${res.statusCode}`);
    });
  }
  console.log('');

  // ------------------------------------------
  // 2. CONTENT CHECKS
  // ------------------------------------------
  console.log('--- Content Checks ---');

  // Home page
  await test('Home contains "ALEX"', async () => {
    const res = await fetchPage('/');
    assertContains(res.body, 'ALEX', 'Home');
  });
  await test('Home contains "Future Economist"', async () => {
    const res = await fetchPage('/');
    assertContains(res.body, 'Future Economist', 'Home');
  });
  await test('Home contains "NAVADA"', async () => {
    const res = await fetchPage('/');
    assertContains(res.body, 'NAVADA', 'Home');
  });

  // Experiment page
  await test('Experiment contains "Token"', async () => {
    const res = await fetchPage('/experiment');
    assertContains(res.body, 'Token', 'Experiment');
  });
  await test('Experiment contains "Future of Work"', async () => {
    const res = await fetchPage('/experiment');
    assertContains(res.body, 'Future of Work', 'Experiment');
  });

  // Articles page
  await test('Articles contains "Articles"', async () => {
    const res = await fetchPage('/articles');
    assertContains(res.body, 'Articles', 'Articles');
  });
  await test('Articles contains "alex-vs-openclaw"', async () => {
    const res = await fetchPage('/articles');
    assertContains(res.body, 'alex-vs-openclaw', 'Articles');
  });

  // FAQ page
  await test('FAQ contains "FAQ"', async () => {
    const res = await fetchPage('/faq');
    assertContains(res.body, 'FAQ', 'FAQ');
  });
  await test('FAQ contains "accordion"', async () => {
    const res = await fetchPage('/faq');
    assertContains(res.body, 'accordion', 'FAQ');
  });

  // Terms page
  await test('Terms contains "Terms of Service"', async () => {
    const res = await fetchPage('/terms');
    assertContains(res.body, 'Terms of Service', 'Terms');
  });

  // Contact page
  await test('Contact contains "Contact"', async () => {
    const res = await fetchPage('/contact');
    assertContains(res.body, 'Contact', 'Contact');
  });
  await test('Contact contains "Telegram"', async () => {
    const res = await fetchPage('/contact');
    assertContains(res.body, 'Telegram', 'Contact');
  });

  // Phase pages
  await test('Phase 1 contains "Phase" and "Copilot"', async () => {
    const res = await fetchPage('/experiment/phase-1');
    assertContains(res.body, 'Phase', 'Phase 1');
    assertContains(res.body, 'Copilot', 'Phase 1');
  });
  await test('Phase 2 contains "Phase" and "Value Quantification"', async () => {
    const res = await fetchPage('/experiment/phase-2');
    assertContains(res.body, 'Phase', 'Phase 2');
    assertContains(res.body, 'Value Quantification', 'Phase 2');
  });
  await test('Phase 3 contains "Phase" and "Dynamic Compensation"', async () => {
    const res = await fetchPage('/experiment/phase-3');
    assertContains(res.body, 'Phase', 'Phase 3');
    assertContains(res.body, 'Dynamic Compensation', 'Phase 3');
  });
  await test('Phase 4 contains "Phase" and "Tokenized Economy"', async () => {
    const res = await fetchPage('/experiment/phase-4');
    assertContains(res.body, 'Phase', 'Phase 4');
    assertContains(res.body, 'Tokenized Economy', 'Phase 4');
  });

  console.log('');

  // ------------------------------------------
  // 3. THEME INTEGRATION
  // ------------------------------------------
  console.log('--- Theme Integration ---');

  for (const page of ALL_PAGES) {
    await test(`${page.name} includes theme.css`, async () => {
      const res = await fetchPage(page.path);
      assertContains(res.body, 'theme.css', page.name);
    });
  }

  for (const page of ALL_PAGES) {
    await test(`${page.name} includes nav.js`, async () => {
      const res = await fetchPage(page.path);
      assertContains(res.body, 'nav.js', page.name);
    });
  }

  // Pages that should include chat-widget.js (newer pages with the widget)
  const chatWidgetPages = [
    { path: '/', name: 'Home' },
    { path: '/experiment', name: 'Experiment' },
    { path: '/experiment/phase-1', name: 'Phase 1' },
    { path: '/experiment/phase-2', name: 'Phase 2' },
    { path: '/experiment/phase-3', name: 'Phase 3' },
    { path: '/experiment/phase-4', name: 'Phase 4' },
    { path: '/articles', name: 'Articles' },
    { path: '/articles/alex-vs-openclaw', name: 'ALEX vs OpenClaw' },
    { path: '/contact', name: 'Contact' },
    { path: '/faq', name: 'FAQ' },
    { path: '/terms', name: 'Terms' },
  ];

  for (const page of chatWidgetPages) {
    await test(`${page.name} includes chat-widget.js`, async () => {
      const res = await fetchPage(page.path);
      assertContains(res.body, 'chat-widget.js', page.name);
    });
  }

  console.log('');

  // ------------------------------------------
  // 4. NAVIGATION
  // ------------------------------------------
  console.log('--- Navigation ---');

  // All pages should include the nav.js script tag which injects site-nav
  for (const page of ALL_PAGES) {
    await test(`${page.name} has nav.js script tag for navigation`, async () => {
      const res = await fetchPage(page.path);
      const hasNavScript = res.body.includes('src="/nav.js"') || res.body.includes("src='/nav.js'");
      assert(hasNavScript, `Page "${page.name}" missing nav.js script tag`);
    });
  }

  // Home page links to key pages
  await test('Home links to /contact', async () => {
    const res = await fetchPage('/');
    assertContains(res.body, '/contact', 'Home');
  });
  await test('Home links to /articles', async () => {
    const res = await fetchPage('/');
    assertContains(res.body, '/articles', 'Home');
  });
  await test('Home links to /faq', async () => {
    const res = await fetchPage('/');
    assertContains(res.body, '/faq', 'Home');
  });
  await test('Home links to /terms', async () => {
    const res = await fetchPage('/');
    assertContains(res.body, '/terms', 'Home');
  });

  console.log('');

  // ------------------------------------------
  // 5. MOBILE META TAGS
  // ------------------------------------------
  console.log('--- Mobile Meta Tags ---');

  for (const page of ALL_PAGES) {
    await test(`${page.name} has viewport meta tag`, async () => {
      const res = await fetchPage(page.path);
      assertContains(res.body, 'name="viewport"', page.name);
    });
  }

  for (const page of ALL_PAGES) {
    await test(`${page.name} has theme-color meta tag`, async () => {
      const res = await fetchPage(page.path);
      assertContains(res.body, 'name="theme-color"', page.name);
    });
  }

  console.log('');

  // ------------------------------------------
  // Summary
  // ------------------------------------------
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  const total = passed + failed;

  console.log('='.repeat(60));
  console.log(`Results: ${passed} passed, ${failed} failed out of ${total} tests`);
  console.log(`Time: ${elapsed}s`);
  console.log('='.repeat(60));

  // ------------------------------------------
  // Write report
  // ------------------------------------------
  writeReport(elapsed, total);

  // Exit with failure code if any tests failed
  if (failed > 0) process.exit(1);
}

function writeReport(elapsed, total) {
  const reportPath = path.join(__dirname, 'e2e-report.txt');
  const now = new Date();
  const lines = [];

  lines.push('='.repeat(60));
  lines.push('ALEX Dashboard E2E Test Report');
  lines.push('='.repeat(60));
  lines.push('');
  lines.push(`Date:    ${now.toISOString()}`);
  lines.push(`Server:  ${BASE_URL}`);
  lines.push(`Time:    ${elapsed}s`);
  lines.push('');
  lines.push(`Total:   ${total}`);
  lines.push(`Passed:  ${passed}`);
  lines.push(`Failed:  ${failed}`);
  lines.push(`Status:  ${failed === 0 ? 'ALL PASSED' : 'SOME FAILURES'}`);
  lines.push('');
  lines.push('-'.repeat(60));
  lines.push('Test Details');
  lines.push('-'.repeat(60));
  lines.push('');

  for (const r of results) {
    const icon = r.status === 'PASS' ? '[PASS]' : '[FAIL]';
    let line = `  ${icon} ${r.name}`;
    if (r.status === 'FAIL' && r.detail) {
      line += `\n         Reason: ${r.detail}`;
    }
    lines.push(line);
  }

  lines.push('');

  // Failures summary
  const failures = results.filter(r => r.status === 'FAIL');
  if (failures.length > 0) {
    lines.push('-'.repeat(60));
    lines.push('Failures');
    lines.push('-'.repeat(60));
    lines.push('');
    for (const f of failures) {
      lines.push(`  [FAIL] ${f.name}`);
      lines.push(`         ${f.detail}`);
      lines.push('');
    }
  }

  lines.push('-'.repeat(60));
  lines.push('Summary');
  lines.push('-'.repeat(60));
  lines.push('');
  lines.push(`  ${total} total tests executed`);
  lines.push(`  ${passed} passed`);
  lines.push(`  ${failed} failed`);
  lines.push(`  Completed in ${elapsed} seconds`);
  lines.push(`  ${failed === 0 ? 'All tests passed successfully.' : `${failed} test(s) require attention.`}`);
  lines.push('');
  lines.push('='.repeat(60));
  lines.push(`Report generated: ${now.toISOString()}`);
  lines.push('='.repeat(60));

  fs.writeFileSync(reportPath, lines.join('\n') + '\n', 'utf-8');
  console.log(`\nReport written to: ${reportPath}`);
}

// Run
runTests().catch(err => {
  console.error('Test runner failed:', err);
  process.exit(2);
});
