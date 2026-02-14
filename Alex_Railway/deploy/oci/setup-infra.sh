#!/bin/bash
# =============================================================================
# OCI Infrastructure Setup via CLI
# Creates VCN, subnet, security list, and ARM A1 compute instance.
#
# Prerequisites:
#   - OCI CLI installed and configured (~/.oci/config)
#   - Tenancy with Always Free resources available
#
# Usage:
#   ./setup-infra.sh              # Interactive — creates all resources
#   source ./setup-infra.sh       # Also exports vars for subsequent use
# =============================================================================

set -euo pipefail

# ── Configuration ──
COMPARTMENT_ID="${OCI_COMPARTMENT_ID:?Set OCI_COMPARTMENT_ID}"
REGION="${OCI_REGION:-eu-london-1}"
AD="${OCI_AD:-1}"  # Availability domain index
SSH_PUBLIC_KEY="${OCI_SSH_PUBLIC_KEY:-$HOME/.ssh/id_rsa.pub}"

echo "==> Region: $REGION"
echo "==> Compartment: $COMPARTMENT_ID"

# ── Get Availability Domain ──
echo "==> Looking up availability domain..."
AD_NAME=$(oci iam availability-domain list \
    --compartment-id "$COMPARTMENT_ID" \
    --query "data[${AD}].name" \
    --raw-output)
echo "    AD: $AD_NAME"

# ── Create VCN ──
echo "==> Creating VCN..."
VCN_ID=$(oci network vcn create \
    --compartment-id "$COMPARTMENT_ID" \
    --display-name "alex-vcn" \
    --cidr-blocks '["10.0.0.0/16"]' \
    --dns-label "alexvcn" \
    --query "data.id" --raw-output \
    --wait-for-state AVAILABLE)
echo "    VCN: $VCN_ID"

# ── Create Internet Gateway ──
echo "==> Creating Internet Gateway..."
IGW_ID=$(oci network internet-gateway create \
    --compartment-id "$COMPARTMENT_ID" \
    --vcn-id "$VCN_ID" \
    --display-name "alex-igw" \
    --is-enabled true \
    --query "data.id" --raw-output \
    --wait-for-state AVAILABLE)
echo "    IGW: $IGW_ID"

# ── Update Default Route Table ──
echo "==> Adding default route to internet gateway..."
RT_ID=$(oci network vcn get \
    --vcn-id "$VCN_ID" \
    --query "data.\"default-route-table-id\"" --raw-output)
oci network route-table update \
    --rt-id "$RT_ID" \
    --route-rules "[{\"destination\":\"0.0.0.0/0\",\"destinationService\":null,\"networkEntityId\":\"$IGW_ID\"}]" \
    --force \
    --wait-for-state AVAILABLE > /dev/null

# ── Create Security List ──
echo "==> Creating security list..."
SL_ID=$(oci network security-list create \
    --compartment-id "$COMPARTMENT_ID" \
    --vcn-id "$VCN_ID" \
    --display-name "alex-seclist" \
    --ingress-security-rules "[
        {\"source\":\"0.0.0.0/0\",\"protocol\":\"6\",\"tcpOptions\":{\"destinationPortRange\":{\"min\":22,\"max\":22}}},
        {\"source\":\"0.0.0.0/0\",\"protocol\":\"6\",\"tcpOptions\":{\"destinationPortRange\":{\"min\":9090,\"max\":9090}}},
        {\"source\":\"0.0.0.0/0\",\"protocol\":\"6\",\"tcpOptions\":{\"destinationPortRange\":{\"min\":443,\"max\":443}}}
    ]" \
    --egress-security-rules "[{\"destination\":\"0.0.0.0/0\",\"protocol\":\"all\"}]" \
    --query "data.id" --raw-output \
    --wait-for-state AVAILABLE)
echo "    Security List: $SL_ID"

# ── Create Subnet ──
echo "==> Creating public subnet..."
SUBNET_ID=$(oci network subnet create \
    --compartment-id "$COMPARTMENT_ID" \
    --vcn-id "$VCN_ID" \
    --display-name "alex-subnet" \
    --cidr-block "10.0.1.0/24" \
    --dns-label "alexsub" \
    --security-list-ids "[\"$SL_ID\"]" \
    --query "data.id" --raw-output \
    --wait-for-state AVAILABLE)
echo "    Subnet: $SUBNET_ID"

# ── Find ARM Image ──
echo "==> Finding Oracle Linux 8 ARM image..."
IMAGE_ID=$(oci compute image list \
    --compartment-id "$COMPARTMENT_ID" \
    --operating-system "Oracle Linux" \
    --operating-system-version "8" \
    --shape "VM.Standard.A1.Flex" \
    --sort-by TIMECREATED --sort-order DESC \
    --query "data[0].id" --raw-output)
echo "    Image: $IMAGE_ID"

# ── Read SSH Public Key ──
SSH_KEY_CONTENT=$(cat "$SSH_PUBLIC_KEY")

# ── Read Cloud-Init Script ──
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLOUD_INIT_PATH="${SCRIPT_DIR}/cloud-init.sh"

# ── Create Compute Instance ──
echo "==> Creating ARM A1 Flex instance (2 OCPU, 12GB RAM)..."
INSTANCE_ID=$(oci compute instance launch \
    --compartment-id "$COMPARTMENT_ID" \
    --availability-domain "$AD_NAME" \
    --display-name "alex-cloud" \
    --shape "VM.Standard.A1.Flex" \
    --shape-config '{"ocpus": 2, "memoryInGBs": 12}' \
    --image-id "$IMAGE_ID" \
    --subnet-id "$SUBNET_ID" \
    --assign-public-ip true \
    --ssh-authorized-keys-file "$SSH_PUBLIC_KEY" \
    --user-data-file "$CLOUD_INIT_PATH" \
    --query "data.id" --raw-output \
    --wait-for-state RUNNING)
echo "    Instance: $INSTANCE_ID"

# ── Get Public IP ──
echo "==> Fetching public IP..."
sleep 5
VNIC_ID=$(oci compute instance list-vnics \
    --instance-id "$INSTANCE_ID" \
    --query "data[0].id" --raw-output)
PUBLIC_IP=$(oci network vnic get \
    --vnic-id "$VNIC_ID" \
    --query "data.\"public-ip\"" --raw-output)

echo ""
echo "============================================"
echo "  ALEX Cloud Instance Ready"
echo "============================================"
echo "  Instance ID:  $INSTANCE_ID"
echo "  Public IP:    $PUBLIC_IP"
echo "  SSH:          ssh opc@$PUBLIC_IP"
echo "  Health:       curl http://$PUBLIC_IP:9090/api/health"
echo "============================================"
echo ""
echo "Export for deploy.sh:"
echo "  export OCI_HOST=$PUBLIC_IP"
echo ""

# Export for sourcing
export OCI_INSTANCE_ID="$INSTANCE_ID"
export OCI_HOST="$PUBLIC_IP"
