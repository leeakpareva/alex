#!/usr/bin/env node
/**
 * Generates an HTML test report from vitest JSON output
 * Usage: vitest run --reporter=json --outputFile=test-report.json && node tests/generate-report.js
 */

import { readFile, writeFile } from 'fs/promises';
import path from 'path';

const JSON_FILE = path.resolve(import.meta.dirname, '../test-report.json');
const HTML_FILE = path.resolve(import.meta.dirname, '../test-report.html');

async function generate() {
    let data;
    try {
        data = JSON.parse(await readFile(JSON_FILE, 'utf-8'));
    } catch (err) {
        console.error('Could not read test-report.json:', err.message);
        process.exit(1);
    }

    const suites = data.testResults || [];
    const totalTests = data.numTotalTests || 0;
    const passed = data.numPassedTests || 0;
    const failed = data.numFailedTests || 0;
    const skipped = data.numPendingTests || 0;
    const duration = ((data.testResults || []).reduce((s, r) => s + (r.endTime - r.startTime), 0) / 1000).toFixed(2);
    const passRate = totalTests > 0 ? ((passed / totalTests) * 100).toFixed(1) : '0';
    const timestamp = new Date().toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'full', timeStyle: 'medium' });

    let suitesHtml = '';
    for (const suite of suites) {
        const suiteName = path.relative(path.resolve(import.meta.dirname, '..'), suite.name);
        const suiteStatus = suite.status === 'passed' ? 'pass' : 'fail';

        let testsHtml = '';
        for (const test of suite.assertionResults || []) {
            const status = test.status === 'passed' ? 'pass' : test.status === 'failed' ? 'fail' : 'skip';
            const icon = status === 'pass' ? '&#10003;' : status === 'fail' ? '&#10007;' : '&#9644;';
            const errorHtml = test.failureMessages?.length
                ? `<pre class="error">${escHtml(test.failureMessages.join('\n')).substring(0, 1000)}</pre>`
                : '';
            const dur = test.duration ? `${test.duration}ms` : '';

            testsHtml += `
                <tr class="${status}">
                    <td class="icon">${icon}</td>
                    <td class="test-name">${escHtml(test.ancestorTitles?.join(' > ') || '')} > ${escHtml(test.title)}</td>
                    <td class="status">${status.toUpperCase()}</td>
                    <td class="dur">${dur}</td>
                </tr>
                ${errorHtml ? `<tr class="error-row"><td colspan="4">${errorHtml}</td></tr>` : ''}`;
        }

        suitesHtml += `
            <div class="suite ${suiteStatus}">
                <div class="suite-header">
                    <span class="suite-name">${escHtml(suiteName)}</span>
                    <span class="suite-status ${suiteStatus}">${suiteStatus.toUpperCase()}</span>
                </div>
                <table class="tests">${testsHtml}</table>
            </div>`;
    }

    // Categorize failures for improvement plan
    const failures = [];
    for (const suite of suites) {
        for (const test of suite.assertionResults || []) {
            if (test.status === 'failed') {
                failures.push({
                    suite: path.relative(path.resolve(import.meta.dirname, '..'), suite.name),
                    test: test.title,
                    ancestors: test.ancestorTitles?.join(' > ') || '',
                    error: test.failureMessages?.[0]?.substring(0, 500) || 'Unknown error',
                });
            }
        }
    }

    let improvementHtml = '';
    if (failures.length > 0) {
        improvementHtml = `
            <div class="section">
                <h2>Improvement Plan — ${failures.length} Failure(s) to Fix</h2>
                <table class="improvements">
                    <thead><tr><th>#</th><th>Test</th><th>File</th><th>Error Summary</th><th>Suggested Action</th></tr></thead>
                    <tbody>
                    ${failures.map((f, i) => `
                        <tr>
                            <td>${i + 1}</td>
                            <td>${escHtml(f.ancestors)} > ${escHtml(f.test)}</td>
                            <td class="mono">${escHtml(f.suite)}</td>
                            <td><pre class="error-inline">${escHtml(f.error.split('\n')[0])}</pre></td>
                            <td>Investigate and fix the failing assertion</td>
                        </tr>
                    `).join('')}
                    </tbody>
                </table>
            </div>`;
    } else {
        improvementHtml = `
            <div class="section all-pass">
                <h2>All Tests Passing</h2>
                <p>No failures detected. Consider adding more test coverage for edge cases.</p>
            </div>`;
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ALEX Test Report</title>
<style>
    :root { --bg: #0a0a0f; --card: #12121a; --border: #1e1e2e; --text: #e0e0e0; --muted: #888;
            --green: #22c55e; --red: #ef4444; --amber: #f59e0b; --accent: #6366f1; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
           background: var(--bg); color: var(--text); padding: 1.5rem; min-height: 100vh; }
    h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
    h2 { font-size: 1.1rem; margin-bottom: 0.75rem; color: var(--accent); }
    .header { margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid var(--border); }
    .meta { color: var(--muted); font-size: 0.8rem; }
    .summary { display: grid; grid-template-columns: repeat(5, 1fr); gap: 0.75rem; margin-bottom: 1.5rem; }
    .stat { background: var(--card); border: 1px solid var(--border); border-radius: 10px;
            padding: 1rem; text-align: center; }
    .stat-value { font-size: 1.8rem; font-weight: 700; }
    .stat-value.pass { color: var(--green); }
    .stat-value.fail { color: var(--red); }
    .stat-value.skip { color: var(--amber); }
    .stat-value.rate { color: var(--accent); }
    .stat-label { color: var(--muted); font-size: 0.7rem; text-transform: uppercase; margin-top: 0.25rem; }
    .section { margin-bottom: 1.5rem; }
    .suite { background: var(--card); border: 1px solid var(--border); border-radius: 10px;
             overflow: hidden; margin-bottom: 0.75rem; }
    .suite-header { display: flex; justify-content: space-between; padding: 0.75rem 1rem;
                    border-bottom: 1px solid var(--border); background: rgba(255,255,255,0.02); }
    .suite-name { font-weight: 600; font-size: 0.85rem; }
    .suite-status { font-size: 0.7rem; font-weight: 600; padding: 0.2rem 0.5rem; border-radius: 4px; }
    .suite-status.pass { background: rgba(34,197,94,0.15); color: var(--green); }
    .suite-status.fail { background: rgba(239,68,68,0.15); color: var(--red); }
    .tests { width: 100%; border-collapse: collapse; }
    .tests tr { border-bottom: 1px solid var(--border); }
    .tests tr:last-child { border-bottom: none; }
    .tests td { padding: 0.5rem 0.75rem; font-size: 0.8rem; }
    .tests tr.pass .icon { color: var(--green); }
    .tests tr.fail .icon { color: var(--red); }
    .tests tr.skip .icon { color: var(--amber); }
    .icon { width: 24px; font-size: 1rem; }
    .test-name { flex: 1; }
    .status { font-weight: 600; font-size: 0.7rem; text-align: right; }
    .dur { color: var(--muted); font-size: 0.7rem; text-align: right; width: 60px; }
    .error { background: rgba(239,68,68,0.1); color: var(--red); padding: 0.5rem; border-radius: 4px;
             font-size: 0.7rem; overflow-x: auto; max-height: 150px; white-space: pre-wrap; word-break: break-word; }
    .error-row td { padding: 0 0.75rem 0.5rem 3rem; }
    .improvements { width: 100%; border-collapse: collapse; background: var(--card); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
    .improvements th { background: rgba(255,255,255,0.03); text-align: left; padding: 0.6rem; font-size: 0.7rem;
                       text-transform: uppercase; color: var(--muted); border-bottom: 1px solid var(--border); }
    .improvements td { padding: 0.6rem; font-size: 0.8rem; border-bottom: 1px solid var(--border); }
    .mono { font-family: 'SF Mono', Consolas, monospace; font-size: 0.75rem; }
    .error-inline { background: rgba(239,68,68,0.1); color: var(--red); padding: 0.25rem 0.5rem;
                    border-radius: 3px; font-size: 0.7rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 300px; }
    .all-pass { background: rgba(34,197,94,0.08); border: 1px solid rgba(34,197,94,0.2);
                border-radius: 10px; padding: 1.5rem; text-align: center; }
    .all-pass h2 { color: var(--green); }
    .bar { height: 8px; background: var(--border); border-radius: 4px; overflow: hidden; margin-bottom: 1.5rem; }
    .bar-fill { height: 100%; border-radius: 4px; }
    .bar-fill.good { background: var(--green); }
    .bar-fill.warn { background: var(--amber); }
    .bar-fill.bad { background: var(--red); }
    @media (max-width: 768px) { .summary { grid-template-columns: repeat(3, 1fr); } }
</style>
</head>
<body>
    <div class="header">
        <h1>ALEX — Test Report</h1>
        <div class="meta">${timestamp} | navada-1 | vitest</div>
    </div>

    <div class="summary">
        <div class="stat"><div class="stat-value">${totalTests}</div><div class="stat-label">Total Tests</div></div>
        <div class="stat"><div class="stat-value pass">${passed}</div><div class="stat-label">Passed</div></div>
        <div class="stat"><div class="stat-value fail">${failed}</div><div class="stat-label">Failed</div></div>
        <div class="stat"><div class="stat-value skip">${skipped}</div><div class="stat-label">Skipped</div></div>
        <div class="stat"><div class="stat-value rate">${passRate}%</div><div class="stat-label">Pass Rate</div></div>
    </div>

    <div class="bar">
        <div class="bar-fill ${parseFloat(passRate) >= 90 ? 'good' : parseFloat(passRate) >= 70 ? 'warn' : 'bad'}"
             style="width:${passRate}%"></div>
    </div>

    <div class="section">
        <h2>Test Suites (${duration}s)</h2>
        ${suitesHtml}
    </div>

    ${improvementHtml}

    <div style="text-align:center;padding:1.5rem;color:var(--muted);font-size:0.7rem;">
        ALEX Test Report — NAVADA — Generated automatically by vitest + generate-report.js
    </div>
</body>
</html>`;

    await writeFile(HTML_FILE, html);
    console.log(`\nTest report written to: ${HTML_FILE}`);
    console.log(`  Total: ${totalTests} | Passed: ${passed} | Failed: ${failed} | Skipped: ${skipped} | Rate: ${passRate}%`);
    if (failures.length > 0) {
        console.log(`\n  Failures to fix:`);
        for (const f of failures) {
            console.log(`    - ${f.ancestors} > ${f.test}`);
        }
    }
}

function escHtml(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

generate();
