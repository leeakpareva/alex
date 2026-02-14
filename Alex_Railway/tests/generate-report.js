#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

const inputPath = join(projectRoot, 'test-report.json');
const outputPath = join(projectRoot, 'test-report.html');

try {
    const reportData = JSON.parse(readFileSync(inputPath, 'utf-8'));

    const {
        numTotalTests,
        numPassedTests,
        numFailedTests,
        numPendingTests,
        numTotalTestSuites,
        numPassedTestSuites,
        numFailedTestSuites,
        testResults,
        startTime,
        success
    } = reportData;

    const passRate = numTotalTests > 0
        ? ((numPassedTests / numTotalTests) * 100).toFixed(1)
        : 0;

    const duration = Date.now() - startTime;
    const durationStr = duration > 1000
        ? `${(duration / 1000).toFixed(2)}s`
        : `${duration}ms`;

    const timestamp = new Date().toISOString();

    const statusColor = success ? '#22c55e' : '#ef4444';
    const statusText = success ? 'PASSED' : 'FAILED';

    let suitesHtml = '';
    for (const suite of testResults) {
        const suiteName = suite.name.replace(projectRoot + '/', '');
        const suiteStatus = suite.status === 'passed' ? '✓' : '✗';
        const suiteColor = suite.status === 'passed' ? '#22c55e' : '#ef4444';

        let testsHtml = '';
        for (const test of suite.assertionResults) {
            const testStatus = test.status === 'passed' ? '✓'
                : test.status === 'skipped' ? '○'
                : '✗';
            const testColor = test.status === 'passed' ? '#22c55e'
                : test.status === 'skipped' ? '#f59e0b'
                : '#ef4444';

            testsHtml += `
                <div style="padding: 4px 0 4px 20px; border-bottom: 1px solid #e5e7eb;">
                    <span style="color: ${testColor}; font-weight: bold;">${testStatus}</span>
                    <span style="margin-left: 8px;">${test.title}</span>
                    ${test.duration ? `<span style="color: #9ca3af; margin-left: 8px;">(${test.duration.toFixed(1)}ms)</span>` : ''}
                    ${test.failureMessages && test.failureMessages.length > 0
                        ? `<pre style="color: #ef4444; font-size: 12px; margin: 4px 0 0 28px; white-space: pre-wrap;">${test.failureMessages.join('\n').substring(0, 500)}</pre>`
                        : ''}
                </div>`;
        }

        suitesHtml += `
            <div style="margin-bottom: 16px; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
                <div style="padding: 12px; background: #f9fafb; border-bottom: 1px solid #e5e7eb;">
                    <span style="color: ${suiteColor}; font-weight: bold; font-size: 18px;">${suiteStatus}</span>
                    <span style="margin-left: 8px; font-weight: 600;">${suiteName}</span>
                </div>
                <div style="padding: 8px 12px;">
                    ${testsHtml}
                </div>
            </div>`;
    }

    let improvementPlan = '';
    if (!success) {
        const failedSuites = testResults.filter(s => s.status === 'failed');
        improvementPlan = `
            <div style="margin-top: 24px; padding: 16px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px;">
                <h3 style="margin: 0 0 12px 0; color: #991b1b;">Improvement Plan</h3>
                <ul style="margin: 0; padding-left: 20px; color: #991b1b;">
                    ${failedSuites.map(s => {
                        const failedTests = s.assertionResults.filter(t => t.status === 'failed');
                        return failedTests.map(t =>
                            `<li><strong>${t.title}</strong>: Review and fix the failing assertion</li>`
                        ).join('');
                    }).join('')}
                </ul>
            </div>`;
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ALEX Test Report - ${timestamp.split('T')[0]}</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            max-width: 1000px;
            margin: 0 auto;
            padding: 20px;
            background: #ffffff;
            color: #1f2937;
        }
        h1, h2, h3 { margin-top: 0; }
        .summary-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 16px;
            margin: 20px 0;
        }
        .stat-card {
            padding: 16px;
            border-radius: 8px;
            text-align: center;
            background: #f9fafb;
            border: 1px solid #e5e7eb;
        }
        .stat-value {
            font-size: 32px;
            font-weight: bold;
        }
        .stat-label {
            font-size: 14px;
            color: #6b7280;
        }
    </style>
</head>
<body>
    <h1>ALEX Test Report</h1>
    <p style="color: #6b7280;">Generated: ${timestamp}</p>

    <div style="padding: 16px; background: ${statusColor}15; border: 2px solid ${statusColor}; border-radius: 8px; margin: 20px 0;">
        <h2 style="margin: 0; color: ${statusColor};">${statusText}</h2>
        <p style="margin: 8px 0 0 0;">Pass Rate: <strong>${passRate}%</strong> | Duration: ${durationStr}</p>
    </div>

    <div class="summary-grid">
        <div class="stat-card">
            <div class="stat-value" style="color: #3b82f6;">${numTotalTests}</div>
            <div class="stat-label">Total Tests</div>
        </div>
        <div class="stat-card">
            <div class="stat-value" style="color: #22c55e;">${numPassedTests}</div>
            <div class="stat-label">Passed</div>
        </div>
        <div class="stat-card">
            <div class="stat-value" style="color: #ef4444;">${numFailedTests}</div>
            <div class="stat-label">Failed</div>
        </div>
        <div class="stat-card">
            <div class="stat-value" style="color: #f59e0b;">${numPendingTests}</div>
            <div class="stat-label">Skipped</div>
        </div>
    </div>

    <div class="summary-grid">
        <div class="stat-card">
            <div class="stat-value">${numTotalTestSuites}</div>
            <div class="stat-label">Test Suites</div>
        </div>
        <div class="stat-card">
            <div class="stat-value" style="color: #22c55e;">${numPassedTestSuites}</div>
            <div class="stat-label">Suites Passed</div>
        </div>
        <div class="stat-card">
            <div class="stat-value" style="color: #ef4444;">${numFailedTestSuites}</div>
            <div class="stat-label">Suites Failed</div>
        </div>
    </div>

    ${improvementPlan}

    <h2 style="margin-top: 32px;">Test Suite Details</h2>
    ${suitesHtml}

    <footer style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e7eb; color: #9ca3af; font-size: 14px;">
        ALEX Test Suite | NAVADA | ${timestamp.split('T')[0]}
    </footer>
</body>
</html>`;

    writeFileSync(outputPath, html);
    console.log(`HTML report generated: ${outputPath}`);
    console.log(`Summary: ${numPassedTests}/${numTotalTests} tests passed (${passRate}%)`);

} catch (error) {
    console.error('Error generating report:', error.message);
    process.exit(1);
}
