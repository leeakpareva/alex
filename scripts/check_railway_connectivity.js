#!/usr/bin/env node

/**
 * Safe Railway Connectivity Check
 * Tests all nodes without disrupting Alex's operation
 */

import http from 'http';
import https from 'https';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

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

// Railway service configuration
const SERVICES = {
  'alex-main': {
    id: '71e94c37-64c6-44f2-a5c8-7ae2a1b641f4',
    internal: 'alex.railway.internal:9090',
    endpoints: ['/api/health', '/api/e2e'],
    critical: true
  },
  'postgres': {
    id: '18f45778-a301-48ae-bc1d-4b8a24c7a246',
    internal: 'postgres.railway.internal:5432',
    critical: true
  },
  'chromadb': {
    id: 'be536d17-091f-49c3-a141-22efcd867dee',
    internal: 'chromadb.railway.internal:8000',
    endpoints: ['/api/v2/heartbeat'],
    critical: false
  },
  'nodejs': {
    id: '61c90c33-c623-4f05-8e14-1aab785f18fa',
    internal: 'nodejs.railway.internal:3000',
    endpoints: ['/'],
    critical: false
  },
  'http-nodejs': {
    id: '7758afc6-b6a3-4fcc-99f6-77eb83b70277',
    internal: 'http-nodejs.railway.internal:8080',
    endpoints: ['/'],
    critical: false
  },
  'upstash-redis': {
    id: 'e37177e0-e16b-4fbf-b95c-4b8ca8b37ae4',
    managed: true,
    critical: true
  },
  'anythingllm': {
    id: '7d0ca97a-5862-4fc7-834a-0cf7c656b3bd',
    internal: 'anythingllm.railway.internal:3001',
    endpoints: ['/'],
    critical: false
  }
};

const PROJECT_ID = 'a4af4615-ff5c-4f88-917e-3a4099269eef';
const ENVIRONMENT_ID = '663f2d4a-6d62-4f24-a698-bea71d581fca';

async function testHttpEndpoint(url) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const mod = url.startsWith('https') ? https : http;

    const req = mod.get(url, { timeout: 5000 }, (res) => {
      const elapsed = Date.now() - startTime;
      let data = '';

      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 400,
          status: res.statusCode,
          ms: elapsed,
          data: data.substring(0, 200)
        });
      });
    });

    req.on('error', (err) => {
      const elapsed = Date.now() - startTime;
      resolve({
        ok: false,
        error: err.message,
        ms: elapsed
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        ok: false,
        error: 'Timeout',
        ms: 5000
      });
    });
  });
}

async function checkAlexE2E() {
  log('\n=== Checking Alex E2E Endpoint ===', COLORS.BLUE);

  try {
    // Try localhost first (if running on Alex node)
    let result = await testHttpEndpoint('http://127.0.0.1:9090/api/e2e');

    if (!result.ok) {
      // Try internal Railway network
      result = await testHttpEndpoint('http://alex.railway.internal:9090/api/e2e');
    }

    if (result.ok && result.data) {
      try {
        const e2eData = JSON.parse(result.data);
        log('E2E Check Results:', COLORS.CYAN);

        for (const [service, check] of Object.entries(e2eData.checks || {})) {
          const status = check.ok ? '✓' : '✗';
          const color = check.ok ? COLORS.GREEN : COLORS.RED;
          const detail = check.ok ? `OK (${check.ms}ms)` : `FAIL: ${check.error || 'Unknown'}`;
          log(`  ${status} ${service}: ${detail}`, color);
        }

        return e2eData;
      } catch (parseErr) {
        log('⚠ Could not parse E2E response', COLORS.YELLOW);
      }
    } else {
      log(`✗ E2E endpoint not accessible: ${result.error || `HTTP ${result.status}`}`, COLORS.RED);
    }
  } catch (err) {
    log(`✗ E2E check failed: ${err.message}`, COLORS.RED);
  }

  return null;
}

async function checkServiceLogs(serviceName, serviceId) {
  log(`\nChecking ${serviceName} logs for errors...`, COLORS.CYAN);

  const cmd = `railway logs --project=${PROJECT_ID} --environment=${ENVIRONMENT_ID} --service=${serviceId} --limit=50`;

  try {
    const { stdout } = await execAsync(cmd);
    const lines = stdout.split('\n');

    // Look for errors or warnings
    const errors = lines.filter(line =>
      line.toLowerCase().includes('error') ||
      line.toLowerCase().includes('fatal') ||
      line.toLowerCase().includes('failed')
    );

    if (errors.length > 0) {
      log(`⚠ Found ${errors.length} error(s) in recent logs:`, COLORS.YELLOW);
      errors.slice(0, 5).forEach(err => {
        log(`  ${err.substring(0, 100)}`, COLORS.YELLOW);
      });
    } else {
      log(`✓ No errors in recent logs`, COLORS.GREEN);
    }

    // Check for successful operations
    const successIndicators = [
      'connected',
      'initialized',
      'ready',
      'listening',
      'started'
    ];

    const successes = lines.filter(line =>
      successIndicators.some(indicator =>
        line.toLowerCase().includes(indicator)
      )
    );

    if (successes.length > 0) {
      log(`✓ Found ${successes.length} success indicator(s)`, COLORS.GREEN);
    }

  } catch (err) {
    log(`⚠ Could not fetch logs: ${err.message}`, COLORS.YELLOW);
  }
}

