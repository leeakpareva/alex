#!/bin/bash

# Comprehensive Railway Node Verification Script
# Tests all services and their connectivity to Alex

set -e

COLORS_GREEN='\033[0;32m'
COLORS_RED='\033[0;31m'
COLORS_YELLOW='\033[1;33m'
COLORS_BLUE='\033[0;34m'
COLORS_CYAN='\033[0;36m'
COLORS_RESET='\033[0m'

PROJECT_ID="a4af4615-ff5c-4f88-917e-3a4099269eef"
ENVIRONMENT_ID="663f2d4a-6d62-4f24-a698-bea71d581fca"

# Service IDs and their names
declare -A SERVICES=(
    ["71e94c37-64c6-44f2-a5c8-7ae2a1b641f4"]="alex-main"
    ["18f45778-a301-48ae-bc1d-4b8a24c7a246"]="postgres"
    ["be536d17-091f-49c3-a141-22efcd867dee"]="chromadb"
    ["61c90c33-c623-4f05-8e14-1aab785f18fa"]="nodejs"
    ["7758afc6-b6a3-4fcc-99f6-77eb83b70277"]="http-nodejs"
    ["e37177e0-e16b-4fbf-b95c-4b8ca8b37ae4"]="upstash-redis"
    ["7d0ca97a-5862-4fc7-834a-0cf7c656b3bd"]="anythingllm"
)

echo -e "${COLORS_BLUE}🚀 Railway Node Verification Script${COLORS_RESET}\n"
echo -e "${COLORS_CYAN}Project: ${PROJECT_ID}${COLORS_RESET}"
echo -e "${COLORS_CYAN}Environment: ${ENVIRONMENT_ID}${COLORS_RESET}\n"

# Function to test a service
test_service() {
    local service_id=$1
    local service_name=$2

    echo -e "${COLORS_BLUE}Testing ${service_name} (${service_id:0:8}...)${COLORS_RESET}"

    # Create test command based on service type
    case "$service_name" in
        "alex-main")
            cat << 'EOF' > /tmp/test_alex.sh
#!/bin/bash
# Test Alex main service
echo "Testing Alex service..."

# Check if service is running
if pgrep -f "node.*gateway.js" > /dev/null; then
    echo "✓ Alex process is running"
else
    echo "✗ Alex process not found"
    exit 1
fi

# Test API endpoints
if curl -sf http://127.0.0.1:9090/api/health > /dev/null; then
    echo "✓ Health endpoint responding"
else
    echo "✗ Health endpoint not responding"
fi

if curl -sf http://127.0.0.1:9090/api/e2e > /dev/null; then
    echo "✓ E2E endpoint responding"
    # Get E2E details
    curl -s http://127.0.0.1:9090/api/e2e | python3 -m json.tool | head -20
else
    echo "✗ E2E endpoint not responding"
fi

# Check environment variables
echo "Environment check:"
[ -n "$DATABASE_URL" ] && echo "✓ DATABASE_URL set" || echo "✗ DATABASE_URL missing"
[ -n "$UPSTASH_REDIS_REST_URL" ] && echo "✓ UPSTASH_REDIS_REST_URL set" || echo "✗ UPSTASH_REDIS_REST_URL missing"
[ -n "$TELEGRAM_BOT_TOKEN" ] && echo "✓ TELEGRAM_BOT_TOKEN set" || echo "✗ TELEGRAM_BOT_TOKEN missing"

# Check logs for errors
echo "Recent errors (if any):"
tail -50 /app/logs/gateway.log 2>/dev/null | grep -i error | tail -5 || echo "No recent errors"
EOF
            ;;

        "postgres")
            cat << 'EOF' > /tmp/test_alex.sh
#!/bin/bash
# Test Postgres database
echo "Testing Postgres..."

# Check if postgres is running
if pg_isready; then
    echo "✓ Postgres is ready"
else
    echo "✗ Postgres not ready"
    exit 1
fi

# Test database connection and tables
psql -U postgres -d railway -c "\dt" 2>/dev/null | grep -E "connectivity_events|ralph_reviews|agent_reports" && echo "✓ Alex tables exist" || echo "✗ Alex tables missing"

# Check recent data
echo "Recent connectivity events:"
psql -U postgres -d railway -c "SELECT COUNT(*) as total, MAX(ts) as latest FROM connectivity_events;" 2>/dev/null || true

echo "Recent Ralph reviews:"
psql -U postgres -d railway -c "SELECT COUNT(*) as total, MAX(ts) as latest FROM ralph_reviews;" 2>/dev/null || true

