const DEFAULT_SETTINGS = { requiredMinutes: 60, maxPending: 1, requestsEnabled: true, volume: 80 };
const ALLOWED_ORIGIN = '*';
let cachedAccessToken = null;
let cachedAccessTokenUntil = 0;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders({ 'content-type': 'application/json; charset=utf-8' }) });
}
function corsHeaders(extra = {}) {
  return { 'access-control-allow-origin': ALLOWED_ORIGIN, 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'Content-Type, Authorization', 'access-control-max-age': '86400', ...extra };
}
function cleanName(v) { return String(v || 'Зритель').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 24) || 'Зритель'; }
function cleanTitle(v) { return String(v || '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 100); }
function validVideoId(v) { return typeof v === 'string' && /^[A-Za-z0-9_-]{11}$/.test(v); }
function normalizeViewerId(v) { return typeof v === 'string' && /^SK-[A-F0-9]{24}$/.test(v.trim().toUpperCase()) ? v.trim().toUpperCase() : null; }
function encodePath(path) { return path.split('/').map(encodeURIComponent).join('/'); }
function b64url(bytesOrString) {
  const bytes = typeof bytesOrString === 'string' ? new TextEncoder().encode(bytesOrString) : bytesOrString;
  let binary = ''; for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function pemToArrayBuffer(pem) {
  const base64 = pem.replace(/-----BEGIN PRIVATE KEY-----/g, '').replace(/-----END PRIVATE KEY-----/g, '').replace(/\s/g, '');
  const binary = atob(base64); const bytes = new Uint8Array(binary.length); for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i); return bytes.buffer;
}
async function accessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedAccessToken && cachedAccessTokenUntil > now + 60) return cachedAccessToken;
  if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) throw new Error('Не настроен секрет FIREBASE_SERVICE_ACCOUNT_JSON в Cloudflare.');
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const unsigned = `${header}.${claim}`;
  const key = await crypto.subtle.importKey('pkcs8', pemToArrayBuffer(sa.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const assertion = `${unsigned}.${b64url(new Uint8Array(signature))}`;
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error(`Не удалось получить токен Google: ${data.error_description || data.error || response.status}`);
  cachedAccessToken = data.access_token; cachedAccessTokenUntil = now + Number(data.expires_in || 3600); return cachedAccessToken;
}
async function dbRequest(env, path, method = 'GET', body, extraHeaders = {}) {
  const token = await accessToken(env);
  const base = String(env.FIREBASE_DATABASE_URL || '').replace(/\/$/, '');
  if (!base) throw new Error('Не настроен секрет FIREBASE_DATABASE_URL.');
  const url = `${base}/${encodePath(path)}.json?access_token=${encodeURIComponent(token)}`;
  const headers = { 'content-type': 'application/json', ...extraHeaders };
  const response = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text(); let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) throw new Error(`Firebase Database ${response.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  return { data, headers: response.headers };
}
async function getDb(env, path) { return (await dbRequest(env, path)).data; }
async function putDb(env, path, value) { return (await dbRequest(env, path, 'PUT', value)).data; }
async function patchDb(env, path, value) { return (await dbRequest(env, path, 'PATCH', value)).data; }
async function removeDb(env, path) { return (await dbRequest(env, path, 'DELETE')).data; }
async function mutateDb(env, path, mutator, attempts = 5) {
  for (let i = 0; i < attempts; i++) {
    const token = await accessToken(env), base = String(env.FIREBASE_DATABASE_URL || '').replace(/\/$/, '');
    const url = `${base}/${encodePath(path)}.json?access_token=${encodeURIComponent(token)}`;
    const read = await fetch(url, { headers: { 'x-firebase-etag': 'true' } });
    const oldText = await read.text(); let old = null; try { old = oldText ? JSON.parse(oldText) : null; } catch {}
    if (!read.ok) throw new Error(`Firebase read ${read.status}: ${oldText}`);
    const next = mutator(old);
    if (next === undefined) return { committed: false, value: old };
    const etag = read.headers.get('etag');
    const write = await fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json', 'if-match': etag || 'null_etag' }, body: JSON.stringify(next) });
    const text = await write.text(); if (write.status === 412) continue;
    if (!write.ok) throw new Error(`Firebase write ${write.status}: ${text}`);
    let value = next; try { value = text ? JSON.parse(text) : next; } catch {}
    return { committed: true, value };
  }
  throw new Error('Не удалось сохранить изменение из-за одновременных запросов. Попробуй ещё раз.');
}
async function settings(env) { return { ...DEFAULT_SETTINGS, ...(await getDb(env, 'tracks/publicSettings') || {}) }; }
async function lookupViewer(env, viewerId) {
  const uid = await getDb(env, `tracks/viewerIds/${viewerId}`);
  if (typeof uid !== 'string' || !uid) throw new HttpError(404, 'ID не найден. Сначала открой STRIMKO и получи ID.');
  return uid;
}
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
async function verifyAdmin(request, env) {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') || '');
  if (!match) throw new HttpError(401, 'Нужно войти в аккаунт администратора.');
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_API_KEY || '')}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken: match[1] }) });
  const data = await response.json();
  const account = data.users && data.users[0];
  if (!response.ok || !account) throw new HttpError(401, 'Сессия администратора недействительна. Войди снова.');
  const allowedEmail = String(env.ADMIN_EMAIL || '').trim().toLowerCase();
  if (!allowedEmail || String(account.email || '').toLowerCase() !== allowedEmail || account.emailVerified !== true) throw new HttpError(403, 'Нет прав администратора. Проверь ADMIN_EMAIL в Cloudflare и подтверждение почты.');
  return account;
}
function sortQueue(a, b) {
  const at = Number(a.createdAt || 0), bt = Number(b.createdAt || 0);
  if (at !== bt) return at - bt;
  const as = Number(a.sequence || 0), bs = Number(b.sequence || 0);
  if (as !== bs) return as - bs;
  return String(a.id).localeCompare(String(b.id));
}
async function allQueue(env) {
  const raw = await getDb(env, 'tracks/queue') || {};
  return Object.entries(raw).map(([id, value]) => ({ id, ...(value || {}) })).sort(sortQueue);
}
async function nextSequence(env) {
  const result = await mutateDb(env, 'tracks/meta/queueSequence', old => Number(old || 0) + 1);
  return Number(result.value || 1);
}
async function clearOwnerOrder(env, order) {
  const ownerUid = order.ownerUid || await getDb(env, `tracks/orderOwners/${order.id}`);
  if (ownerUid) await removeDb(env, `tracks/userOrders/${ownerUid}/${order.id}`);
}
async function advanceQueue(env, finishedOrderId = null, finalStatus = 'done') {
  const active = await getDb(env, 'tracks/active');
  if (active && (!finishedOrderId || active.orderId === finishedOrderId)) {
    const old = await getDb(env, `tracks/queue/${active.orderId}`) || {};
    await patchDb(env, `tracks/queue/${active.orderId}`, { status: finalStatus, finishedAt: Date.now() });
    await clearOwnerOrder(env, { id: active.orderId, ...old });
    await removeDb(env, 'tracks/active');
  }
  const queue = await allQueue(env);
  const next = queue.find(x => x.status === 'pending');
  if (!next) return null;
  await patchDb(env, `tracks/queue/${next.id}`, { status: 'playing', startedAt: Date.now() });
  const activeValue = { orderId: next.id, videoId: next.videoId, title: next.title, displayName: next.displayName, ownerUid: next.ownerUid || await getDb(env, `tracks/orderOwners/${next.id}`) || null, startedAt: Date.now() };
  await putDb(env, 'tracks/active', activeValue);
  return activeValue;
}
async function getProgress(env, body) {
  const viewerId = normalizeViewerId(body.viewerId);
  if (!viewerId) throw new HttpError(400, 'Неверный формат. Скопируй ID с основного сайта STRIMKO.');
  const uid = await lookupViewer(env, viewerId);
  const [user, s] = await Promise.all([getDb(env, `tracks/users/${uid}`), settings(env)]);
  if (!user) throw new HttpError(404, 'Профиль ID не найден. Сначала открой основной сайт STRIMKO.');
  return { ok: true, watchSeconds: Number(user.watchSeconds || 0), requiredMinutes: Math.max(1, Number(s.requiredMinutes) || 60), requestsEnabled: s.requestsEnabled !== false, maxPending: Math.max(1, Number(s.maxPending) || 1) };
}
async function createOrder(env, body) {
  const viewerId = normalizeViewerId(body.viewerId), videoId = body.videoId;
  if (!viewerId) throw new HttpError(400, 'Введи корректный ID STRIMKO.');
  if (!validVideoId(videoId)) throw new HttpError(400, 'Некорректная ссылка YouTube.');
  const uid = await lookupViewer(env, viewerId), s = await settings(env);
  if (s.requestsEnabled === false) throw new HttpError(403, 'Заказы сейчас выключены.');
  const requiredSeconds = Math.max(1, Number(s.requiredMinutes) || 60) * 60;
  let user = null;
  const lock = await mutateDb(env, `tracks/users/${uid}`, old => {
    if (!old) return undefined;
    const now = Date.now();
    if (Number(old.watchSeconds || 0) < requiredSeconds) return undefined;
    if (Number(old.orderLockAt || 0) > now - 20000) return undefined;
    return { ...old, orderLockAt: now };
  });
  if (!lock.committed) {
    const fresh = await getDb(env, `tracks/users/${uid}`) || {};
    if (Number(fresh.watchSeconds || 0) < requiredSeconds) throw new HttpError(409, `Нужно посмотреть ещё ${Math.max(1, Math.ceil((requiredSeconds - Number(fresh.watchSeconds || 0)) / 60))} минут.`);
    throw new HttpError(409, 'Заказ уже обрабатывается. Попробуй ещё раз через несколько секунд.');
  }
  user = lock.value;
  let createdOrderId = null;
  try {
    const userOrders = await getDb(env, `tracks/userOrders/${uid}`) || {};
    const all = await getDb(env, 'tracks/queue') || {};
    let activeCount = 0;
    for (const id of Object.keys(userOrders)) if (['pending', 'playing'].includes(all[id]?.status)) activeCount++;
    const max = Math.max(1, Math.min(10, Number(s.maxPending) || 1));
    if (activeCount >= max) throw new HttpError(409, `Достигнут лимит: максимум ${max} активных трек(ов) на одного зрителя.`);
    const sequence = await nextSequence(env), now = Date.now();
    const orderId = `st${now.toString(36)}${sequence.toString(36)}${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
    const order = { displayName: cleanName(body.displayName), title: cleanTitle(body.title) || `YouTube · ${videoId}`, videoId, status: 'pending', createdAt: now, sequence, ownerUid: uid };
    createdOrderId = orderId;
    await putDb(env, `tracks/queue/${orderId}`, order);
    await putDb(env, `tracks/orderOwners/${orderId}`, uid);
    await putDb(env, `tracks/userOrders/${uid}/${orderId}`, true);
    await patchDb(env, `tracks/users/${uid}`, { watchSeconds: 0, lastOrderAt: now, orderLockAt: 0, updatedAt: now });
    return { ok: true, orderNumber: orderId, message: 'Заказ добавлен в конец очереди. Прогресс сброшен.' };
  } catch (e) {
    if (createdOrderId) {
      await removeDb(env, `tracks/queue/${createdOrderId}`).catch(() => {});
      await removeDb(env, `tracks/orderOwners/${createdOrderId}`).catch(() => {});
      await removeDb(env, `tracks/userOrders/${uid}/${createdOrderId}`).catch(() => {});
    }
    await patchDb(env, `tracks/users/${uid}`, { orderLockAt: 0 }).catch(() => {});
    throw e;
  }
}
async function saveSettings(env, body) {
  const old = await settings(env);
  const next = { ...old,
    requiredMinutes: Math.min(1440, Math.max(1, Math.floor(Number(body.requiredMinutes) || 60))),
    maxPending: Math.min(10, Math.max(1, Math.floor(Number(body.maxPending) || 1))),
    requestsEnabled: body.requestsEnabled === true,
    volume: Math.min(100, Math.max(0, Math.floor(Number(body.volume ?? old.volume) || 0))),
    updatedAt: Date.now()
  };
  await putDb(env, 'tracks/publicSettings', next);
  return { ok: true, settings: next };
}
async function adminAction(env, body) {
  const { orderId, action } = body;
  if (typeof orderId !== 'string' || !orderId || !['playing', 'done', 'rejected', 'skipped', 'disabled', 'moveTop'].includes(action)) throw new HttpError(400, 'Некорректная команда.');
  const order = await getDb(env, `tracks/queue/${orderId}`);
  if (!order) throw new HttpError(404, 'Трек не найден.');
  const active = await getDb(env, 'tracks/active');
  if (action === 'moveTop') {
    const minSeq = Math.min(0, ...((await allQueue(env)).map(x => Number(x.sequence || x.createdAt || 0))));
    await patchDb(env, `tracks/queue/${orderId}`, { createdAt: 0, sequence: minSeq - 1 });
    return { ok: true };
  }
  if (action === 'playing') {
    if (active?.orderId && active.orderId !== orderId) await patchDb(env, `tracks/queue/${active.orderId}`, { status: 'pending' });
    await patchDb(env, `tracks/queue/${orderId}`, { status: 'playing', startedAt: Date.now() });
    await putDb(env, 'tracks/active', { orderId, videoId: order.videoId, title: order.title, displayName: order.displayName, ownerUid: order.ownerUid || await getDb(env, `tracks/orderOwners/${orderId}`) || null, startedAt: Date.now() });
    return { ok: true };
  }
  const isActive = active?.orderId === orderId;
  await patchDb(env, `tracks/queue/${orderId}`, { status: action, finishedAt: Date.now() });
  await clearOwnerOrder(env, { id: orderId, ...order });
  if (isActive) {
    await removeDb(env, 'tracks/active');
    const queue = await allQueue(env), next = queue.find(x => x.status === 'pending');
    if (next) {
      await patchDb(env, `tracks/queue/${next.id}`, { status: 'playing', startedAt: Date.now() });
      await putDb(env, 'tracks/active', { orderId: next.id, videoId: next.videoId, title: next.title, displayName: next.displayName, ownerUid: next.ownerUid || await getDb(env, `tracks/orderOwners/${next.id}`) || null, startedAt: Date.now() });
    }
  }
  return { ok: true };
}
async function finishTrack(env, body) {
  const { orderId, videoId } = body;
  if (typeof orderId !== 'string' || !validVideoId(videoId)) throw new HttpError(400, 'Некорректное событие завершения.');
  const active = await getDb(env, 'tracks/active');
  if (!active || active.orderId !== orderId || active.videoId !== videoId) return { ok: true, ignored: true };
  const ended = await getDb(env, `tracks/queue/${orderId}`) || {};
  await patchDb(env, `tracks/queue/${orderId}`, { status: 'done', finishedAt: Date.now() });
  await clearOwnerOrder(env, { id: orderId, ...ended });
  const latest = await getDb(env, 'tracks/active');
  if (latest?.orderId === orderId) await removeDb(env, 'tracks/active');
  const queue = await allQueue(env), next = queue.find(x => x.status === 'pending');
  if (next) {
    await patchDb(env, `tracks/queue/${next.id}`, { status: 'playing', startedAt: Date.now() });
    await putDb(env, 'tracks/active', { orderId: next.id, videoId: next.videoId, title: next.title, displayName: next.displayName, ownerUid: next.ownerUid || await getDb(env, `tracks/orderOwners/${next.id}`) || null, startedAt: Date.now() });
  }
  return { ok: true, nextOrderId: next?.id || null };
}
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });
    const url = new URL(request.url), path = url.pathname.replace(/\/+$/, '') || '/';
    if (request.method === 'GET' && path === '/health') return json({ ok: true, service: 'STRIMKO TRACKS Worker' });
    if (request.method !== 'POST') return json({ error: 'Используй POST.' }, 405);
    let body = {}; try { body = await request.json(); } catch { return json({ error: 'Некорректный JSON.' }, 400); }
    try {
      if (path === '/progress') return json(await getProgress(env, body));
      if (path === '/request') return json(await createOrder(env, body));
      if (path === '/finish') return json(await finishTrack(env, body));
      if (path === '/admin/settings') { await verifyAdmin(request, env); return json(await saveSettings(env, body)); }
      if (path === '/admin/action') { await verifyAdmin(request, env); return json(await adminAction(env, body)); }
      if (path === '/admin/settings/get') { await verifyAdmin(request, env); return json(await settings(env)); }
      return json({ error: 'Маршрут не найден.' }, 404);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Неизвестная ошибка.' }, error.status || 500);
    }
  }
};
