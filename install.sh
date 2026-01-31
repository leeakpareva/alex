#!/bin/bash
#
# ALEX - Global Economist at NAVADA - Installer
#

set -e

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║                                                            ║"
echo "║            ALEX - Global Economist at NAVADA            ║"
echo "║                        Installer                           ║"
echo "║                                                            ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Check for Node.js
echo "Checking prerequisites..."

if ! command -v node &> /dev/null; then
    echo "Node.js not found. Installing..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs
else
    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 22 ]; then
        echo "Node.js version $NODE_VERSION found, but v22+ is required."
        echo "Upgrading Node.js..."
        curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
        sudo apt-get install -y nodejs
    else
        echo "Node.js $(node -v) found"
    fi
fi

# Install directory
INSTALL_DIR="$HOME/navada-1"
WORKSPACE_DIR="$HOME/.alex"

echo ""
echo "Installing to: $INSTALL_DIR"
echo ""

# Clone or update
if [ -d "$INSTALL_DIR" ]; then
    echo "Updating existing installation..."
    cd "$INSTALL_DIR"
    git pull 2>/dev/null || true
else
    echo "Creating installation directory..."
    mkdir -p "$INSTALL_DIR"
fi

# If running from local files (not git)
if [ ! -f "$INSTALL_DIR/package.json" ]; then
    echo "Setting up ALEX files..."

    # Create package.json
    cat > "$INSTALL_DIR/package.json" << 'PACKAGE_EOF'
{
  "name": "alex",
  "version": "1.0.0",
  "description": "ALEX - Global Economist at NAVADA",
  "main": "src/gateway.js",
  "type": "module",
  "bin": {
    "alex": "./bin/navada.js",
    "alex-setup": "./bin/setup.js"
  },
  "scripts": {
    "start": "node src/gateway.js",
    "setup": "node bin/setup.js"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0",
    "node-telegram-bot-api": "^0.66.0",
    "node-cron": "^3.0.3",
    "nodemailer": "^6.9.0"
  },
  "engines": {
    "node": ">=22.0.0"
  }
}
PACKAGE_EOF
fi

# Install dependencies
echo ""
echo "Installing dependencies..."
cd "$INSTALL_DIR"
npm install

# Create symlinks
echo ""
echo "Creating command links..."
sudo npm link 2>/dev/null || true

# Create workspace
echo ""
echo "Setting up workspace..."
mkdir -p "$WORKSPACE_DIR"/{memory,conversations,skills,scripts,tasks,reports,research,data,logs}

# Set permissions
chmod 700 "$WORKSPACE_DIR"

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║            Installation Complete!                          ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "Next steps:"
echo ""
echo "  1. Run the setup wizard:"
echo "     cd $INSTALL_DIR && npm run setup"
echo ""
echo "  2. Or if alex-setup is in PATH:"
echo "     alex-setup"
echo ""
echo "You will need:"
echo "  - Anthropic API key (console.anthropic.com)"
echo "  - Telegram bot token (@BotFather)"
echo "  - Gmail App Password (for sending emails)"
echo ""
