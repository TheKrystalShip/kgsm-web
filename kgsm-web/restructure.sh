#!/bin/bash

# KGSM Web UI Restructuring Script
# This script helps with the refactoring process

set -e

# Base directories
SRC_DIR="./src"
BACKUP_DIR="./src_backup"

# Create backup of current structure
echo "Creating backup of current src directory..."
if [ -d "$BACKUP_DIR" ]; then
  echo "Backup directory already exists. Using it might overwrite previous backup."
  read -p "Do you want to proceed? (y/n) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]
  then
    echo "Operation cancelled."
    exit 1
  fi
else
  mkdir -p "$BACKUP_DIR"
fi

# Copy all files to backup
cp -r "$SRC_DIR"/* "$BACKUP_DIR"

# Create new directory structure
echo "Creating new directory structure..."
mkdir -p "$SRC_DIR/api"
mkdir -p "$SRC_DIR/models"
mkdir -p "$SRC_DIR/utils"
mkdir -p "$SRC_DIR/pages"

# Move existing components, contexts, and hooks - they stay in the same place

echo "Refactoring completed. New structure is ready."
echo "Please make sure to commit your changes to version control."
