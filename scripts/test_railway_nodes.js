#!/usr/bin/env node

/**
 * Test script to verify all Railway nodes and data flow
 * Checks connectivity, data persistence, and inter-service communication
 */

import { createDb } from '../src/db.js';
import { Redis } from '@upstash/redis';
import http from 'http';
import https from 'https';

const COLORS = {
  GREEN: '\x1b[32m',
  RED: '\x1b[31m',
  YELLOW: '\x1b[33m',
  BLUE: '\x1b[34m',
  RESET: '\x1b[0m'
};

function log(message, color = COLORS.RESET) {
  console.log(`${color}${message}${COLORS.RESET}`);
}

async function testHttpEndpoint(url, name) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const mod = url.startsWith('https') ? https : http;

    mod.get(url, { timeout: 5000 }, (res) => {
      const elapsed = Date.now() - startTime;

      if (res.statusCode >= 200 && res.statusCode < 400) {
        log(`✓ ${name}: OK (${res.statusCode}, ${elapsed}ms)`, COLORS.GREEN);
        resolve({ ok: true, status: res.statusCode, ms: elapsed });
      } else {
        log(`✗ ${name}: FAIL (status ${res.statusCode}, ${elapsed}ms)`, COLORS.RED);
        resolve({ ok: false, status: res.statusCode, ms: elapsed });
      }
    }).on('error', (err) => {
      const elapsed = Date.now() - startTime;
      log(`✗ ${name}: ERROR - ${err.message} (${elapsed}ms)`, COLORS.RED);
      resolve({ ok: false, error: err.message, ms: elapsed });
    });
  });
}

async function testPostgres() {
  const databaseUrl = process.env.DATABASE_URL || process.env.database_url;

  if (!databaseUrl) {
    log('⚠ PostgreSQL: No DATABASE_URL configured', COLORS.YELLOW);
    return { ok: false, error: 'No DATABASE_URL' };
  }

  const db = createDb(databaseUrl);

  try {
    const startTime = Date.now();

    // Initialize tables
    await db.init();

    // Test write
    await db.insertReport({
      kind: 'test',
      content: JSON.stringify({
        test: 'railway_node_test',
        timestamp: new Date().toISOString()
      }),
      meta: { test: true }
    });

    const elapsed = Date.now() - startTime;
    log(`✓ PostgreSQL: Connected and writing (${elapsed}ms)`, COLORS.GREEN);

    await db.close();
    return { ok: true, ms: elapsed };
  } catch (err) {
    log(`✗ PostgreSQL: ${err.message}`, COLORS.RED);
    return { ok: false, error: err.message };
  }
}

async function testRedis() {
  const redisUrl = process.env.REDIS_URL || process.env.redis_url;
  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  const results = {};

  // Test Upstash Redis
  if (upstashUrl && upstashToken) {
    try {
      const startTime = Date.now();
      const redis = new Redis({
        url: upstashUrl,
        token: upstashToken
      });

      const testKey = `test:railway:${Date.now()}`;
      await redis.set(testKey, 'test_value', { ex: 60 });
      const value = await redis.get(testKey);

      const elapsed = Date.now() - startTime;

      if (value === 'test_value') {
        log(`✓ Upstash Redis: Connected and working (${elapsed}ms)`, COLORS.GREEN);
        results.upstash = { ok: true, ms: elapsed };
      } else {
        log(`✗ Upstash Redis: Read/write mismatch`, COLORS.RED);
        results.upstash = { ok: false, error: 'Read/write mismatch' };
      }

      await redis.del(testKey);
    } catch (err) {
      log(`✗ Upstash Redis: ${err.message}`, COLORS.RED);
      results.upstash = { ok: false, error: err.message };
    }
  } else {
    log('⚠ Upstash Redis: Not configured', COLORS.YELLOW);
    results.upstash = { ok: false, error: 'Not configured' };
  }

  // Test local Redis
  if (redisUrl) {
    try {
      const { default: RedisClient } = await import('redis');
      const startTime = Date.now();

      const client = RedisClient.createClient({ url: redisUrl });
      await client.connect();

      const testKey = `test:railway:${Date.now()}`;
      await client.set(testKey, 'test_value', { EX: 60 });
      const value = await client.get(testKey);

      const elapsed = Date.now() - startTime;

      if (value === 'test_value') {
        log(`✓ Local Redis: Connected and working (${elapsed}ms)`, COLORS.GREEN);
        results.local = { ok: true, ms: elapsed };
      } else {
        log(`✗ Local Redis: Read/write mismatch`, COLORS.RED);
        results.local = { ok: false, error: 'Read/write mismatch' };
      }

      await client.del(testKey);
      await client.quit();
    } catch (err) {
      log(`✗ Local Redis: ${err.message}`, COLORS.RED);
      results.local = { ok: false, error: err.message };
    }
  } else {
    log('⚠ Local Redis: Not configured', COLORS.YELLOW);
    results.local = { ok: false, error: 'Not configured' };
  }

  return results;
}

