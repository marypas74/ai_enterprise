#!/bin/bash
#
# Setup Shared Storage for Enterprise AI Chat
# This script configures a directory that is accessible from both Windows and Linux
# via Samba (SMB/CIFS) protocol.
#
# Usage: sudo ./setup-shared-storage.sh [partition_path]
#        Default partition_path: /data/shared-projects
#

set -e

# Configuration
SHARE_PATH="${1:-/data/shared-projects}"
SHARE_NAME="projects"
SAMBA_USER="ai-chat"
SAMBA_GROUP="ai-chat"

echo "==========================================="
echo " Enterprise AI Chat - Shared Storage Setup"
echo "==========================================="
echo ""
echo "Share Path: $SHARE_PATH"
echo "Share Name: $SHARE_NAME (access via \\\\server\\$SHARE_NAME)"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "Error: Please run as root (sudo)"
    exit 1
fi

# Install Samba if not present
echo "[1/6] Installing Samba..."
if ! command -v smbd &> /dev/null; then
    apt-get update
    apt-get install -y samba samba-common-bin
else
    echo "      Samba already installed"
fi

# Create the shared directory
echo "[2/6] Creating shared directory..."
mkdir -p "$SHARE_PATH"

# Create dedicated user/group for Samba
echo "[3/6] Creating Samba user..."
if ! getent group "$SAMBA_GROUP" > /dev/null; then
    groupadd "$SAMBA_GROUP"
fi

if ! id "$SAMBA_USER" &>/dev/null; then
    useradd -M -s /usr/sbin/nologin -g "$SAMBA_GROUP" "$SAMBA_USER"
fi

# Set ownership and permissions
echo "[4/6] Setting permissions..."
chown -R "$SAMBA_USER:$SAMBA_GROUP" "$SHARE_PATH"
chmod -R 2775 "$SHARE_PATH"  # SetGID ensures new files inherit group

# Also add www-data (used by containers) to the group
usermod -aG "$SAMBA_GROUP" www-data 2>/dev/null || true

# Backup existing smb.conf
if [ -f /etc/samba/smb.conf ]; then
    cp /etc/samba/smb.conf /etc/samba/smb.conf.backup.$(date +%Y%m%d_%H%M%S)
fi

# Configure Samba share
echo "[5/6] Configuring Samba share..."
cat >> /etc/samba/smb.conf << EOF

# Enterprise AI Chat - Shared Projects
[$SHARE_NAME]
   path = $SHARE_PATH
   comment = Enterprise AI Chat Projects
   browseable = yes
   read only = no
   guest ok = no
   valid users = @$SAMBA_GROUP
   create mask = 0664
   directory mask = 2775
   force group = $SAMBA_GROUP
   # Enable Windows ACL compatibility
   vfs objects = acl_xattr
   map acl inherit = yes
   store dos attributes = yes

EOF

# Test Samba configuration
echo "      Testing Samba configuration..."
testparm -s /etc/samba/smb.conf > /dev/null 2>&1 || {
    echo "Error: Samba configuration is invalid"
    exit 1
}

# Restart Samba services
echo "[6/6] Restarting Samba services..."
systemctl restart smbd nmbd
systemctl enable smbd nmbd

# Print success message
echo ""
echo "==========================================="
echo " Setup Complete!"
echo "==========================================="
echo ""
echo "Shared directory created at: $SHARE_PATH"
echo ""
echo "To access from Windows:"
echo "  1. Open File Explorer"
echo "  2. Enter: \\\\$(hostname -I | awk '{print $1}')\\$SHARE_NAME"
echo "  3. Use credentials configured below"
echo ""
echo "To access from Linux:"
echo "  1. Install cifs-utils: sudo apt install cifs-utils"
echo "  2. Mount: sudo mount -t cifs //$(hostname -I | awk '{print $1}')/$SHARE_NAME /mnt/projects -o username=$SAMBA_USER"
echo ""
echo "==========================================="
echo " IMPORTANT: Set Samba password for user"
echo "==========================================="
echo ""
echo "Run: sudo smbpasswd -a $SAMBA_USER"
echo ""
echo "You can also add your existing users to the share:"
echo "  sudo usermod -aG $SAMBA_GROUP your_username"
echo "  sudo smbpasswd -a your_username"
echo ""
