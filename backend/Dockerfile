# Use an official Python runtime as a parent image
FROM python:3.11-slim

# Set the working directory in the container
WORKDIR /app

# Avoid buffering stdout/stderr to see logs immediately
ENV PYTHONUNBUFFERED=1

# Copy the requirements file into the container at /app
COPY requirements.txt .

# Install any needed packages specified in requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Debug: List installed packages to verify dependencies
RUN pip list

# Copy the current directory contents into the container at /app
COPY . .

# Make port 8080 available to the world outside this container
EXPOSE 8080

# Run gunicorn when the container launches
# Using 8 workers to optimize for 4 CPU cores (2x workers per core is a common starting point)
# Timeout 0 is recommended for Cloud Run to let the platform handle timeouts
CMD gunicorn --workers 12 --worker-class uvicorn.workers.UvicornWorker --timeout 0 --bind 0.0.0.0:${PORT:-8080} main:app
