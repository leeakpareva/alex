#!/bin/bash
# ALEX System Scan — Full project health, state, and security audit
# Usage: bash system-scan.sh              (display + save report)
#        bash system-scan.sh --quick      (skip security checks)
#        bash system-scan.sh --json       (output raw data as JSON)

set -uo pipefail

SCAN_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="/home/head/ALEX_NAVADA"
REAL_PROJECT="$(readlink -f "$PROJECT_DIR")"
DATE=$(date +%Y-%m-%d)
TIME=$(date +%H%M)
REPORT_FILE="${SCAN_DIR}/scan-${DATE}-${TIME}.txt"
MODE="${1:-full}"

# Colours (stripped from saved file)
if [ -t 1 ]; then
    RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'
    CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'
else
    RED=''; YELLOW=''; GREEN=''; CYAN=''; BOLD=''; DIM=''; NC=''
fi

# Write to both terminal and file (strip ANSI for file)
log() {
    echo -e "$1"
    echo -e "$1" | sed 's/\x1b\[[0-9;]*m//g' >> "$REPORT_FILE"
}

divider() {
    log "${DIM}$(printf '%.0s─' {1..70})${NC}"
}

section() {
    log ""
    log "${BOLD}${CYAN}[$1]${NC}"
    divider
}

ok()   { log "  ${GREEN}OK${NC}  $1"; }
warn() { log "  ${YELLOW}WARN${NC}  $1"; }
crit() { log "  ${RED}CRIT${NC}  $1"; }
info() { log "  ${DIM}INFO${NC}  $1"; }

count_crit=0
count_warn=0
count_ok=0

track_crit() { crit "$1"; ((count_crit++)); }
track_warn() { warn "$1"; ((count_warn++)); }
track_ok()   { ok "$1"; ((count_ok++)); }

# Start report
> "$REPORT_FILE"
log "${BOLD}ALEX System Scan${NC}"
log "Date: $(date '+%A %d %B %Y, %H:%M:%S')"
log "Host: $(hostname) | $(uname -m) | $(cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | cut -d= -f2 | tr -d '\"')"
log "Report: ${REPORT_FILE}"

# ─── 1. PROJECT OVERVIEW ───────────────────────────────────────────
section "1. PROJECT OVERVIEW"

if [ -L "$PROJECT_DIR" ]; then
    info "ALEX_NAVADA is a symlink → ${REAL_PROJECT}"
else
    info "Project path: ${PROJECT_DIR}"
fi

TOTAL_SIZE=$(du -sh "$REAL_PROJECT" 2>/dev/null | cut -f1)
CORE_SIZE=$(du -sh --exclude='node_modules' --exclude='.git' "$REAL_PROJECT" 2>/dev/null | cut -f1)
NM_SIZE=$(du -sh "$REAL_PROJECT/node_modules" 2>/dev/null | cut -f1 || echo "N/A")
info "Total size: ${TOTAL_SIZE} (core: ${CORE_SIZE}, node_modules: ${NM_SIZE})"

# Source file stats
JS_COUNT=$(find "$REAL_PROJECT/src" -name '*.js' -type f 2>/dev/null | wc -l)
JS_LINES=$(find "$REAL_PROJECT/src" -name '*.js' -type f -exec cat {} + 2>/dev/null | wc -l)
TEST_COUNT=$(find "$REAL_PROJECT/tests" -name '*.test.js' -type f 2>/dev/null | wc -l)
info "Source: ${JS_COUNT} JS files, ${JS_LINES} lines | Tests: ${TEST_COUNT} suites"

# Package info
if [ -f "$REAL_PROJECT/package.json" ]; then
    PKG_NAME=$(grep '"name"' "$REAL_PROJECT/package.json" | head -1 | cut -d'"' -f4)
    PKG_VER=$(grep '"version"' "$REAL_PROJECT/package.json" | head -1 | cut -d'"' -f4)
    NODE_REQ=$(grep '"node"' "$REAL_PROJECT/package.json" | head -1 | cut -d'"' -f4)
    DEP_COUNT=$(grep -c '"^' "$REAL_PROJECT/package-lock.json" 2>/dev/null || echo "?")
    info "Package: ${PKG_NAME}@${PKG_VER} | Node required: ${NODE_REQ}"
