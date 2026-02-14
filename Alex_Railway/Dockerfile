# =============================================================================
# ALEX AI Agent — Multi-stage Docker Build
# Target: ARM64 (Oracle Cloud A1 Flex / Raspberry Pi 5)
# =============================================================================

# ── Stage 1: Install production Node.js dependencies ──
FROM node:22-bookworm-slim AS builder

WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --production --ignore-scripts

# ── Stage 2: Runtime image ──
FROM node:22-bookworm-slim

LABEL maintainer="NAVADA"
LABEL description="ALEX AI Agent — Global Economist"

# System dependencies for ALEX tools:
#   python3 + venv    — chart generation, RAG manager, PDF generation
#   poppler-utils     — pdftotext for PDF extraction
#   tesseract-ocr     — OCR for image/scanned PDF processing
#   chromium          — Puppeteer for mindmap screenshots
#   curl              — health checks + cron task triggers
#   cron              — scheduled heartbeat tasks
#   fonts-liberation  — readable fonts for chart/diagram rendering
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-venv python3-pip \
    poppler-utils \
    tesseract-ocr \
    chromium \
    curl \
    cron \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

# Puppeteer: use system Chromium, skip download
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV CHROMIUM_PATH=/usr/bin/chromium

# Create non-root user
RUN useradd -m -s /bin/bash alex

# Python virtual environment with ALEX's dependencies
RUN python3 -m venv /opt/alex-venv
ENV PATH="/opt/alex-venv/bin:$PATH"
RUN pip install --no-cache-dir \
    matplotlib numpy pandas seaborn plotly altair scipy scikit-learn \
    chromadb \
    python-docx openpyxl \
    pytesseract Pillow \
    typer

# Application directory
WORKDIR /app

# Copy production node_modules from builder
COPY --from=builder /build/node_modules ./node_modules

# Copy application source
COPY package.json ./
COPY src/ ./src/
COPY Alex-Scripts/ ./Alex-Scripts/
COPY Alex-CLI/ ./Alex-CLI/

# Data directory (mounted as volume in production)
RUN mkdir -p /home/alex/.alex/logs \
             /home/alex/.alex/conversations \
             /home/alex/.alex/memory \
             /home/alex/.alex/tasks \
             /home/alex/.alex/skills \
             /home/alex/.alex/templates \
             /home/alex/.alex/outputs/charts \
             /home/alex/.alex/outputs/diagrams \
             /home/alex/.alex/outputs/mindmaps \
             /home/alex/.alex/outputs/images \
             /home/alex/.alex/reports \
             /home/alex/.alex/uploads \
             /home/alex/.alex/cache \
    && chown -R alex:alex /home/alex/.alex

# Environment
ENV NODE_ENV=production
ENV HOME=/home/alex
ENV ALEX_BIND_HOST=0.0.0.0

EXPOSE 9090

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -sf http://localhost:9090/api/health || exit 1

# Start ALEX gateway
CMD ["node", "src/gateway.js"]
