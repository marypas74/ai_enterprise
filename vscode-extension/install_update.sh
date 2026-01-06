#!/bin/bash
# ========================================
# Enterprise AI Chat - Extension Installer
# ========================================
# This script finds the latest .vsix file and installs it
#
# Usage: ./install_update.sh
# ========================================

set -e

echo ""
echo "========================================"
echo "  Enterprise AI Chat - Installer"
echo "========================================"
echo ""

# Change to script directory
cd "$(dirname "$0")"

# Find the latest .vsix file
LATEST_VSIX=$(ls -t enterprise-ai-chat-*.vsix 2>/dev/null | head -1)

if [ -z "$LATEST_VSIX" ]; then
    echo "[ERROR] No .vsix file found in current directory!"
    echo ""
    echo "Please run 'npm run package' first to create the extension package."
    exit 1
fi

echo "Found: $LATEST_VSIX"
echo ""
echo "Installing extension..."
echo ""

# Check if VS Code Remote is available
if command -v code &> /dev/null; then
    code --install-extension "$LATEST_VSIX" --force

    if [ $? -eq 0 ]; then
        echo ""
        echo "========================================"
        echo "  Installation successful!"
        echo "========================================"
        echo ""
        echo "Please reload VS Code:"
        echo "  Ctrl+Shift+P -> Developer: Reload Window"
        echo ""
    else
        echo ""
        echo "[WARNING] code command failed, trying manual installation..."

        # Manual installation to vscode-server extensions
        EXTENSION_DIR="$HOME/.vscode-server/extensions/enterprise-ai.enterprise-ai-chat-${LATEST_VSIX#enterprise-ai-chat-}"
        EXTENSION_DIR="${EXTENSION_DIR%.vsix}"

        echo "Installing to: $EXTENSION_DIR"
        rm -rf "$HOME/.vscode-server/extensions/enterprise-ai.enterprise-ai-chat-"*
        mkdir -p "$EXTENSION_DIR"

        # Extract vsix (it's a zip file)
        python3 -c "import zipfile; zipfile.ZipFile('$LATEST_VSIX').extractall('$EXTENSION_DIR')"
        mv "$EXTENSION_DIR/extension/"* "$EXTENSION_DIR/"
        rm -rf "$EXTENSION_DIR/extension" "$EXTENSION_DIR/[Content_Types].xml" "$EXTENSION_DIR/extension.vsixmanifest"

        echo ""
        echo "========================================"
        echo "  Manual installation complete!"
        echo "========================================"
        echo ""
    fi
else
    echo "[ERROR] VS Code CLI not found!"
    echo ""
    echo "Make sure you're connected via VS Code Remote SSH"
    exit 1
fi
