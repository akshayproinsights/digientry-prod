# backend/Dockerfile
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Copy requirements and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application code
COPY . .

# CRITICAL: Cloud Run needs this variable to know which port to check
ENV PORT=8080

# Run the app binding to 0.0.0.0 (External access) on Port 8080
CMD exec uvicorn main:app --host 0.0.0.0 --port $PORT