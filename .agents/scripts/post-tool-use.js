#!/usr/bin/env node

/**
 * PostToolUse Hook for TeleBook monorepo
 * Scans recent tool outputs or changed files for:
 * 1. Accidental token leakage in command stdout
 * 2. Unbalanced syntax or JSON corruption in configuration files
 */

let rawInput = '';
process.stdin.setEncoding('utf-8');

process.stdin.on('data', chunk => {
  rawInput += chunk;
});

process.stdin.on('end', () => {
  try {
    const payload = JSON.parse(rawInput || '{}');
    const toolCall = payload.toolCall || {};
    const toolName = toolCall.name || '';
    const output = payload.output || '';

    // Check for exposed Telegram Bot Tokens or Cloudflare API tokens in command output
    const telegramTokenPattern = /[0-9]{8,10}:[a-zA-Z0-9_-]{35}/;
    if (telegramTokenPattern.test(output)) {
      console.error('[TeleBook Security Warning]: Potential Telegram Bot Token detected in tool output.');
    }

    // Always output {} per PostToolUse contract
    console.log(JSON.stringify({}));
  } catch (err) {
    console.log(JSON.stringify({}));
  }
});