fi

info "Node: $(node --version 2>/dev/null || echo 'not found') | Python: $(python3 --version 2>&1 | awk '{print $2}')"

# ─── 2. GIT STATUS ─────────────────────────────────────────────────
section "2. GIT STATUS"

cd "$REAL_PROJECT" 2>/dev/null || true

if [ -d ".git" ]; then
    BRANCH=$(git branch --show-current 2>/dev/null)
    REMOTE_URL=$(git remote get-url origin 2>/dev/null || echo "none")
    LAST_COMMIT=$(git log -1 --format="%h %s" 2>/dev/null)
    LAST_COMMIT_DATE=$(git log -1 --format="%ci" 2>/dev/null)
    AHEAD_BEHIND=$(git rev-list --left-right --count HEAD...origin/main 2>/dev/null || echo "? ?")
    AHEAD=$(echo "$AHEAD_BEHIND" | awk '{print $1}')
    BEHIND=$(echo "$AHEAD_BEHIND" | awk '{print $2}')
    TOTAL_COMMITS=$(git rev-list --count HEAD 2>/dev/null || echo "?")

    info "Branch: ${BRANCH} | Commits: ${TOTAL_COMMITS}"
    info "Last commit: ${LAST_COMMIT}"
    info "Commit date: ${LAST_COMMIT_DATE}"

    if [ "$AHEAD" != "0" ] && [ "$AHEAD" != "?" ]; then
        track_warn "Branch is ${AHEAD} commit(s) ahead of origin/main — unpushed changes"
    fi
    if [ "$BEHIND" != "0" ] && [ "$BEHIND" != "?" ]; then
        track_warn "Branch is ${BEHIND} commit(s) behind origin/main — needs pull"
    fi
    if [ "$AHEAD" = "0" ] && [ "$BEHIND" = "0" ]; then
        track_ok "Up to date with origin/main"
    fi

    # Unstaged/untracked
    MODIFIED=$(git diff --name-only 2>/dev/null | wc -l)
    STAGED=$(git diff --cached --name-only 2>/dev/null | wc -l)
    UNTRACKED=$(git ls-files --others --exclude-standard 2>/dev/null | wc -l)

    if [ "$MODIFIED" -gt 0 ]; then
        track_warn "${MODIFIED} modified file(s) not staged"
        git diff --name-only 2>/dev/null | while read -r f; do info "  - $f"; done
    fi
    if [ "$STAGED" -gt 0 ]; then
        info "${STAGED} file(s) staged for commit"
    fi
    if [ "$UNTRACKED" -gt 0 ]; then
        track_warn "${UNTRACKED} untracked file(s)"
        git ls-files --others --exclude-standard 2>/dev/null | head -10 | while read -r f; do info "  - $f"; done
    fi
    if [ "$MODIFIED" -eq 0 ] && [ "$STAGED" -eq 0 ] && [ "$UNTRACKED" -eq 0 ]; then
        track_ok "Working tree clean"
    fi

    # Check for token in remote URL
    if echo "$REMOTE_URL" | grep -qE 'ghp_|github_pat_|gho_'; then
        track_crit "GitHub token embedded in git remote URL"
        info "Remote: $(echo "$REMOTE_URL" | sed -E 's/(ghp_|github_pat_|gho_)[a-zA-Z0-9]+/***TOKEN***/g')"
    else
        track_ok "No tokens in git remote URL"
        info "Remote: ${REMOTE_URL}"
    fi
else
    track_warn "Not a git repository"
fi

# ─── 3. SERVICES & PROCESSES ───────────────────────────────────────
section "3. SERVICES & PROCESSES"

