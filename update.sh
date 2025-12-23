#!/bin/bash

echo "📦 Stashing local changes..."
git stash

echo "⬇️  Pulling latest changes..."
git pull origin claude/medium-design-upgrades-ETmQX

echo "📂 Restoring your albums..."
git stash pop 2>/dev/null || true

echo "🔤 Sorting and redistributing albums..."
node sort-albums.js

echo "✅ Update complete! Restart your server with: node server.js"
