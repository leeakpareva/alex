#!/usr/bin/env node

/**
 * Verify Dashboard Real-time Updates via Upstash/Vercel
 * Tests the data flow from Alex -> Upstash Redis -> Vercel Dashboard
 */

import { Redis } from '@upstash/redis';
import http from 'http';
import https from 'https';

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

async function testUpstashConnection() {
  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!upstashUrl || !upstashToken) {
    log('✗ Upstash Redis: Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN', COLORS.RED);
    return { ok: false, error: 'Missing credentials' };
  }

  try {
    const redis = new Redis({ url: upstashUrl, token: upstashToken });

    // Test connection
    const pingResult = await redis.ping();
    if (pingResult !== 'PONG') {
      throw new Error(`Unexpected ping response: ${pingResult}`);
    }

    log('✓ Upstash Redis: Connected successfully', COLORS.GREEN);
    return { ok: true, redis };
  } catch (err) {
    log(`✗ Upstash Redis: Connection failed - ${err.message}`, COLORS.RED);
    return { ok: false, error: err.message };
  }
}

async function testDashboardData(redis) {
  try {
    // Read current dashboard data
    const dashData = await redis.get('dash:data');

    if (!dashData) {
      log('⚠ Dashboard Data: No data found in Redis (dash:data key)', COLORS.YELLOW);
      return { ok: false, error: 'No dashboard data' };
    }

    const data = typeof dashData === 'string' ? JSON.parse(dashData) : dashData;

    log('✓ Dashboard Data: Found in Redis', COLORS.GREEN);
    log(`  Last Updated: ${data.last_updated || 'Never'}`, COLORS.CYAN);
    log(`  Status: ${data.status || 'Unknown'}`, COLORS.CYAN);
    log(`  Tasks Today: ${data.tasks?.length || 0}`, COLORS.CYAN);
    log(`  News Items: ${data.news?.length || 0}`, COLORS.CYAN);
    log(`  Activity Entries: ${data.activity?.length || 0}`, COLORS.CYAN);

    // Check data freshness
    if (data.last_updated) {
      const ageMs = Date.now() - new Date(data.last_updated).getTime();
      const ageMins = Math.floor(ageMs / 60000);

      if (ageMins > 60) {
        log(`⚠ Data is ${ageMins} minutes old (may be stale)`, COLORS.YELLOW);
      } else {
        log(`✓ Data is fresh (${ageMins} minutes old)`, COLORS.GREEN);
      }
    }

    return { ok: true, data };
  } catch (err) {
    log(`✗ Dashboard Data: Error reading - ${err.message}`, COLORS.RED);
    return { ok: false, error: err.message };
  }
}

async function testTokenData(redis) {
  try {
    const tokenData = await redis.get('dash:tokens');

    if (!tokenData) {
      log('⚠ Token Data: No data found (dash:tokens key)', COLORS.YELLOW);
      return { ok: false, error: 'No token data' };
    }

    const data = typeof tokenData === 'string' ? JSON.parse(tokenData) : tokenData;

    log('✓ Token Data: Found in Redis', COLORS.GREEN);
    log(`  Total Calls: ${data.total_calls || 0}`, COLORS.CYAN);
    log(`  Total Tokens: ${data.total_tokens || 0}`, COLORS.CYAN);
    log(`  Total Cost (GBP): £${data.total_cost_gbp?.toFixed(2) || '0.00'}`, COLORS.CYAN);

    if (data.by_model && data.by_model.length > 0) {
      log('  Models Used:', COLORS.CYAN);
      for (const model of data.by_model) {
        log(`    - ${model.model}: ${model.calls} calls, £${model.cost_gbp?.toFixed(2)}`, COLORS.CYAN);
      }
    }

    return { ok: true, data };
  } catch (err) {
    log(`✗ Token Data: Error reading - ${err.message}`, COLORS.RED);
    return { ok: false, error: err.message };
  }
}

async function testWriteUpdate(redis) {
  try {
    const testUpdate = {
      test: true,
      timestamp: new Date().toISOString(),
      message: 'Dashboard update verification test'
    };

    const testKey = `dash:test:${Date.now()}`;
    await redis.set(testKey, JSON.stringify(testUpdate), { ex: 300 }); // Expire in 5 minutes

    // Read it back
    const readBack = await redis.get(testKey);
    if (!readBack) {
      throw new Error('Could not read back test data');
    }

    const parsed = JSON.parse(readBack);
    if (parsed.timestamp !== testUpdate.timestamp) {
      throw new Error('Data mismatch on read-back');
    }

    log('✓ Write Test: Successfully wrote and read test data', COLORS.GREEN);

    // Clean up
    await redis.del(testKey);

    return { ok: true };
  } catch (err) {
    log(`✗ Write Test: Failed - ${err.message}`, COLORS.RED);
    return { ok: false, error: err.message };
  }
}

