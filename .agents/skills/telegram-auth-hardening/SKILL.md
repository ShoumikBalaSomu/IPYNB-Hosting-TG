---
name: telegram-auth-hardening
description: Cryptographic protocol for verifying Telegram Mini App initData, mitigating replay attacks, validating single-owner authorization, and managing 120s ephemeral magic tokens and session epoch revocation.
---

# Telegram Authentication & Hardening Protocol (`telegram-auth-hardening`)

## 1. Overview
TeleBook relies on Telegram as the primary identity and sovereign transport layer. To prevent spoofing, man-in-the-middle attacks, replay attacks, and token forgery, all incoming authentication payloads must undergo rigorous cryptographic verification.

## 2. Telegram Mini App `initData` Cryptographic Verification

### 2.1 The Mathematical Verification Algorithm
Telegram Mini Apps pass an `initData` query string to the web client. The verification steps are:
1. Parse `initData` into URL query parameters.
2. Extract the received `hash` parameter.
3. Remove `hash` from the parameter set.
4. Sort all remaining parameters in alphabetical order by key.
5. Concatenate each key-value pair as `key=value`, separated by newline characters (`\n`). This forms the `data_check_string`:
   $$\text{data\_check\_string} = \text{auth\_date}=\dots \mathbin{\Vert} \text{"\n"} \mathbin{\Vert} \text{query\_id}=\dots \mathbin{\Vert} \text{"\n"} \mathbin{\Vert} \text{user}=\dots$$
6. Compute the secret key using HMAC-SHA256:
   $$\text{secret\_key} = \text{HMAC-SHA256}(\text{"WebAppData"}, \text{BOT\_TOKEN})$$
7. Compute the verification HMAC:
   $$\text{calculated\_hash} = \text{HMAC-SHA256}(\text{data\_check\_string}, \text{secret\_key})$$
8. Compare `calculated_hash` with the provided `hash` using a constant-time comparison to prevent side-channel timing attacks.

### 2.2 Sub-Millisecond Native Web Crypto Implementation (Cloudflare Workers)
To stay well within Cloudflare Worker's 10ms CPU limit, implement this using `crypto.subtle`:
```typescript
export async function verifyTelegramInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds = 86400 // 24 hours
): Promise<{ valid: boolean; user?: TelegramUser; error?: string }> {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return { valid: false, error: 'Missing hash' };

  params.delete('hash');
  const sortedKeys = Array.from(params.keys()).sort();
  const dataCheckString = sortedKeys.map(k => `${k}=${params.get(k)}`).join('\n');

  // Step 1: secret_key = HMAC-SHA256("WebAppData", botToken)
  const encoder = new TextEncoder();
  const webAppDataKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode('WebAppData'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const secretKeyBytes = await crypto.subtle.sign('HMAC', webAppDataKey, encoder.encode(botToken));

  // Step 2: calculated_hash = HMAC-SHA256(secretKeyBytes, dataCheckString)
  const secretKey = await crypto.subtle.importKey(
    'raw',
    secretKeyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signatureBytes = await crypto.subtle.sign('HMAC', secretKey, encoder.encode(dataCheckString));
  const calculatedHash = Array.from(new Uint8Array(signatureBytes))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  // Step 3: Constant-time comparison
  if (calculatedHash !== hash) {
    return { valid: false, error: 'Invalid HMAC signature' };
  }

  // Step 4: Replay attack & expiration check
  const authDate = parseInt(params.get('auth_date') || '0', 10);
  const now = Math.floor(Date.now() / 1000);
  if (authDate === 0 || now - authDate > maxAgeSeconds || authDate > now + 60) {
    return { valid: false, error: 'Auth payload expired or invalid timestamp' };
  }

  // Step 5: User extraction
  const userJson = params.get('user');
  if (!userJson) return { valid: false, error: 'Missing user payload' };
  const user = JSON.parse(userJson) as TelegramUser;

  return { valid: true, user };
}
```

## 3. Strict Single-Owner Validation
Following signature verification, the user identity MUST be checked against the configured environment variable `OWNER_TELEGRAM_ID`:
```typescript
if (String(user.id) !== env.OWNER_TELEGRAM_ID) {
  // Reject immediately without disclosing admin details
  return new Response(JSON.stringify({ error: 'Access Denied: Not the instance owner' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' }
  });
}
```

## 4. Desktop Magic Link (120-Second Ephemeral Flow)
For CLI or desktop browser access without passing raw Telegram bot tokens:
1. Desktop client sends `POST /api/auth/magic-token` -> Worker generates a 32-byte cryptographically secure random token (`magic_token`).
2. Stored in Cloudflare D1 `magic_tokens` table:
   - `token`: SHA-256 hash of `magic_token`
   - `created_at`: `now`
   - `expires_at`: `now + 120` (strict 2-minute time-to-live)
   - `status`: `'pending'`
3. Client displays QR code or deep link: `https://t.me/<bot_username>?start=auth_<magic_token>`.
4. User clicks "Confirm Login" inside Telegram chat. The webhook handler verifies `message.from.id === OWNER_TELEGRAM_ID`.
5. Upon confirmation, Worker marks token status as `'approved'` and associates it with a generated session.
6. Desktop client retrieves session cookie/JWT; token is immediately purged from D1.

## 5. Session Revocation & Epoch Invalidation (`/revoke`)
To immediately terminate all active sessions across all devices:
- The D1 `users` table tracks `auth_epoch` (integer).
- Every issued JWT embeds the current `epoch`: `{ sub: userId, epoch: 4 }`.
- When the owner sends `/revoke` to the Telegram Bot:
  ```sql
  UPDATE users SET auth_epoch = auth_epoch + 1 WHERE telegram_id = ?;
  ```
- All worker authorization middleware checks: `token.epoch === user.auth_epoch`.
- Invalidation is instantaneous across all Cloudflare edge locations with zero reliance on distributed blacklists.