for SVC in alex navada-1 navada navada-iphone; do
    STATUS=$(systemctl is-active "$SVC" 2>/dev/null || echo "not-found")
    ENABLED=$(systemctl is-enabled "$SVC" 2>/dev/null || echo "not-found")
    if [ "$STATUS" = "active" ]; then
        track_ok "systemd: ${SVC}.service — active (enabled: ${ENABLED})"
    elif [ "$STATUS" = "not-found" ]; then
        info "systemd: ${SVC}.service — not installed"
    else
        track_warn "systemd: ${SVC}.service — ${STATUS} (enabled: ${ENABLED})"
    fi
done

# Check for rogue/old services
for SVC in raven-dashboard clawdbot-gateway raven-ubidash dashboard; do
    SYS_EXISTS=$(systemctl list-unit-files "${SVC}.service" 2>/dev/null | grep -c "$SVC" || true)
    USR_EXISTS=$(systemctl --user list-unit-files "${SVC}.service" 2>/dev/null | grep -c "$SVC" || true)
    if [ "$SYS_EXISTS" -gt 0 ] || [ "$USR_EXISTS" -gt 0 ]; then
        track_warn "Stale service found: ${SVC}.service — should be removed"
    fi
done

# Cron jobs
CRON_COUNT=$(grep -rl 'navada\|ALEX_NAVADA\|alex' /etc/cron.d/ 2>/dev/null | wc -l)
info "Cron files referencing ALEX: ${CRON_COUNT}"
grep -h 'navada\|ALEX_NAVADA' /etc/cron.d/* 2>/dev/null | grep -v '^#' | while read -r line; do
    info "  cron: $line"
done

# ─── 4. DISK & SYSTEM HEALTH ───────────────────────────────────────
section "4. DISK & SYSTEM HEALTH"

DISK_USE=$(df -h / | awk 'NR==2 {print $5}' | tr -d '%')
DISK_AVAIL=$(df -h / | awk 'NR==2 {print $4}')
DISK_TOTAL=$(df -h / | awk 'NR==2 {print $2}')

if [ "$DISK_USE" -lt 70 ]; then
    track_ok "Disk: ${DISK_USE}% used (${DISK_AVAIL} free of ${DISK_TOTAL})"
elif [ "$DISK_USE" -lt 85 ]; then
    track_warn "Disk: ${DISK_USE}% used (${DISK_AVAIL} free of ${DISK_TOTAL})"
else
    track_crit "Disk: ${DISK_USE}% used — critically low (${DISK_AVAIL} free)"
fi

# Memory
MEM_TOTAL=$(free -h | awk '/Mem:/ {print $2}')
MEM_USED=$(free -h | awk '/Mem:/ {print $3}')
MEM_AVAIL=$(free -h | awk '/Mem:/ {print $7}')
info "Memory: ${MEM_USED} used / ${MEM_TOTAL} total (${MEM_AVAIL} available)"

# Uptime & load
UPTIME=$(uptime -p 2>/dev/null || uptime | awk -F'( |,)' '{print $5,$6}')
LOAD=$(uptime | awk -F'load average:' '{print $2}' | xargs)
info "Uptime: ${UPTIME} | Load: ${LOAD}"

# CPU temp (Raspberry Pi)
if [ -f /sys/class/thermal/thermal_zone0/temp ]; then
    TEMP=$(awk '{printf "%.1f", $1/1000}' /sys/class/thermal/thermal_zone0/temp)
    if (( $(echo "$TEMP > 75" | bc -l 2>/dev/null || echo 0) )); then
        track_warn "CPU temp: ${TEMP}°C (throttling risk)"
    else
        track_ok "CPU temp: ${TEMP}°C"
    fi
fi

# ─── 5. SECURITY AUDIT ─────────────────────────────────────────────
if [ "$MODE" = "--quick" ]; then
    section "5. SECURITY AUDIT (skipped — quick mode)"
    info "Run without --quick for full security scan"
else
    section "5. SECURITY AUDIT"

    # 5a. Environment files
    log "  ${BOLD}5a. Environment & Secret Files${NC}"

    ENV_FILES=$(find "$REAL_PROJECT" -name '.env*' -not -path '*/node_modules/*' -not -path '*/.git/*' 2>/dev/null)
    if [ -n "$ENV_FILES" ]; then
        while IFS= read -r envfile; do
            PERMS=$(stat -c '%a' "$envfile" 2>/dev/null)
            if [ "$PERMS" != "600" ] && [ "$PERMS" != "400" ]; then
                track_crit ".env file world/group-readable: ${envfile} (perms: ${PERMS})"
            else
                track_ok ".env file properly restricted: ${envfile} (perms: ${PERMS})"
            fi

            # Check for real API keys in env files (only CRIT if permissions are wrong)
            if grep -qE 'sk-ant-|sk-[a-zA-Z0-9]{20,}|ghp_|AIza|AKIA' "$envfile" 2>/dev/null; then
                if [ "$PERMS" = "600" ] || [ "$PERMS" = "400" ]; then
                    info "API keys present in ${envfile} (protected — perms: ${PERMS})"
                else
                    track_crit "Real API keys found in ${envfile} with weak perms: ${PERMS}"
                fi
            fi
        done <<< "$ENV_FILES"
    else
        track_ok "No .env files in project directory"
    fi

    # Check ~/.alex/config.json or config.json.enc permissions
    if [ -f "$HOME/.alex/config.json.enc" ]; then
        PERMS=$(stat -c '%a' "$HOME/.alex/config.json.enc" 2>/dev/null)
        if [ "$PERMS" = "600" ] || [ "$PERMS" = "400" ]; then
            track_ok "~/.alex/config.json.enc permissions: ${PERMS} (encrypted)"
        else
            track_warn "~/.alex/config.json.enc permissions: ${PERMS} (should be 600)"
        fi
    elif [ -f "$HOME/.alex/config.json" ]; then
        PERMS=$(stat -c '%a' "$HOME/.alex/config.json" 2>/dev/null)
        if [ "$PERMS" = "600" ] || [ "$PERMS" = "400" ]; then
            track_ok "~/.alex/config.json permissions: ${PERMS}"
        else
            track_warn "~/.alex/config.json permissions: ${PERMS} (should be 600)"
        fi
    fi

    # 5b. Hardcoded secrets in source
    log ""
    log "  ${BOLD}5b. Hardcoded Secrets in Source${NC}"

    SECRET_HITS=$(grep -rnE \
        'sk-ant-api|sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{30,}|AIzaSy|AKIA[A-Z0-9]{16}|password\s*[:=]\s*["\x27][^"\x27]{6,}' \
        "$REAL_PROJECT/src/" "$REAL_PROJECT/dashboard-vercel/api/" "$REAL_PROJECT/Alex-Scripts/" \
        --include='*.js' --include='*.py' --include='*.sh' \
        2>/dev/null | grep -v node_modules | grep -v '.git/' \
        | grep -v 'grep\|xargs\|regex\|pattern\|\[A-Za-z\|\[a-zA-Z\|\\{' || true)

    if [ -n "$SECRET_HITS" ]; then
        track_crit "Potential hardcoded secrets found in source:"
        echo "$SECRET_HITS" | head -10 | while IFS= read -r line; do
            info "  $(echo "$line" | sed -E 's/(sk-ant-api[a-zA-Z0-9-]{10})[a-zA-Z0-9-]+/\1.../g')"
        done
    else
        track_ok "No hardcoded secrets detected in source files"
    fi

    # 5c. Command injection
    log ""
    log "  ${BOLD}5c. Command Injection Risks${NC}"

    EXEC_HITS=$(grep -rnE 'exec(Async|Sync|File)?\s*\(\s*`' \
        "$REAL_PROJECT/src/" --include='*.js' 2>/dev/null | grep -v node_modules || true)

    if [ -n "$EXEC_HITS" ]; then
        EXEC_COUNT=$(echo "$EXEC_HITS" | wc -l)
        track_warn "${EXEC_COUNT} shell exec call(s) using template strings (potential injection)"
        echo "$EXEC_HITS" | while IFS= read -r line; do
            FILE=$(echo "$line" | cut -d: -f1 | sed "s|$REAL_PROJECT/||")
            LINENO=$(echo "$line" | cut -d: -f2)
            info "  ${FILE}:${LINENO}"
        done
    else
        track_ok "No template-string shell exec calls found"
    fi

    # 5d. CORS configuration
    log ""
    log "  ${BOLD}5d. CORS & Network Security${NC}"

    CORS_WILD=$(grep -rn '"Access-Control-Allow-Origin".*"\*"' \
        "$REAL_PROJECT" --include='*.json' --include='*.js' \
        2>/dev/null | grep -v node_modules | grep -v '.git/' || true)

    if [ -n "$CORS_WILD" ]; then
        track_warn "CORS wildcard (*) found:"
        echo "$CORS_WILD" | while IFS= read -r line; do
            FILE=$(echo "$line" | cut -d: -f1 | sed "s|$REAL_PROJECT/||")
            info "  ${FILE}"
        done
    else
        track_ok "No CORS wildcard found"
    fi

    # Check bind addresses
    BIND_ALL=$(grep -rnE "listen\s*\(\s*[0-9]+\s*[,)]|0\.0\.0\.0" \
        "$REAL_PROJECT/src/" --include='*.js' 2>/dev/null | grep -v node_modules || true)

    if echo "$BIND_ALL" | grep -q '0\.0\.0\.0'; then
        track_warn "Service binds to 0.0.0.0 (all interfaces)"
    fi

    # 5e. Authentication
    log ""
    log "  ${BOLD}5e. Authentication & Auth Bypass${NC}"

    # Localhost bypass
    LOCALHOST_BYPASS=$(grep -rn 'isLocalhost\|isLocalBypass\|127\.0\.0\.1' \
        "$REAL_PROJECT/src/" --include='*.js' 2>/dev/null | grep -v node_modules | head -5 || true)

    if [ -n "$LOCALHOST_BYPASS" ]; then
        track_warn "Localhost auth bypass detected in control API"
    fi

    # Plaintext password comparison
    PLAIN_PASS=$(grep -rnE 'password\s*!==\s*|password\s*===\s*' \
        "$REAL_PROJECT/dashboard-vercel/" --include='*.js' 2>/dev/null | grep -v node_modules || true)

    if [ -n "$PLAIN_PASS" ]; then
        track_warn "Plaintext password comparison (timing attack risk):"
        echo "$PLAIN_PASS" | while IFS= read -r line; do
            FILE=$(echo "$line" | cut -d: -f1 | sed "s|$REAL_PROJECT/||")
            LINENO=$(echo "$line" | cut -d: -f2)
            info "  ${FILE}:${LINENO}"
        done
    fi

    # Fallback secrets
    FALLBACK_SEC=$(grep -rnE "fallback.secret|'fallback-|default.secret" \
        "$REAL_PROJECT" --include='*.js' 2>/dev/null | grep -v node_modules | grep -v '.git/' || true)

    if [ -n "$FALLBACK_SEC" ]; then
        track_warn "Hardcoded fallback secret(s) found:"
        echo "$FALLBACK_SEC" | while IFS= read -r line; do
            FILE=$(echo "$line" | cut -d: -f1 | sed "s|$REAL_PROJECT/||")
            LINENO=$(echo "$line" | cut -d: -f2)
            info "  ${FILE}:${LINENO}"
        done
    fi

    # 5f. .gitignore coverage
    log ""
    log "  ${BOLD}5f. Gitignore & Committed Secrets${NC}"

    GITIGNORE_CHECKS=(".env" ".env.local" ".env.production" "config.json" "*.pem" "*.key")
    GITIGNORE_FILE="$REAL_PROJECT/.gitignore"

    if [ -f "$GITIGNORE_FILE" ]; then
        for pattern in "${GITIGNORE_CHECKS[@]}"; do
            if grep -qF "$pattern" "$GITIGNORE_FILE" 2>/dev/null || grep -q "^${pattern}$" "$GITIGNORE_FILE" 2>/dev/null; then
                track_ok ".gitignore covers: ${pattern}"
            else
                if [ "$pattern" = "*.pem" ] || [ "$pattern" = "*.key" ]; then
                    info ".gitignore does not list: ${pattern} (may not be needed)"
                else
                    track_warn ".gitignore missing: ${pattern}"
                fi
            fi
        done
    else
        track_crit "No .gitignore file found"
    fi

    # Check if .env.local was ever committed
    if [ -d "$REAL_PROJECT/.git" ]; then
        ENV_IN_GIT=$(cd "$REAL_PROJECT" && git log --all --oneline -- '*.env*' '.env*' '*/.env*' 2>/dev/null | head -3)
        if [ -n "$ENV_IN_GIT" ]; then
            track_crit ".env file(s) appear in git history — secrets may be exposed"
            echo "$ENV_IN_GIT" | while IFS= read -r line; do info "  $line"; done
        else
            track_ok "No .env files found in git history"
        fi
    fi

    # 5g. Dependencies
    log ""
    log "  ${BOLD}5g. Dependencies${NC}"

    if [ -f "$REAL_PROJECT/package-lock.json" ]; then
        track_ok "package-lock.json exists (reproducible builds)"
    else
        track_warn "No package-lock.json — builds are not reproducible"
    fi

    # Check for known vulnerable patterns in package.json
    if [ -f "$REAL_PROJECT/package.json" ]; then
        OUTDATED_COUNT=$(cd "$REAL_PROJECT" && npm outdated 2>/dev/null | tail -n +2 | wc -l || echo "0")
        OUTDATED_COUNT=$(echo "$OUTDATED_COUNT" | tr -d '[:space:]')
        if [ "$OUTDATED_COUNT" -gt 10 ]; then
            track_warn "${OUTDATED_COUNT} outdated dependencies — run 'npm outdated' to review"
        else
            track_ok "Dependencies appear up to date (${OUTDATED_COUNT} outdated)"
        fi
    fi

    # 5h. Logging
    log ""
    log "  ${BOLD}5h. Sensitive Data in Logs${NC}"

    LOG_SECRETS=$(grep -rnE 'console\.(log|error|warn).*([Tt]oken|[Kk]ey|[Pp]assword|[Ss]ecret)' \
        "$REAL_PROJECT/src/" --include='*.js' 2>/dev/null | \
        grep -vE 'token_count|token_usage|input_tokens|output_tokens|maskSensitive|TOKENS' || true)

    if [ -n "$LOG_SECRETS" ]; then
        LOG_COUNT=$(echo "$LOG_SECRETS" | wc -l)
        track_warn "${LOG_COUNT} log statement(s) may reference sensitive data"
        echo "$LOG_SECRETS" | head -5 | while IFS= read -r line; do
            FILE=$(echo "$line" | cut -d: -f1 | sed "s|$REAL_PROJECT/||")
            LINENO=$(echo "$line" | cut -d: -f2)
            info "  ${FILE}:${LINENO}"
        done
    else
        track_ok "No sensitive data patterns found in log statements"
    fi
