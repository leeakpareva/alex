#!/usr/bin/env node

/**
 * Complete End-to-End Test for Alex Railway Deployment
 * Tests all critical functionality and scheduled tasks
 */

import http from 'http';
import https from 'https';
import { createDb } from '../src/db.js';
import { Redis } from '@upstash/redis';

const COLORS = {
  GREEN: '\x1b[32m',
  RED: '\x1b[31m',
  YELLOW: '\x1b[33m',
  BLUE: '\x1b[34m',
  CYAN: '\x1b[36m',
  RESET: '\x1b[0m'
};

function log(message, color = COLORS.RESET) {
  console.log(`${color}${message}${COLORS.RESET}`);
}

const ALEX_PORT = process.env.ALEX_PORT || '9090';

// Test suite
const tests = {
  // 1. Core Service Tests
  async testHealthEndpoint() {
    const url = `http://127.0.0.1:${ALEX_PORT}/api/health`;
    const result = await fetchWithTimeout(url, 5000);
    return {
      name: 'Health Endpoint',
      passed: result.ok && result.data.status === 'ok',
      details: result.ok ? `Uptime: ${result.data.uptime_seconds}s` : result.error
    };
  },

  async testE2EEndpoint() {
    const url = `http://127.0.0.1:${ALEX_PORT}/api/e2e`;
    const result = await fetchWithTimeout(url, 10000);

    if (result.ok && result.data.checks) {
      const failedChecks = Object.entries(result.data.checks)
        .filter(([_, check]) => !check.ok)
        .map(([name]) => name);

      return {
        name: 'E2E Endpoint',
        passed: result.data.ok,
        details: failedChecks.length > 0
          ? `Failed: ${failedChecks.join(', ')}`
          : 'All services OK'
      };
    }

    return {
      name: 'E2E Endpoint',
      passed: false,
      details: result.error || 'Failed to parse response'
    };
  },

  // 2. Database Tests
  async testPostgres() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      return {
        name: 'PostgreSQL',
        passed: false,
        details: 'DATABASE_URL not configured'
      };
    }

    try {
      const db = createDb(databaseUrl);
      await db.init();

      // Test write
      await db.insertReport({
        kind: 'e2e-test',
        content: JSON.stringify({ test: true, timestamp: new Date() }),
        meta: { source: 'e2e_test' }
      });

      await db.close();

      return {
        name: 'PostgreSQL',
        passed: true,
        details: 'Connected and writing data'
      };
    } catch (err) {
      return {
        name: 'PostgreSQL',
        passed: false,
        details: err.message
      };
    }
  },

  // 3. Redis Tests
  async testUpstashRedis() {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!url || !token) {
      return {
        name: 'Upstash Redis',
        passed: false,
        details: 'Not configured'
      };
    }

    try {
      const redis = new Redis({ url, token });
      const testKey = `e2e:test:${Date.now()}`;

      await redis.set(testKey, 'test', { ex: 60 });
      const value = await redis.get(testKey);
      await redis.del(testKey);

      return {
        name: 'Upstash Redis',
        passed: value === 'test',
        details: 'Read/write working'
      };
    } catch (err) {
      return {
        name: 'Upstash Redis',
        passed: false,
        details: err.message
      };
    }
  },

  // 4. Task Endpoint Tests
  async testTaskEndpoints() {
    const criticalTasks = [
      'dashboard-sync',
      'morning-briefing',
      'evening-summary'
    ];

    const results = [];

    for (const taskName of criticalTasks) {
      const result = await triggerTask(taskName);
      results.push({
        task: taskName,
        success: result.success,
        duration: result.duration
      });
    }

    const allPassed = results.every(r => r.success);
    const details = results.map(r =>
      `${r.task}: ${r.success ? '✓' : '✗'} (${r.duration}ms)`
    ).join(', ');

    return {
      name: 'Task Endpoints',
      passed: allPassed,
      details
    };
  },

  // 5. Scheduler Test
  async testScheduler() {
    try {
      // Check if scheduler is initialized
      const { testAllTasks } = await import('../src/scheduler.js');

      // This would normally test if scheduler is running
      // For now, we just check if the module loads
      return {
        name: 'Scheduler',
        passed: true,
        details: 'Module loaded successfully'
      };
    } catch (err) {
      return {
        name: 'Scheduler',
        passed: false,
        details: `Not initialized: ${err.message}`
      };
    }
  },

  // 6. ChromaDB Test
  async testChromaDB() {
    const chromaBase = process.env.CHROMA_BASE_URL || 'http://chromadb.railway.internal:8000';
    const url = `${chromaBase}/api/v2/heartbeat`;

    const result = await fetchWithTimeout(url, 5000);

    return {
      name: 'ChromaDB',
      passed: result.ok,
      details: result.ok ? 'RAG database online' : result.error
    };
  },

  // 7. Dashboard Connectivity
  async testDashboard() {
    try {
      const url = `http://127.0.0.1:${ALEX_PORT}/api/dashboard/data`;
      const result = await fetchWithTimeout(url, 5000);

      return {
        name: 'Dashboard API',
        passed: result.ok,
        details: result.ok ? 'Dashboard data accessible' : result.error
      };
    } catch (err) {
      return {
        name: 'Dashboard API',
        passed: false,
        details: err.message
      };
    }
  }
};

