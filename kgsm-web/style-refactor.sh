#!/bin/bash

# KGSM Web UI CSS Refactor Script
# Script to help with refactoring CSS files

set -e

# Base directories
SRC_DIR="./kgsm-web/src"
STYLES_DIR="$SRC_DIR/styles"
BACKUP_DIR="./kgsm-web/src/css_backup"

# Display message
echo "============================================"
echo "KGSM Web UI CSS Refactor Script"
echo "============================================"
echo ""

# Create backup of current CSS files
echo "Creating backup of current CSS files..."
if [ -d "$BACKUP_DIR" ]; then
  echo "Backup directory already exists. Using it might overwrite previous backup."
  read -p "Do you want to proceed? (y/n) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Operation cancelled."
    exit 1
  fi
else
  mkdir -p "$BACKUP_DIR"
fi

# Find and copy all CSS files to backup
find "$SRC_DIR" -name "*.css" -exec cp --parents {} "$BACKUP_DIR" \;
echo "Backup created in $BACKUP_DIR"

# Check that our new styles directory exists
if [ ! -d "$STYLES_DIR" ]; then
  echo "Error: New styles directory doesn't exist. Run the setup first."
  exit 1
fi

echo "CSS Refactor completed! The new CSS structure is:"
echo ""
find "$STYLES_DIR" -type f -name "*.css" | sort

echo ""
echo "To apply changes to components, update their CSS imports to use the new style files."
echo "For example:"
echo "  - Instead of importing './Button.css', import component styles from the main CSS"
echo "  - Individual components don't need to import CSS files directly anymore"
echo ""
echo "Done!"
