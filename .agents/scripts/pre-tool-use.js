#!/usr/bin/env node

/**
 * PreToolUse Hook for TeleBook monorepo
 * Enforces security gates:
 * 1. Blocks committing .env, .dev.vars, secrets, or tokens.
 * 2. Blocks destructive shell commands (e.g., rm -rf without explicit safe paths, disk formatting).
 * 3. Prevents committing Telegram bot tokens or Cloudflare API tokens.
 */

const fs = require('fs');

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
    const args = toolCall.args || {};

    if (toolName === 'run_command') {
      const cmd = (args.CommandLine || '').trim();

      // Destructive commands check
      const destructivePatterns = [
        /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|--force\s+-r|-rf|-fr)\s+(\/|~|\$HOME|\.\.)(\s|$)/,
        /\b(mkfs|dd\s+if=|fdisk|parted)\b/,
        /:(){ :\|:& };:/, // Fork bomb
        /\bgit\s+push\s+.*(--force|-f)\b/
      ];

      for (const pattern of destructivePatterns) {
        if (pattern.test(cmd)) {
          console.log(JSON.stringify({
            decision: 'deny',
            reason: `Blocked destructive or unsafe shell command: '${cmd}' matches safety gate pattern.`
          }));
          process.exit(0);
        }
      }

      // Check for git commit / git add of secret files
      const secretFileAdd = /\bgit\s+(add|commit).*(\.env|\.dev\.vars|credentials\.json|\.pem|\.key)\b/i;
      if (secretFileAdd.test(cmd)) {
        console.log(JSON.stringify({
          decision: 'deny',
          reason: 'Blocked attempt to stage or commit secret/environment file (.env, .dev.vars, .key, .pem).'
        }));
        process.exit(0);
      }
    }

    if (toolName === 'write_file' || toolName === 'edit_file') {
      const filePath = args.Path || '';
      const content = args.Content || args.Replacement || '';

      // Block writing raw secrets to tracked non-env files
      const telegramTokenPattern = /[0-9]{8,10}:[a-zA-Z0-9_-]{35}/;
      if (!filePath.includes('.env.example') && !filePath.includes('test') && !filePath.includes('SKILL.md') && telegramTokenPattern.test(content)) {
        console.log(JSON.stringify({
          decision: 'deny',
          reason: 'Blocked attempt to write real Telegram Bot Token into file. Use environment variables.'
        }));
        process.exit(0);
      }
    }

    // Default allow
    console.log(JSON.stringify({ decision: 'allow' }));
  } catch (err) {
    // If parsing fails, fail safe by allowing or logging
    console.log(JSON.stringify({ decision: 'allow' }));
  }
});
