#!/bin/bash

# 🚀 AlgoTrade Backend Startup Script
# =====================================

echo "🔧 Starting AlgoTrade Backend..."
echo ""

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "❌ .env file not found!"
    echo "📝 Please copy .env.example to .env and configure your API keys:"
    echo "   cp .env.example .env"
    echo "   Then edit .env with your Alpaca and Groq API keys"
    echo ""
    exit 1
fi

# Kill any existing backend process
echo "🔄 Stopping any existing backend..."
pkill -f "node.*server.js" 2>/dev/null

# Navigate to backend directory
cd backend

# Start the backend
echo "🚀 Starting backend on port 3002..."
echo "📡 Backend will be available at: http://localhost:3002"
echo "🔌 WebSocket will be available at: ws://localhost:3002"
echo ""
echo "✅ Backend is starting..."
echo "💡 Use Ctrl+C to stop the server"
echo ""

# Start the server
PORT=3002 npm start
