# ALEX — Oracle Cloud Deployment

Deploy ALEX to Oracle Cloud Always Free (ARM Ampere A1).

## Architecture

```
Pi 5 (build machine)                    Oracle Cloud (eu-london-1)
├── docker build alex:latest ──push──►  OCIR (Container Registry)
│                                           │
│                                       ARM Ampere A1 VM (2 OCPU, 12GB)
│                                       ├── docker pull alex:latest
│                                       ├── ALEX container (gateway.js)
│                                       ├── Redis container (sidecar)
│                                       └── Volume: ~/.alex/ data
```

## Prerequisites

1. Oracle Cloud Always Free account (eu-london-1)
2. OCI CLI installed and configured on Pi
3. Docker installed on Pi
4. Separate Telegram bot token for the cloud instance

## Quick Start

### 1. Install OCI CLI

```bash
bash -c "$(curl -L https://raw.githubusercontent.com/oracle/oci-cli/master/scripts/install/install.sh)"
oci setup config
# Upload the generated public key to OCI Console → Profile → API Keys
```

### 2. Provision Infrastructure

```bash
export OCI_COMPARTMENT_ID="ocid1.compartment.oc1..your-compartment-id"
./setup-infra.sh
```

This creates: VCN, subnet, security list, internet gateway, and ARM A1 compute instance.

### 3. Seed Data

```bash
# Copy ALEX configuration to the OCI instance
export OCI_HOST="<public-ip-from-setup>"
scp ~/.alex/config.json.enc opc@$OCI_HOST:~/alex-data/
scp ~/.alex/IDENTITY.md opc@$OCI_HOST:~/alex-data/
scp ~/.alex/USER.md opc@$OCI_HOST:~/alex-data/
scp ~/.alex/KNOWLEDGE.md opc@$OCI_HOST:~/alex-data/
scp -r ~/.alex/memory/ opc@$OCI_HOST:~/alex-data/
scp -r ~/.alex/skills/ opc@$OCI_HOST:~/alex-data/
scp -r ~/.alex/templates/ opc@$OCI_HOST:~/alex-data/
```

### 4. Deploy

```bash
# Set required environment variables
export OCI_NAMESPACE="your-tenancy-namespace"
export OCI_HOST="<public-ip>"
export ALEX_SECRET_KEY="your-encryption-key"

# Login to Oracle Container Registry
docker login eu-london-1.ocir.io -u "$OCI_NAMESPACE/oracleidentitycloudservice/<email>" -p '<auth_token>'

# Build, push, and deploy
./deploy.sh
```

### 5. Copy docker-compose.yml to OCI instance

```bash
scp docker-compose.yml opc@$OCI_HOST:~/alex-deploy/

# Create .env file on OCI instance
ssh opc@$OCI_HOST 'cat > ~/alex-deploy/.env' <<EOF
ALEX_SECRET_KEY=your-encryption-key
ALEX_IMAGE=eu-london-1.ocir.io/$OCI_NAMESPACE/alex:latest
EOF
```

## Scripts

| Script | Purpose |
|--------|---------|
| `setup-infra.sh` | Provision OCI networking + compute via CLI |
| `cloud-init.sh` | Instance bootstrap (Docker install, firewall) |
| `deploy.sh` | Build → push → deploy automation |
| `docker-compose.yml` | ALEX + Redis container stack |
| `crontab` | Container cron schedule for heartbeat tasks |

## deploy.sh Options

```bash
./deploy.sh                  # Full: build + push + deploy
./deploy.sh --build-only     # Build Docker image locally
./deploy.sh --push-only      # Push to OCIR only
./deploy.sh --deploy-only    # Pull + restart on OCI instance
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OCI_NAMESPACE` | Yes | Tenancy object storage namespace |
| `OCI_HOST` | Yes | Public IP of OCI compute instance |
| `ALEX_SECRET_KEY` | Yes | Encryption key for config.json.enc |
| `OCI_COMPARTMENT_ID` | For setup | Compartment OCID |
| `OCI_REGION` | No | Defaults to `eu-london-1` |
| `OCI_SSH_KEY` | No | SSH key path (default: `~/.ssh/id_rsa`) |
| `ALEX_TAG` | No | Docker image tag (default: `latest`) |

## Important Notes

- The cloud instance MUST use a **different Telegram bot token** from the Pi. Two instances sharing a token will cause message conflicts.
- The Pi's production ALEX (systemd service) is completely unaffected by Docker operations.
- Port 9090 must be open in both the OCI security list AND the instance firewall (handled by cloud-init.sh).
