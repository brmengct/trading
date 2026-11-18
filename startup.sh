#!/bin/bash

# 1. Create virtual environment if it doesn't already exist
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

# 2. Activate the virtual environment
echo "Activating virtual environment..."
source venv/bin/activate

# 3. Install/update requirements
echo "Installing dependencies..."
pip install -r requirements.txt

# 4. Launch the FastAPI server
echo "Starting Uvicorn server..."
uvicorn interestingstock:app --reload --port 8000