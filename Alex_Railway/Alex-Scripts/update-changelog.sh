#!/bin/bash
# Auto-update CHANGELOG.md after each commit to navada-1
# Called by git post-commit hook

REPO_DIR="/home/head/navada-1"
CHANGELOG="/home/head/ALEX_NAVADA/Alex All Fixes/CHANGELOG.md"

# Get latest commit info
HASH=$(git -C "$REPO_DIR" log -1 --pretty=format:"%h")
MSG=$(git -C "$REPO_DIR" log -1 --pretty=format:"%s")
DATE=$(git -C "$REPO_DIR" log -1 --pretty=format:"%ad" --date=short)
FILES_CHANGED=$(git -C "$REPO_DIR" diff-tree --no-commit-id --name-only -r HEAD 2>/dev/null)

# Skip if commit already logged
if grep -qF "$HASH" "$CHANGELOG" 2>/dev/null; then
    exit 0
fi

# Classify commit type from message
TYPE=""
MSG_LOWER=$(echo "$MSG" | tr '[:upper:]' '[:lower:]')
case "$MSG_LOWER" in
    *fix*|*bug*|*patch*|*hotfix*|*resolve*)     TYPE="Bug Fix" ;;
    *security*|*auth*|*permission*|*mask*|*lock*) TYPE="Security" ;;
    *doc*|*readme*|*changelog*|*comment*)        TYPE="Docs" ;;
    *refactor*|*clean*|*reorgani*|*rename*)      TYPE="Improvement" ;;
    *test*|*spec*|*coverage*)                    TYPE="Test" ;;
    *)                                           TYPE="Feature" ;;
esac

# Classify affected areas from changed files
AREAS=""
if echo "$FILES_CHANGED" | grep -q '^src/gateway'; then     AREAS="${AREAS}, Gateway"; fi
if echo "$FILES_CHANGED" | grep -q '^src/chat';    then     AREAS="${AREAS}, Chat"; fi
if echo "$FILES_CHANGED" | grep -q '^src/tools';   then     AREAS="${AREAS}, Tools"; fi
if echo "$FILES_CHANGED" | grep -q '^src/heartbeat'; then   AREAS="${AREAS}, Heartbeat"; fi
if echo "$FILES_CHANGED" | grep -q '^src/inbox\|src/email'; then AREAS="${AREAS}, Email"; fi
if echo "$FILES_CHANGED" | grep -q '^src/slack';   then     AREAS="${AREAS}, Slack"; fi
if echo "$FILES_CHANGED" | grep -q '^src/memory';  then     AREAS="${AREAS}, Memory"; fi
if echo "$FILES_CHANGED" | grep -q '^dashboard-vercel'; then AREAS="${AREAS}, Dashboard"; fi
if echo "$FILES_CHANGED" | grep -q '^Manager';     then     AREAS="${AREAS}, Manager"; fi
if echo "$FILES_CHANGED" | grep -q '^scripts';     then     AREAS="${AREAS}, Scripts"; fi
if echo "$FILES_CHANGED" | grep -q '^tests';       then     AREAS="${AREAS}, Tests"; fi
AREAS=$(echo "$AREAS" | sed 's/^, //')

# Count files changed
FILE_COUNT=$(echo "$FILES_CHANGED" | grep -c '.' || echo "0")

# Build the new entry
ENTRY="## ${DATE} — \`${HASH}\` ${MSG}"
ENTRY="${ENTRY}\n**Type:** ${TYPE}"
if [ -n "$AREAS" ]; then
    ENTRY="${ENTRY} | **Areas:** ${AREAS}"
fi
ENTRY="${ENTRY}\n- ${MSG} (${FILE_COUNT} file(s) changed)"

# Insert after the header block (line 4, after "---")
# Find the first entry line (first "## 20") and insert before it
python3 - "$CHANGELOG" "$ENTRY" << 'PYEOF'
import sys

changelog = sys.argv[1]
new_entry = sys.argv[2]

with open(changelog, 'r') as f:
    content = f.read()

lines = content.split('\n')
insert_idx = None

for i, line in enumerate(lines):
    if line.startswith('## 20'):
        insert_idx = i
        break

if insert_idx is None:
    # No existing entries — append after header
    insert_idx = len(lines)

# Insert new entry with spacing
new_lines = new_entry.split('\\n') + ['']
for j, nl in enumerate(new_lines):
    lines.insert(insert_idx + j, nl)

with open(changelog, 'w') as f:
    f.write('\n'.join(lines))
PYEOF