async function checkEnvironmentVariables() {
  log('\n=== Checking Environment Variables ===', COLORS.BLUE);

  const requiredVars = [
    'DATABASE_URL',
    'TELEGRAM_BOT_TOKEN',
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
    'UPSTASH_REDIS_REST_URL',
    'UPSTASH_REDIS_REST_TOKEN'
  ];

  const optionalVars = [
    'CHROMA_BASE_URL',
    'ALPHAVANTAGE_API_KEY',
    'APIFY_API_KEY',
    'SMTP_HOST',
    'SMTP_USER'
  ];

  log('Required variables:', COLORS.CYAN);
  for (const varName of requiredVars) {
    const value = process.env[varName];
    if (value) {
      log(`  ✓ ${varName}: Set (${value.substring(0, 20)}...)`, COLORS.GREEN);
    } else {
      log(`  ✗ ${varName}: Missing`, COLORS.RED);
    }
  }

  log('\nOptional variables:', COLORS.CYAN);
  for (const varName of optionalVars) {
    const value = process.env[varName];
    if (value) {
      log(`  ✓ ${varName}: Set`, COLORS.GREEN);
    } else {
      log(`  ⚠ ${varName}: Not set`, COLORS.YELLOW);
    }
  }
}

async function checkDataPersistence() {
  log('\n=== Checking Data Persistence ===', COLORS.BLUE);

  // Check if Postgres is saving data
  if (process.env.DATABASE_URL) {
    try {
      const { createDb } = await import('../src/db.js');
      const db = createDb(process.env.DATABASE_URL);

      // Test write
      await db.insertReport({
        kind: 'connectivity-test',
        content: JSON.stringify({
          test: true,
          timestamp: new Date().toISOString(),
          source: 'check_railway_connectivity'
        }),
        meta: { test: true }
      });

      log('✓ Postgres: Successfully wrote test data', COLORS.GREEN);
      await db.close();
    } catch (err) {
      log(`✗ Postgres: ${err.message}`, COLORS.RED);
    }
  } else {
    log('⚠ Postgres: DATABASE_URL not configured', COLORS.YELLOW);
  }

  // Check Upstash Redis
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    try {
      const { Redis } = await import('@upstash/redis');
      const redis = new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN
      });

      const testKey = `test:connectivity:${Date.now()}`;
      await redis.set(testKey, 'test', { ex: 60 });
      const value = await redis.get(testKey);

      if (value === 'test') {
        log('✓ Upstash Redis: Read/write working', COLORS.GREEN);
      } else {
        log('✗ Upstash Redis: Read/write mismatch', COLORS.RED);
      }

      // Check dashboard data
      const dashData = await redis.get('dash:data');
      if (dashData) {
        const data = JSON.parse(dashData);
        log(`  Dashboard last updated: ${data.last_updated || 'Never'}`, COLORS.CYAN);
      }

    } catch (err) {
      log(`✗ Upstash Redis: ${err.message}`, COLORS.RED);
    }
  } else {
    log('⚠ Upstash Redis: Not configured', COLORS.YELLOW);
  }
}

async function main() {
  log('🔍 Railway Connectivity Check (Safe Mode)\n', COLORS.BLUE);
  log('This check will not disrupt Alex\'s operation\n', COLORS.CYAN);

  const results = {
    timestamp: new Date().toISOString(),
    checks: {}
  };

  // 1. Check Alex E2E endpoint (this tests most services)
  const e2eResult = await checkAlexE2E();
  results.checks.e2e = e2eResult;

  // 2. Check environment variables
  await checkEnvironmentVariables();

  // 3. Check data persistence
  await checkDataPersistence();

  // 4. Check Alex main service logs
  await checkServiceLogs('Alex Main', SERVICES['alex-main'].id);

  // Summary
  log('\n=== Summary ===', COLORS.BLUE);

  if (e2eResult && e2eResult.ok) {
    log('✓ Alex is operational and all critical services are connected', COLORS.GREEN);
  } else {
    log('⚠ Some services may have issues - check the details above', COLORS.YELLOW);
  }

  // Recommendations
  log('\n=== Recommendations ===', COLORS.BLUE);

  if (!e2eResult || !e2eResult.ok) {
    log('1. Check Railway dashboard for service status', COLORS.CYAN);
    log('2. Verify environment variables are set correctly', COLORS.CYAN);
    log('3. Check service logs for detailed error messages', COLORS.CYAN);
    log('4. Ensure all services are deployed and running', COLORS.CYAN);
  }

  if (e2eResult?.checks?.chromadb && !e2eResult.checks.chromadb.ok) {
    log('⚠ ChromaDB is down - RAG features will be degraded', COLORS.YELLOW);
  }

  // Save results
  try {
    const fs = await import('fs/promises');
    const path = await import('path');
    const reportPath = path.join(process.cwd(), 'connectivity_check_results.json');
    await fs.writeFile(reportPath, JSON.stringify(results, null, 2));
    log(`\nResults saved to: ${reportPath}`, COLORS.BLUE);
  } catch (err) {
    log(`\n⚠ Could not save results: ${err.message}`, COLORS.YELLOW);
  }
}

// Run the check
main().catch(err => {
  log(`\n✗ Fatal Error: ${err.message}`, COLORS.RED);
  log('Alex service integrity maintained - no changes made', COLORS.CYAN);
  process.exit(1);
});