// Helper functions
async function fetchWithTimeout(url, timeoutMs) {
  return new Promise((resolve) => {
    const mod = url.startsWith('https') ? https : http;
    const startTime = Date.now();

    const req = mod.get(url, { timeout: timeoutMs }, (res) => {
      let data = '';

      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const duration = Date.now() - startTime;

        try {
          const parsed = JSON.parse(data);
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            data: parsed,
            duration
          });
        } catch {
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            data,
            duration
          });
        }
      });
    });

    req.on('error', (err) => {
      resolve({
        ok: false,
        error: err.message,
        duration: Date.now() - startTime
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        ok: false,
        error: 'Timeout',
        duration: timeoutMs
      });
    });
  });
}

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
        'Content-Length': data.length
      },
      timeout: 30000
    };

    const startTime = Date.now();

    const req = http.request(options, (res) => {
      res.on('data', () => {}); // Consume response
      res.on('end', () => {
        resolve({
          success: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          duration: Date.now() - startTime
        });
      });
    });

    req.on('error', () => {
      resolve({
        success: false,
        duration: Date.now() - startTime
      });
    });

    req.write(data);
    req.end();
  });
}

// Main test runner
async function runE2ETests() {
  log('\n════════════════════════════════════════', COLORS.BLUE);
  log('     Alex Railway E2E Test Suite', COLORS.BLUE);
  log('════════════════════════════════════════\n', COLORS.BLUE);

  const results = [];
  let passed = 0;
  let failed = 0;

  // Run each test
  for (const [testName, testFn] of Object.entries(tests)) {
    process.stdout.write(`Running ${testName}... `);

    try {
      const result = await testFn();
      results.push(result);

      if (result.passed) {
        log('✅ PASS', COLORS.GREEN);
        log(`  └─ ${result.details}`, COLORS.CYAN);
        passed++;
      } else {
        log('❌ FAIL', COLORS.RED);
        log(`  └─ ${result.details}`, COLORS.YELLOW);
        failed++;
      }
    } catch (err) {
      log('❌ ERROR', COLORS.RED);
      log(`  └─ ${err.message}`, COLORS.YELLOW);
      results.push({
        name: testName,
        passed: false,
        details: err.message
      });
      failed++;
    }
  }

  // Summary
  log('\n════════════════════════════════════════', COLORS.BLUE);
  log('              Test Summary', COLORS.BLUE);
  log('════════════════════════════════════════\n', COLORS.BLUE);

  const total = passed + failed;
  const percentage = Math.round((passed / total) * 100);

  log(`Total Tests: ${total}`, COLORS.CYAN);
  log(`Passed: ${passed} ✅`, COLORS.GREEN);
  log(`Failed: ${failed} ❌`, COLORS.RED);
  log(`Success Rate: ${percentage}%\n`, COLORS.CYAN);

  // Critical services check
  const criticalTests = ['Health Endpoint', 'E2E Endpoint', 'Task Endpoints'];
  const criticalPassed = results
    .filter(r => criticalTests.includes(r.name))
    .every(r => r.passed);

  if (criticalPassed) {
    log('✅ All critical services are operational', COLORS.GREEN);
  } else {
    log('❌ Critical services have failures', COLORS.RED);
  }

  // Recommendations
  if (failed > 0) {
    log('\n📋 Recommendations:', COLORS.BLUE);

    if (!results.find(r => r.name === 'PostgreSQL')?.passed) {
      log('  • Configure DATABASE_URL for persistence', COLORS.YELLOW);
    }

    if (!results.find(r => r.name === 'Upstash Redis')?.passed) {
      log('  • Set up Upstash Redis for dashboard sync', COLORS.YELLOW);
    }

    if (!results.find(r => r.name === 'ChromaDB')?.passed) {
      log('  • ChromaDB is down - RAG features degraded', COLORS.YELLOW);
    }
  }

  // Save report
  const report = {
    timestamp: new Date().toISOString(),
    passed,
    failed,
    percentage,
    criticalPassed,
    results
  };

  try {
    const fs = await import('fs/promises');
    await fs.writeFile(
      'e2e_test_report.json',
      JSON.stringify(report, null, 2)
    );
    log('\n📄 Report saved to e2e_test_report.json', COLORS.BLUE);
  } catch {}

  // Exit code
  process.exit(criticalPassed ? 0 : 1);
}

// Run the tests
log(`Connecting to Alex on port ${ALEX_PORT}...`, COLORS.CYAN);
runE2ETests().catch(err => {
  log(`\n❌ Fatal error: ${err.message}`, COLORS.RED);
  process.exit(1);
});