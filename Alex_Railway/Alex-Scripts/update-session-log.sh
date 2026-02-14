#!/bin/bash
# Auto-update SESSION-LOG.md after each commit to navada-1
# Called by git post-commit hook

REPO_DIR="/home/head/navada-1"
LOG_FILE="/home/head/ALEX_NAVADA/Manager/sessions/SESSION-LOG.md"
DAY_ONE="2026-01-31"

# Get latest commit info
HASH=$(git -C "$REPO_DIR" log -1 --pretty=format:"%h")
MSG=$(git -C "$REPO_DIR" log -1 --pretty=format:"%s")
DATE=$(git -C "$REPO_DIR" log -1 --pretty=format:"%ad" --date=short)
DAY_NAME=$(date -d "$DATE" +"%A")
DAY_NUM=$(date -d "$DATE" +"%-d")
MONTH_NAME=$(date -d "$DATE" +"%b")
YEAR=$(date -d "$DATE" +"%Y")

# Calculate day number since project start
DAYS_SINCE=$(( ( $(date -d "$DATE" +%s) - $(date -d "$DAY_ONE" +%s) ) / 86400 + 1 ))

# Section header for today
SECTION_HEADER="## Day ${DAYS_SINCE} — ${DAY_NAME} ${DAY_NUM} ${MONTH_NAME} ${YEAR}"
COMMIT_LINE="- \`${HASH}\` — ${MSG}"

# Check if today's section already exists
if grep -qF "$SECTION_HEADER" "$LOG_FILE" 2>/dev/null; then
    # Section exists — append commit before the next "---" separator after this section
    python3 - "$LOG_FILE" "$SECTION_HEADER" "$COMMIT_LINE" << 'PYEOF'
import sys

log_file = sys.argv[1]
section_header = sys.argv[2]
commit_line = sys.argv[3]

with open(log_file, 'r') as f:
    content = f.read()

# Check if this commit is already logged
if commit_line.split('`')[1] in content:
    sys.exit(0)

# Find the section and its ### Commits block
lines = content.split('\n')
in_section = False
commits_idx = None
insert_idx = None

for i, line in enumerate(lines):
    if section_header in line:
        in_section = True
    elif in_section and line.startswith('## Day'):
        # Hit next section without finding commits — insert before this
        insert_idx = i - 1
        break
    elif in_section and line.strip() == '### Commits':
        commits_idx = i
    elif in_section and commits_idx is not None and line.strip() == '---':
        insert_idx = i
        break

if insert_idx is None:
    # Section is at the end of file — append
    insert_idx = len(lines)

lines.insert(insert_idx, commit_line)

with open(log_file, 'w') as f:
    f.write('\n'.join(lines))
PYEOF
else
    # New day — append a new section at the end of the file
    cat >> "$LOG_FILE" << EOF

---

${SECTION_HEADER}
### Session Summary
_Session in progress..._

### What Was Built
_Updates will be added as work progresses._

### Commits
${COMMIT_LINE}
EOF
fi