async function testVercelEndpoint() {
  const vercelUrl = process.env.VERCEL_DASHBOARD_URL || 'https://alexnavada.xyz';

  try {
    const response = await fetch(`${vercelUrl}/api/dashboard/status`, {
      method: 'GET',
      headers: {
        'User-Agent': 'Alex-Dashboard-Verifier/1.0'
      }
    });

    if (response.ok) {
      const data = await response.json();
      log(`✓ Vercel Dashboard: Reachable (status: ${data.status || 'ok'})`, COLORS.GREEN);
      return { ok: true, data };
    } else {
      log(`⚠ Vercel Dashboard: HTTP ${response.status} ${response.statusText}`, COLORS.YELLOW);
      return { ok: false, status: response.status };
    }
  } catch (err) {
    log(`✗ Vercel Dashboard: Cannot reach - ${err.message}`, COLORS.RED);
    return { ok: false, error: err.message };
  }
}

async function simulateDashboardUpdate(redis) {
  log('\n=== Simulating Dashboard Update ===', COLORS.BLUE);

  try {
    // Get current dashboard data
    const currentData = await redis.get('dash:data');
    let dashState = currentData ? JSON.parse(currentData) : {
      status: 'online',
      tasks: [],
      news: [],
      activity: [],
      services: [],
      metrics: {},
      ralph: {}
    };

    // Add a test activity
    const testActivity = {
      timestamp: new Date().toISOString(),
      message: `Dashboard verification test at ${new Date().toLocaleTimeString()}`,
      type: 'test'
    };

    if (!dashState.activity) dashState.activity = [];
    dashState.activity.unshift(testActivity);

    // Keep only last 20 activities
    dashState.activity = dashState.activity.slice(0, 20);

    // Update timestamp
    dashState.last_updated = new Date().toISOString();

    // Write back
    await redis.set('dash:data', JSON.stringify(dashState));

    log('✓ Simulated Update: Added test activity and updated timestamp', COLORS.GREEN);
    log('  You should see this update in the Vercel dashboard within 5-10 seconds', COLORS.CYAN);

    return { ok: true, activity: testActivity };
  } catch (err) {
    log(`✗ Simulated Update: Failed - ${err.message}`, COLORS.RED);
    return { ok: false, error: err.message };
  }
}

async function main() {
  log('🚀 Dashboard Real-time Update Verification\n', COLORS.BLUE);

  const results = {
    timestamp: new Date().toISOString(),
    tests: {}
  };

  // Test 1: Upstash connection
  log('=== Testing Upstash Redis Connection ===', COLORS.BLUE);
  const upstashResult = await testUpstashConnection();
  results.tests.upstash_connection = { ok: upstashResult.ok, error: upstashResult.error };

  if (!upstashResult.ok) {
    log('\n❌ Cannot proceed without Upstash connection', COLORS.RED);
    log('\nMake sure you have set:', COLORS.YELLOW);
    log('  - UPSTASH_REDIS_REST_URL', COLORS.YELLOW);
    log('  - UPSTASH_REDIS_REST_TOKEN', COLORS.YELLOW);
    process.exit(1);
  }

  const redis = upstashResult.redis;

  // Test 2: Dashboard data
  log('\n=== Testing Dashboard Data ===', COLORS.BLUE);
  results.tests.dashboard_data = await testDashboardData(redis);

  // Test 3: Token data
  log('\n=== Testing Token Data ===', COLORS.BLUE);
  results.tests.token_data = await testTokenData(redis);

  // Test 4: Write test
  log('\n=== Testing Write Capability ===', COLORS.BLUE);
  results.tests.write_test = await testWriteUpdate(redis);

  // Test 5: Vercel endpoint
  log('\n=== Testing Vercel Dashboard Endpoint ===', COLORS.BLUE);
  results.tests.vercel_endpoint = await testVercelEndpoint();

  // Test 6: Simulate update
  const simulateResult = await simulateDashboardUpdate(redis);
  results.tests.simulate_update = simulateResult;

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

  // Configuration guide
  if (!results.tests.vercel_endpoint?.ok) {
    log('\n📝 Vercel Dashboard Setup:', COLORS.BLUE);
    log('1. Deploy dashboard to Vercel', COLORS.CYAN);
    log('2. Set environment variables in Vercel:', COLORS.CYAN);
    log('   - UPSTASH_REDIS_REST_URL (same as Alex)', COLORS.CYAN);
    log('   - UPSTASH_REDIS_REST_TOKEN (same as Alex)', COLORS.CYAN);
    log('   - ALEX_API_BASE_URL=https://<alex-railway-domain>', COLORS.CYAN);
    log('   - ALEX_DASHBOARD_READ_TOKEN (if configured)', COLORS.CYAN);
    log('3. Alex should have matching Upstash credentials', COLORS.CYAN);
  }

  // Save results
  try {
    const fs = await import('fs/promises');
    const path = await import('path');
    const reportPath = path.join(process.cwd(), 'dashboard_verification_results.json');
    await fs.writeFile(reportPath, JSON.stringify(results, null, 2));
    log(`\nResults saved to: ${reportPath}`, COLORS.BLUE);
  } catch (err) {
    log(`\n⚠ Could not save results: ${err.message}`, COLORS.YELLOW);
  }

  process.exit(allPassed ? 0 : 1);
}

// Run verification
main().catch(err => {
  log(`\nFatal Error: ${err.message}`, COLORS.RED);
  process.exit(1);
});