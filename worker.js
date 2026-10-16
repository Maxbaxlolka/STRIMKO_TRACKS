
async function verifyAdmin(request, env) {
  const match = /^Bearer\s+(.+)$/i.exec(
    request.headers.get('authorization') || ''
  );

  if (!match) {
    throw new HttpError(401, 'Нужно войти в аккаунт администратора.');
  }

  const key = String(env.FIREBASE_API_KEY || '').trim();

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idToken: match[1] })
    }
  );

  const data = await response.json();
  const account = data.users && data.users[0];

  if (!response.ok || !account) {
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(key)
    );

    const keyFingerprint = Array.from(new Uint8Array(digest))
      .slice(0, 6)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    throw new HttpError(
      401,
      `Firebase lookup failed: HTTP ${response.status}; ${data.error?.message || 'user not found'}; keyLength=${key.length}; keyFingerprint=${keyFingerprint}`
    );
  }

  const allowedEmail = String(env.ADMIN_EMAIL || '').trim().toLowerCase();

  if (
    !allowedEmail ||
    String(account.email || '').toLowerCase() !== allowedEmail ||
    account.emailVerified !== true
  ) {
    throw new HttpError(
      403,
      'Нет прав администратора. Проверь ADMIN_EMAIL в Cloudflare и подтверждение почты.'
    );
  }

  return account;
}
