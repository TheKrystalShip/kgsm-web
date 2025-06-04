#!/bin/bash

# KGSM Web setup script
# This script installs all dependencies for both frontend and backend

# Get the directory of the script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" &> /dev/null && pwd)"

echo "=== KGSM Web Admin Panel Setup ==="
echo "Installing dependencies..."

# Install backend dependencies
echo -e "\n=> Setting up backend server..."
cd "$SCRIPT_DIR/server"
npm install

# Install frontend dependencies
echo -e "\n=> Setting up frontend application..."
cd "$SCRIPT_DIR/kgsm-web"
npm install

echo -e "\n=== Setup completed successfully! ==="
echo "To start the development servers, run:"
echo "  ./dev.sh"
echo ""
