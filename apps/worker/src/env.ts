// TeleBook Worker Environment Bindings

export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  OWNER_TELEGRAM_ID: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  JWT_SECRET: string;
  APP_URL?: string;
  BOT_USERNAME?: string;
}

export function validateEnv(env: Env): { valid: boolean; missing: string[] } {
  const required: (keyof Env)[] = [
    'DB',
    'TELEGRAM_BOT_TOKEN',
    'OWNER_TELEGRAM_ID',
    'TELEGRAM_WEBHOOK_SECRET',
    'JWT_SECRET'
  ];

  const missing: string[] = [];
  for (const key of required) {
    if (!env[key]) {
      missing.push(key);
    }
  }

  return {
    valid: missing.length === 0,
    missing
  };
}