async function testDataFlow() {
  log('\n=== Testing Data Flow ===', COLORS.BLUE);

  const alexPort = process.env.ALEX_PORT || '9090';
  const tests = [];

  // Test E2E endpoint (which checks all internal services)
  const e2eResult = await testHttpEndpoint(
    `http://127.0.0.1:${alexPort}/api/e2e`,
    'E2E Check (all services)'
  );

  if (e2eResult.ok) {
    // Parse E2E results to check individual services
    try {
      const response = await fetch(`http://127.0.0.1:${alexPort}/api/e2e`);
      const data = await response.json();

      log('\nE2E Service Details:', COLORS.BLUE);
      for (const [service, result] of Object.entries(data.checks || {})) {
        const status = result.ok ? '✓' : '✗';
        const color = result.ok ? COLORS.GREEN : COLORS.RED;
        log(`  ${status} ${service}: ${result.ok ? 'OK' : result.error} (${result.ms}ms)`, color);
      }
    } catch (err) {
      log(`⚠ Could not parse E2E details: ${err.message}`, COLORS.YELLOW);
    }
  }

  return e2eResult;
}

async function main() {
  log('🚀 Railway Node & Data Flow Test\n', COLORS.BLUE);

  const results = {
    timestamp: new Date().toISOString(),
    tests: {}
  };

  // Test Alex main service
  log('=== Testing Alex Service ===', COLORS.BLUE);
  const alexPort = process.env.ALEX_PORT || '9090';
  results.tests.alex_health = await testHttpEndpoint(
    `http://127.0.0.1:${alexPort}/api/health`,
    'Alex Health'
  );

  // Test database
  log('\n=== Testing Database ===', COLORS.BLUE);
  results.tests.postgres = await testPostgres();

  // Test Redis
  log('\n=== Testing Redis ===', COLORS.BLUE);
  results.tests.redis = await testRedis();

  // Test ChromaDB
  log('\n=== Testing ChromaDB ===', COLORS.BLUE);
  const chromaBase = process.env.CHROMA_BASE_URL || 'http://chroma.railway.internal:8000';
  results.tests.chromadb = await testHttpEndpoint(
    `${chromaBase}/api/v2/heartbeat`,
    'ChromaDB'
  );

  // Test Node.js service
  log('\n=== Testing Node.js Service ===', COLORS.BLUE);
  const nodejsBase = process.env.NODEJS_BASE_URL || 'http://nodejs.railway.internal:3000';
  results.tests.nodejs = await testHttpEndpoint(nodejsBase, 'Node.js Service');

  // Test HTTP-Node.js service
  const httpNodejsBase = process.env.HTTP_NODEJS_BASE_URL || 'http://http-nodejs.railway.internal:8080';
  results.tests.http_nodejs = await testHttpEndpoint(httpNodejsBase, 'HTTP-Node.js Service');

  // Test data flow
  results.tests.data_flow = await testDataFlow();

  // Summary
  log('\n=== Test Summary ===', COLORS.BLUE);
  const passed = Object.values(results.tests).filter(t => t && t.ok).length;
  const total = Object.keys(results.tests).length;
  const allPassed = passed === total;

  log(`Tests Passed: ${passed}/${total}`, allPassed ? COLORS.GREEN : COLORS.YELLOW);

  if (!allPassed) {
    log('\nFailed Tests:', COLORS.RED);
    for (const [name, result] of Object.entries(results.tests)) {
      if (!result || !result.ok) {
        log(`  - ${name}: ${result?.error || 'Failed'}`, COLORS.RED);
      }
    }
  }

  // Save results
  try {
    const fs = await import('fs/promises');
    const path = await import('path');
    const reportPath = path.join(process.cwd(), 'railway_test_results.json');
    await fs.writeFile(reportPath, JSON.stringify(results, null, 2));
    log(`\nTest results saved to: ${reportPath}`, COLORS.BLUE);
  } catch (err) {
    log(`\n⚠ Could not save results: ${err.message}`, COLORS.YELLOW);
  }

  process.exit(allPassed ? 0 : 1);
}

// Run tests
main().catch(err => {
  log(`\nFatal Error: ${err.message}`, COLORS.RED);
  process.exit(1);
});