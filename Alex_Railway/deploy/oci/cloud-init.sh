#!/bin/bash
# =============================================================================
# OCI Instance Bootstrap — Cloud-Init User Data Script
# Run once when the ARM A1 compute instance is first created.
# Installs Docker and prepares the environment for ALEX deployment.
# =============================================================================

set -euo pipefail
exec > /var/log/alex-cloud-init.log 2>&1

echo "==> ALEX Cloud-Init starting at $(date)"

# ── Install Docker ──
dnf install -y dnf-utils
dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

systemctl enable --now docker
usermod -aG docker opc

# ── Open firewall ports ──
firewall-cmd --permanent --add-port=9090/tcp   # Control API
firewall-cmd --permanent --add-port=443/tcp    # Future HTTPS
firewall-cmd --reload

# ── Create deployment directory ──
mkdir -p /home/opc/alex-deploy
mkdir -p /home/opc/alex-data
chown -R opc:opc /home/opc/alex-deploy /home/opc/alex-data

echo "==> Cloud-Init complete at $(date)"
echo "==> Next: SCP docker-compose.yml + .env to /home/opc/alex-deploy/"
echo "==> Then: SCP ALEX data files to /home/opc/alex-data/"
