#!/bin/bash
# =============================================================================
# ALEX OCI Deployment Script
# Builds Docker image on Pi, pushes to OCIR, deploys on OCI instance.
#
# Prerequisites:
#   - OCI CLI configured (~/.oci/config)
#   - Docker logged into OCIR
#   - SSH access to OCI instance
#
# Usage:
#   ./deploy.sh                    # Full deploy: build + push + restart
#   ./deploy.sh --build-only       # Build image locally only
#   ./deploy.sh --push-only        # Push existing image to OCIR
#   ./deploy.sh --deploy-only      # SSH + pull + restart on OCI instance
# =============================================================================

set -euo pipefail

# ── Configuration ──
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# OCI Container Registry — set these for your tenancy
REGION="${OCI_REGION:-eu-london-1}"
NAMESPACE="${OCI_NAMESPACE:?Set OCI_NAMESPACE to your tenancy namespace}"
REPO="alex"
TAG="${ALEX_TAG:-latest}"
REGISTRY="${REGION}.ocir.io"
FULL_IMAGE="${REGISTRY}/${NAMESPACE}/${REPO}:${TAG}"

# OCI Compute instance
OCI_HOST="${OCI_HOST:?Set OCI_HOST to the public IP of your OCI instance}"
OCI_USER="${OCI_USER:-opc}"
SSH_KEY="${OCI_SSH_KEY:-$HOME/.ssh/id_rsa}"

# ── Functions ──

build() {
    echo "==> Building Docker image: alex:${TAG}"
    cd "$PROJECT_DIR"
    docker build --platform linux/arm64 -t "alex:${TAG}" .
    docker tag "alex:${TAG}" "$FULL_IMAGE"
    echo "==> Built and tagged: $FULL_IMAGE"
}

push() {
    echo "==> Pushing to OCIR: $FULL_IMAGE"
    docker push "$FULL_IMAGE"
    echo "==> Push complete"
}

deploy() {
    echo "==> Deploying to OCI instance: ${OCI_USER}@${OCI_HOST}"
    ssh -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new "${OCI_USER}@${OCI_HOST}" bash -s <<REMOTE
        set -euo pipefail
        echo "Pulling latest image..."
        docker pull "$FULL_IMAGE"

        cd ~/alex-deploy
        export ALEX_IMAGE="$FULL_IMAGE"

        echo "Restarting services..."
        docker compose down
        docker compose up -d

        echo "Waiting for health check..."
        sleep 10
        if curl -sf http://localhost:9090/api/health > /dev/null; then
            echo "ALEX is healthy!"
        else
            echo "WARNING: Health check failed. Check logs:"
            docker logs alex --tail 20
            exit 1
        fi

        echo "Cleaning up old images..."
        docker image prune -f
REMOTE
    echo "==> Deployment complete"
}

# ── Main ──

case "${1:-full}" in
    --build-only)  build ;;
    --push-only)   push ;;
    --deploy-only) deploy ;;
    full|*)        build && push && deploy ;;
esac
