# TeleBook Self-Hosting Guide

## Deployment Targets

TeleBook supports two deployment topologies:
1. Cloudflare Workers with Cloudflare D1 (Serverless, $0/month).
2. Local Docker container with SQLite (Self-hosted on private hardware).

### Option 1: Cloudflare Deployment

1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure credentials in `apps/worker/.dev.vars`:
   - `TELEGRAM_BOT_TOKEN`
   - `OWNER_TELEGRAM_ID`
   - `TELEGRAM_WEBHOOK_SECRET`
   - `JWT_SECRET`
3. Execute database migration:
   ```bash
   npx wrangler d1 execute telebook-db --file=apps/worker/migrations/0001_initial.sql
   ```
4. Deploy worker:
   ```bash
   npx wrangler deploy
   ```

### Option 2: Docker Companion

1. Navigate to `apps/local-server`:
   ```bash
   cd apps/local-server
   ```
2. Copy environment file and configure tokens:
   ```bash
   cp .env.example .env
   ```
3. Start container:
   ```bash
   docker compose up -d
   ```
4. Access web API at `http://localhost:8000`.