fi

# ─── 6. DASHBOARD (VERCEL) ─────────────────────────────────────────
section "6. DASHBOARD (VERCEL)"

VERCEL_DIR="$REAL_PROJECT/dashboard-vercel"
if [ -d "$VERCEL_DIR" ]; then
    API_COUNT=$(find "$VERCEL_DIR/api" -name '*.js' -type f 2>/dev/null | wc -l)
    info "Serverless API endpoints: ${API_COUNT}"
    info "Frontend: ${VERCEL_DIR}/public/index.html"

    if [ -f "$VERCEL_DIR/vercel.json" ]; then
        track_ok "vercel.json present"
    else
        track_warn "No vercel.json found"
    fi
else
    info "No Vercel dashboard directory found"
fi

# ─── 7. WORKSPACE FILES ────────────────────────────────────────────
section "7. ALEX WORKSPACE (~/.alex/)"

if [ -d "$HOME/.alex" ]; then
    CONV_COUNT=$(find "$HOME/.alex/conversations" -name '*.json' -type f 2>/dev/null | wc -l)
    MEM_COUNT=$(find "$HOME/.alex/memory" -type f 2>/dev/null | wc -l)
    TASK_COUNT=$(find "$HOME/.alex/tasks" -name '*.json' -type f 2>/dev/null | wc -l)
    SKILL_COUNT=$(find "$HOME/.alex/skills" -type d -mindepth 1 2>/dev/null | wc -l)
    WORKSPACE_SIZE=$(du -sh "$HOME/.alex" 2>/dev/null | cut -f1)

    info "Workspace size: ${WORKSPACE_SIZE}"
    info "Conversations: ${CONV_COUNT} | Memory files: ${MEM_COUNT}"
    info "Tasks: ${TASK_COUNT} | Skills: ${SKILL_COUNT}"

    # Check config exists and is readable (plaintext or encrypted)
    if [ -f "$HOME/.alex/config.json.enc" ]; then
        track_ok "config.json.enc exists (encrypted)"
    elif [ -f "$HOME/.alex/config.json" ]; then
        track_ok "config.json exists"
    else
        track_crit "config.json missing — ALEX cannot start"
    fi

    if [ -f "$HOME/.alex/IDENTITY.md" ]; then
        track_ok "IDENTITY.md exists"
    else
        track_warn "IDENTITY.md missing"
    fi
