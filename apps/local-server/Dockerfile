# TeleBook Local Server Dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install CLI and server packages
COPY packages/cli /app/packages/cli
COPY apps/local-server /app/apps/local-server

RUN pip install --no-cache-dir -e /app/packages/cli
RUN pip install --no-cache-dir -e /app/apps/local-server

# Create data directories
RUN mkdir -p /app/data/chunks /app/notebooks

ENV HOST=0.0.0.0
ENV PORT=8000
ENV DB_PATH=/app/data/telebook.db
ENV STORAGE_DIR=/app/data/chunks

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8000/health || exit 1

CMD ["telebook-server"]
