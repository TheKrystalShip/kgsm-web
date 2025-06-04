#!/bin/bash

# KGSM Web development startup script
# This script starts both the frontend and backend servers

# Trap to ensure both servers are killed when the script exits
trap 'kill $(jobs -p)' EXIT INT TERM

# Start the backend server
echo "Starting backend server..."
cd "$(dirname "$0")/server"
npm run dev &

# Wait a moment for the backend to initialize
sleep 2

# Start the frontend server
echo "Starting frontend server..."
cd "../kgsm-web"
npm start &

# Wait for any process to exit
wait

echo "Development servers stopped."