else
    track_crit "~/.alex/ workspace directory not found"
fi

# ─── 8. RECENT BACKUPS ─────────────────────────────────────────────
section "8. BACKUPS"

BACKUP_DIR="/home/head/backups"
if [ -d "$BACKUP_DIR" ]; then
    LATEST_BACKUP=$(ls -1t "$BACKUP_DIR"/alex-backup-*.tar.gz 2>/dev/null | head -1)
    BACKUP_COUNT=$(ls -1 "$BACKUP_DIR"/alex-backup-*.tar.gz 2>/dev/null | wc -l)

    if [ -n "$LATEST_BACKUP" ]; then
        BACKUP_AGE_DAYS=$(( ($(date +%s) - $(stat -c %Y "$LATEST_BACKUP")) / 86400 ))
        BACKUP_SIZE=$(du -sh "$LATEST_BACKUP" | cut -f1)
        info "Backups: ${BACKUP_COUNT} found in ${BACKUP_DIR}"
        info "Latest: $(basename "$LATEST_BACKUP") (${BACKUP_SIZE})"

        if [ "$BACKUP_AGE_DAYS" -le 1 ]; then
            track_ok "Latest backup is from today"
        elif [ "$BACKUP_AGE_DAYS" -le 7 ]; then
            track_ok "Latest backup is ${BACKUP_AGE_DAYS} day(s) old"
        else
            track_warn "Latest backup is ${BACKUP_AGE_DAYS} days old — may be stale"
        fi
    else
        track_warn "No backup files found"
    fi
