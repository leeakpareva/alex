#!/bin/bash

# Comprehensive Pipeline Status Check for Alex Railway
# Verifies all services and data flow

set -e

echo "🔍 Alex Railway Pipeline Status Check"
echo "====================================="
echo ""

PROJECT_ID="a4af4615-ff5c-4f88-917e-3a4099269eef"
ENVIRONMENT_ID="663f2d4a-6d62-4f24-a698-bea71d581fca"

# Service definitions
ALEX_MAIN="71e94c37-64c6-44f2-a5c8-7ae2a1b641f4"
POSTGRES="18f45778-a301-48ae-bc1d-4b8a24c7a246"
CHROMADB="be536d17-091f-49c3-a141-22efcd867dee"
NODEJS="61c90c33-c623-4f05-8e14-1aab785f18fa"
HTTP_NODEJS="7758afc6-b6a3-4fcc-99f6-77eb83b70277"
UPSTASH="e37177e0-e16b-4fbf-b95c-4b8ca8b37ae4"
ANYTHINGLLM="7d0ca97a-5862-4fc7-834a-0cf7c656b3bd"

echo "📊 Service Status Checks"
echo "------------------------"

# 1. Check Alex Main Service
echo ""
echo "1️⃣ Alex Main Service ($ALEX_MAIN)"
railway run --project=$PROJECT_ID --environment=$ENVIRONMENT_ID --service=$ALEX_MAIN -- bash -c '
echo "  ✓ Checking health endpoint..."
curl -s http://localhost:9090/api/health | python3 -c "
import json, sys
data = json.load(sys.stdin)
print(f\"    Status: {data.get(\"status\", \"unknown\")}\")
print(f\"    Uptime: {data.get(\"uptime_seconds\", 0)} seconds\")
print(f\"    Memory: {data.get(\"memory\", {}).get(\"heap_used_mb\", 0)} MB\")
print(f\"    Telegram: {data.get(\"telegram\", \"unknown\")}\")
print(f\"    Redis: {data.get(\"redis_upstash\", \"unknown\")}\")
" 2>/dev/null || echo "    ❌ Health check failed"

echo ""
echo "  ✓ Checking E2E endpoint..."
curl -s http://localhost:9090/api/e2e | python3 -c "
import json, sys
data = json.load(sys.stdin)
print(f\"    Overall: {'✅ PASS' if data.get('ok') else '❌ FAIL'}\")
for service, check in (data.get('checks', {})).items():
    status = '✅' if check.get('ok') else '❌'
    print(f\"    {status} {service}: {check.get('ms', 0)}ms\")
" 2>/dev/null || echo "    ❌ E2E check failed"
' 2>/dev/null || echo "  ❌ Cannot connect to Alex Main"

# 2. Check PostgreSQL Data Flow
echo ""
echo "2️⃣ PostgreSQL Database ($POSTGRES)"
railway run --project=$PROJECT_ID --environment=$ENVIRONMENT_ID --service=$POSTGRES -- bash -c '
echo "  ✓ Checking database tables..."
psql -U postgres -d railway -t -c "
SELECT
    '\''    Tables: '\'' || COUNT(DISTINCT tablename) || '\'' found'\''
FROM pg_tables
WHERE schemaname = '\''public'\'';
" 2>/dev/null || echo "    ❌ Cannot query tables"

echo "  ✓ Checking recent data..."
psql -U postgres -d railway -t -c "
SELECT
    '\''    Connectivity events: '\'' || COUNT(*) || '\'' (Latest: '\'' || MAX(ts)::text || '\'')'\'
FROM connectivity_events
WHERE ts > NOW() - INTERVAL '\''24 hours'\'';
" 2>/dev/null || echo "    ❌ No connectivity events"

psql -U postgres -d railway -t -c "
SELECT
    '\''    Ralph reviews: '\'' || COUNT(*) || '\'' (Latest: '\'' || MAX(ts)::text || '\'')'\'
FROM ralph_reviews;
" 2>/dev/null || echo "    ❌ No Ralph reviews"

psql -U postgres -d railway -t -c "
SELECT
    '\''    Agent reports: '\'' || COUNT(*) || '\'' (Latest: '\'' || MAX(ts)::text || '\'')'\'
FROM agent_reports
WHERE ts > NOW() - INTERVAL '\''24 hours'\'';
" 2>/dev/null || echo "    ❌ No agent reports"
' 2>/dev/null || echo "  ❌ Cannot connect to PostgreSQL"

# 3. Check Upstash Redis Data Flow
echo ""
echo "3️⃣ Upstash Redis (Managed Service)"
railway run --project=$PROJECT_ID --environment=$ENVIRONMENT_ID --service=$ALEX_MAIN -- bash -c '
echo "  ✓ Testing Redis connection from Alex..."
node -e "
const { Redis } = require('\''@upstash/redis'\'');
(async () => {
  try {
    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN
    });

    // Test connection
    const pong = await redis.ping();
    console.log('\''    Connection: '\'' + (pong === '\''PONG'\'' ? '\''✅ Connected'\'' : '\''❌ Failed'\''));

    // Check dashboard data
    const dashData = await redis.get('\''dash:data'\'');
    if (dashData) {
      const data = typeof dashData === '\''string'\'' ? JSON.parse(dashData) : dashData;
      console.log('\''    Dashboard data: ✅ Found'\'');
      console.log('\''      Last updated: '\'' + (data.last_updated || '\''Never'\''));
      console.log('\''      Tasks today: '\'' + (data.tasks?.length || 0));
      console.log('\''      News items: '\'' + (data.news?.length || 0));
    } else {
      console.log('\''    Dashboard data: ⚠️ Empty'\'');
    }

    // Check token data
    const tokenData = await redis.get('\''dash:tokens'\'');
    if (tokenData) {
      const tokens = typeof tokenData === '\''string'\'' ? JSON.parse(tokenData) : tokenData;
      console.log('\''    Token data: ✅ Found'\'');
      console.log('\''      Total calls: '\'' + (tokens.total_calls || 0));
    } else {
      console.log('\''    Token data: ⚠️ Empty'\'');
    }

    // Test write
    const testKey = '\''test:pipeline:'\'' + Date.now();
    await redis.set(testKey, '\''test'\'', { ex: 60 });
    const testVal = await redis.get(testKey);
    console.log('\''    Write test: '\'' + (testVal === '\''test'\'' ? '\''✅ Success'\'' : '\''❌ Failed'\''));
    await redis.del(testKey);

  } catch (err) {
    console.log('\''    ❌ Redis error: '\'' + err.message);
  }
})();
" 2>/dev/null || echo "    ❌ Cannot test Redis"
' 2>/dev/null || echo "  ❌ Cannot check Redis from Alex"

# 4. Check ChromaDB RAG Pipeline
echo ""
echo "4️⃣ ChromaDB Vector Database ($CHROMADB)"
railway run --project=$PROJECT_ID --environment=$ENVIRONMENT_ID --service=$CHROMADB -- bash -c '
echo "  ✓ Checking ChromaDB health..."
curl -s http://localhost:8000/api/v2/heartbeat | python3 -c "
import json, sys
data = json.load(sys.stdin)
print(f\"    Heartbeat: ✅ {data.get('nanosecond heartbeat', 'OK')}\")
" 2>/dev/null || echo "    ❌ Heartbeat failed"

echo "  ✓ Checking collections..."
curl -s http://localhost:8000/api/v1/collections | python3 -c "
import json, sys
data = json.load(sys.stdin)
collections = data if isinstance(data, list) else []
print(f\"    Collections: {len(collections)} found\")
for col in collections[:3]:
    name = col.get('name', 'unknown')
    count = col.get('metadata', {}).get('document_count', 0)
    print(f\"      - {name}: {count} documents\")
" 2>/dev/null || echo "    ❌ Cannot list collections"
' 2>/dev/null || echo "  ❌ Cannot connect to ChromaDB"

# 5. Check AnythingLLM Document Pipeline
echo ""
echo "5️⃣ AnythingLLM Document Service ($ANYTHINGLLM)"
railway run --project=$PROJECT_ID --environment=$ENVIRONMENT_ID --service=$ANYTHINGLLM -- bash -c '
echo "  ✓ Checking AnythingLLM status..."
curl -s http://localhost:3001 | head -c 100 | grep -q "AnythingLLM" && echo "    ✅ Service responding" || echo "    ❌ Service not responding"

ps aux | grep -v grep | grep node > /dev/null && echo "    ✅ Node process running" || echo "    ❌ Node process not found"

# Check if data directories exist
ls -la /app/server/storage 2>/dev/null | head -5 && echo "    ✅ Storage directory exists" || echo "    ⚠️ Storage not found"
' 2>/dev/null || echo "  ❌ Cannot connect to AnythingLLM"

# 6. Check Node.js Services
echo ""
echo "6️⃣ Node.js Support Services"
echo "  Testing nodejs service ($NODEJS)..."
railway run --project=$PROJECT_ID --environment=$ENVIRONMENT_ID --service=$ALEX_MAIN -- bash -c '
curl -s http://nodejs.railway.internal:3000 > /dev/null 2>&1 && echo "    ✅ nodejs: Online" || echo "    ❌ nodejs: Offline"
' 2>/dev/null || echo "    ⚠️ Cannot test from Alex"

echo "  Testing http-nodejs service ($HTTP_NODEJS)..."
railway run --project=$PROJECT_ID --environment=$ENVIRONMENT_ID --service=$ALEX_MAIN -- bash -c '
curl -s http://http-nodejs.railway.internal:8080 > /dev/null 2>&1 && echo "    ✅ http-nodejs: Online" || echo "    ❌ http-nodejs: Offline"
' 2>/dev/null || echo "    ⚠️ Cannot test from Alex"

echo ""
echo "📈 Data Pipeline Summary"
echo "------------------------"
echo ""
echo "Pipeline Status:"
echo "  Alex → PostgreSQL: Data persistence pipeline"
echo "  Alex → Upstash Redis → Vercel Dashboard: Real-time metrics"
echo "  Alex → ChromaDB/AnythingLLM: Document RAG pipeline"
echo "  Alex → Node.js services: Support functions"
echo ""
echo "✅ = Working | ❌ = Failed | ⚠️ = Warning"
echo ""
echo "Run 'railway logs --service=<id>' to see detailed logs for any service"