echo "Recent reports:"
psql -U postgres -d railway -c "SELECT COUNT(*) as total, MAX(ts) as latest FROM agent_reports;" 2>/dev/null || true
EOF
            ;;

        "chromadb")
            cat << 'EOF' > /tmp/test_alex.sh
#!/bin/bash
# Test ChromaDB
echo "Testing ChromaDB..."

# Check if ChromaDB is responding
if curl -sf http://localhost:8000/api/v2/heartbeat > /dev/null; then
    echo "✓ ChromaDB heartbeat OK"
    # Get collection info
    curl -s http://localhost:8000/api/v1/collections | python3 -m json.tool 2>/dev/null | head -20 || true
else
    echo "✗ ChromaDB not responding"
fi

# Check for Alex collection
if curl -s http://localhost:8000/api/v1/collections | grep -q "alex_knowledge"; then
    echo "✓ alex_knowledge collection exists"
else
    echo "⚠ alex_knowledge collection not found"
fi
EOF
            ;;

        "nodejs")
            cat << 'EOF' > /tmp/test_alex.sh
#!/bin/bash
# Test Node.js service
echo "Testing Node.js service..."

# Check if service is running
if curl -sf http://localhost:3000 > /dev/null; then
    echo "✓ Node.js service responding on port 3000"
else
    echo "✗ Node.js service not responding"
fi

# Check process
ps aux | grep -v grep | grep node && echo "✓ Node process running" || echo "✗ Node process not found"
EOF
            ;;

        "http-nodejs")
            cat << 'EOF' > /tmp/test_alex.sh
#!/bin/bash
# Test HTTP Node.js service
echo "Testing HTTP Node.js service..."

# Check if service is running
if curl -sf http://localhost:8080 > /dev/null; then
    echo "✓ HTTP Node.js service responding on port 8080"
else
    echo "✗ HTTP Node.js service not responding"
fi

# Check process
ps aux | grep -v grep | grep node && echo "✓ Node process running" || echo "✗ Node process not found"
EOF
            ;;

        "upstash-redis")
            cat << 'EOF' > /tmp/test_alex.sh
#!/bin/bash
# Test Upstash Redis connection
echo "Testing Upstash Redis..."

# This is a managed service, check from Alex's perspective
echo "Upstash is a managed service - checking environment:"
[ -n "$UPSTASH_REDIS_REST_URL" ] && echo "✓ UPSTASH_REDIS_REST_URL configured" || echo "✗ UPSTASH_REDIS_REST_URL missing"
[ -n "$UPSTASH_REDIS_REST_TOKEN" ] && echo "✓ UPSTASH_REDIS_REST_TOKEN configured" || echo "✗ UPSTASH_REDIS_REST_TOKEN missing"

# Try to connect if possible
if [ -n "$UPSTASH_REDIS_REST_URL" ] && [ -n "$UPSTASH_REDIS_REST_TOKEN" ]; then
    curl -sf -H "Authorization: Bearer $UPSTASH_REDIS_REST_TOKEN" "$UPSTASH_REDIS_REST_URL/ping" && echo "✓ Upstash connection successful" || echo "✗ Upstash connection failed"
fi
EOF
            ;;

        "anythingllm")
            cat << 'EOF' > /tmp/test_alex.sh
#!/bin/bash
# Test AnythingLLM
echo "Testing AnythingLLM..."

# Check if service is running
if curl -sf http://localhost:3001 > /dev/null; then
    echo "✓ AnythingLLM responding on port 3001"
else
    echo "✗ AnythingLLM not responding"
fi
EOF
            ;;
    esac

    # Execute test via Railway SSH
    railway ssh \
        --project="$PROJECT_ID" \
        --environment="$ENVIRONMENT_ID" \
        --service="$service_id" \
        "bash /tmp/test_alex.sh" 2>/dev/null || {
            echo -e "${COLORS_RED}✗ Failed to connect to ${service_name}${COLORS_RESET}"
            return 1
        }

    echo ""
    return 0
}

# Test each service
FAILED_SERVICES=()
for service_id in "${!SERVICES[@]}"; do
    if ! test_service "$service_id" "${SERVICES[$service_id]}"; then
        FAILED_SERVICES+=("${SERVICES[$service_id]}")
    fi
done

echo -e "${COLORS_BLUE}=== Summary ===${COLORS_RESET}"

if [ ${#FAILED_SERVICES[@]} -eq 0 ]; then
    echo -e "${COLORS_GREEN}✓ All services are operational!${COLORS_RESET}"
else
    echo -e "${COLORS_RED}✗ Failed services: ${FAILED_SERVICES[*]}${COLORS_RESET}"
    exit 1
fi