else
    track_warn "Backup directory not found: ${BACKUP_DIR}"
fi

# ─── SUMMARY ───────────────────────────────────────────────────────
section "SUMMARY"

log ""
log "  ${RED}CRITICAL: ${count_crit}${NC}  |  ${YELLOW}WARNINGS: ${count_warn}${NC}  |  ${GREEN}PASSED: ${count_ok}${NC}"
log ""

if [ "$count_crit" -gt 0 ]; then
    log "  ${RED}${BOLD}Action required — critical issues found.${NC}"
elif [ "$count_warn" -gt 0 ]; then
    log "  ${YELLOW}${BOLD}Review warnings above when prioritising next work.${NC}"
else
    log "  ${GREEN}${BOLD}All checks passed.${NC}"
fi

log ""
log "${DIM}Report saved: ${REPORT_FILE}${NC}"
log "${DIM}Previous scans: ls \"${SCAN_DIR}/scan-\"*${NC}"

# Rotate old reports — keep last 20
SCAN_COUNT=$(ls -1 "$SCAN_DIR"/scan-*.txt 2>/dev/null | wc -l)
if [ "$SCAN_COUNT" -gt 20 ]; then
    ls -1t "$SCAN_DIR"/scan-*.txt | tail -n +21 | while read -r old; do
        rm -f "$old"
    done
fi
