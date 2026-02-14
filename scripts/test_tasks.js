#!/usr/bin/env node

/**
 * Manual task trigger for testing Railway scheduled tasks
 * Use this to verify tasks are working before waiting for cron
 */

import http from 'http';

const ALEX_PORT = process.env.ALEX_PORT || '9090';
const API_TOKEN = process.env.CONTROL_API_TOKEN || '';

// List of all tasks to test
const TASKS = [
    // Core tasks to test first
    { name: 'dashboard-sync', critical: true },
    { name: 'morning-briefing', critical: true },
    { name: 'evening-summary', critical: true },

    // Secondary tasks
    { name: 'api-data-refresh', critical: false },
    { name: 'check-followups', critical: false },
    { name: 'inbox-review', critical: false },
    { name: 'midmorning-checkin', critical: false },
    { name: 'midday-research', critical: false },
    { name: 'afternoon-checkin', critical: false },
    { name: 'ralph-review', critical: false },
    { name: 'daily-ops-report', critical: false },
];

async function triggerTask(taskName) {
    return new Promise((resolve) => {
        const data = JSON.stringify({ task: taskName });

        const options = {
            hostname: '127.0.0.1',
            port: ALEX_PORT,
            path: '/api/trigger',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': data.length,
                ...(API_TOKEN && { 'Authorization': `Bearer ${API_TOKEN}` })
            },
            timeout: 30000
        };

        const startTime = Date.now();

        const req = http.request(options, (res) => {
            let responseData = '';

            res.on('data', (chunk) => {
                responseData += chunk;
            });

            res.on('end', () => {
                const duration = Date.now() - startTime;
                const success = res.statusCode >= 200 && res.statusCode < 300;

                resolve({
                    task: taskName,
                    success,
                    status: res.statusCode,
                    duration,
                    response: responseData.substring(0, 200)
                });
            });
        });

        req.on('error', (error) => {
            const duration = Date.now() - startTime;
            resolve({
                task: taskName,
                success: false,
                error: error.message,
                duration
            });
        });

        req.on('timeout', () => {
            req.destroy();
            resolve({
                task: taskName,
                success: false,
                error: 'Timeout after 30s',
                duration: 30000
            });
        });

        req.write(data);
        req.end();
    });
}

async function runTests() {
    console.log('🧪 Testing Alex Scheduled Tasks');
    console.log('================================\n');

    const results = [];
    let criticalFailures = 0;
    let nonCriticalFailures = 0;

    // Test each task
    for (const task of TASKS) {
        process.stdout.write(`Testing ${task.name}... `);

        const result = await triggerTask(task.name);
        results.push(result);

        if (result.success) {
            console.log(`✅ OK (${result.duration}ms)`);
        } else {
            console.log(`❌ FAIL - ${result.error || `HTTP ${result.status}`}`);
            if (task.critical) {
                criticalFailures++;
            } else {
                nonCriticalFailures++;
            }
        }

        // Small delay between tests
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Summary
    console.log('\n================================');
    console.log('📊 Test Summary');
    console.log('================================\n');

    const totalTests = results.length;
    const passedTests = results.filter(r => r.success).length;
    const failedTests = totalTests - passedTests;

    console.log(`Total Tests: ${totalTests}`);
    console.log(`Passed: ${passedTests} ✅`);
    console.log(`Failed: ${failedTests} ❌`);

    if (criticalFailures > 0) {
        console.log(`\n⚠️  CRITICAL: ${criticalFailures} critical task(s) failed!`);
    }

    if (nonCriticalFailures > 0) {
        console.log(`\n⚠️  WARNING: ${nonCriticalFailures} non-critical task(s) failed`);
    }

    // Detailed failure info
    if (failedTests > 0) {
        console.log('\n❌ Failed Tasks:');
        for (const result of results) {
            if (!result.success) {
                console.log(`  - ${result.task}: ${result.error || `HTTP ${result.status}`}`);
            }
        }
    }

    // Performance stats
    console.log('\n⏱  Performance:');
    const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;
    const maxDuration = Math.max(...results.map(r => r.duration));
    const minDuration = Math.min(...results.map(r => r.duration));

    console.log(`  Average: ${Math.round(avgDuration)}ms`);
    console.log(`  Fastest: ${Math.round(minDuration)}ms`);
    console.log(`  Slowest: ${Math.round(maxDuration)}ms`);

    // Exit code
    if (criticalFailures > 0) {
        console.log('\n❌ Tests FAILED - Critical tasks not working');
        process.exit(1);
    } else if (passedTests === totalTests) {
        console.log('\n✅ All tests PASSED!');
        process.exit(0);
    } else {
        console.log('\n⚠️  Tests completed with warnings');
        process.exit(0);
    }
}

// Run the tests
console.log(`Connecting to Alex on port ${ALEX_PORT}...\n`);

runTests().catch(error => {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
});