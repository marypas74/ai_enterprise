# Parlant AI Agent Framework
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Parlant and dependencies (with anthropic and openai support)
RUN pip install --no-cache-dir "parlant[anthropic,openai]" chromadb

# Create directories for data persistence
RUN mkdir -p /app/data /app/guidelines /app/agents

# Copy server script
COPY server.py /app/server.py

# Expose Parlant server port
EXPOSE 8800

# Set environment variables
ENV PARLANT_DATA_DIR=/app/data
ENV PARLANT_HOST=0.0.0.0
ENV PARLANT_PORT=8800
ENV PYTHONUNBUFFERED=1

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8800/ || exit 1

# Run Parlant server using CLI
CMD ["python", "-m", "parlant.bin.server", "run", "--anthropic", "--port", "8800", "--migrate", "--log-level", "info"]
