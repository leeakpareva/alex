#!/bin/bash
# Migrate ~/.alex/ to new directory structure
# Run once after deploying the code changes
set -e

ALEX_DIR="$HOME/.alex"

echo "Migrating ~/.alex/ directory structure..."

# Create new directories
mkdir -p "$ALEX_DIR/logs/audit"
mkdir -p "$ALEX_DIR/logs/tokens"
mkdir -p "$ALEX_DIR/outputs/charts"
mkdir -p "$ALEX_DIR/outputs/diagrams"
mkdir -p "$ALEX_DIR/outputs/mindmaps"
mkdir -p "$ALEX_DIR/outputs/images"
mkdir -p "$ALEX_DIR/outputs/reports"
mkdir -p "$ALEX_DIR/files/uploads"
mkdir -p "$ALEX_DIR/files/documents"
mkdir -p "$ALEX_DIR/files/articles"

# Move audit logs
if ls "$ALEX_DIR/logs"/audit_*.jsonl 2>/dev/null 1>&2; then
    mv "$ALEX_DIR/logs"/audit_*.jsonl "$ALEX_DIR/logs/audit/" 2>/dev/null || true
    echo "  Moved audit logs to logs/audit/"
fi

# Move token logs
if ls "$ALEX_DIR/logs"/tokens_*.jsonl 2>/dev/null 1>&2; then
    mv "$ALEX_DIR/logs"/tokens_*.jsonl "$ALEX_DIR/logs/tokens/" 2>/dev/null || true
    echo "  Moved token logs to logs/tokens/"
fi

# Move output directories (contents only, if they exist)
for dir in charts diagrams mindmaps images reports; do
    if [ -d "$ALEX_DIR/$dir" ] && [ "$(ls -A "$ALEX_DIR/$dir" 2>/dev/null)" ]; then
        mv "$ALEX_DIR/$dir"/* "$ALEX_DIR/outputs/$dir/" 2>/dev/null || true
        echo "  Moved $dir/ to outputs/$dir/"
    fi
    # Remove old empty directory
    rmdir "$ALEX_DIR/$dir" 2>/dev/null || true
done

# Move files directories
for dir in uploads documents articles; do
    if [ -d "$ALEX_DIR/$dir" ] && [ "$(ls -A "$ALEX_DIR/$dir" 2>/dev/null)" ]; then
        mv "$ALEX_DIR/$dir"/* "$ALEX_DIR/files/$dir/" 2>/dev/null || true
        echo "  Moved $dir/ to files/$dir/"
    fi
    rmdir "$ALEX_DIR/$dir" 2>/dev/null || true
done

echo "Migration complete."
