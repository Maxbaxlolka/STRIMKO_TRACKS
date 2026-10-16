var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var DEFAULT_SETTINGS = { requiredMinutes: 60, maxPending: 1, requestsEnabled: true, volume: 80 };
var ALLOWED_ORIGIN = "*";
var cachedAccessToken = null;
var cachedAccessTokenUntil = 0;
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders({ "content-type": "application/json; charset=utf-8" }) });
}
__name(json, "json");
function corsHeaders(extra = {}) {
  return { "access-control-allow-origin": ALLOWED_ORIGIN, "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "Content-Type, Authorization", "access-control-max-age": "86400", ...extra };
}
__name(corsHeaders, "corsHeaders");
function cleanName(v) {
  return String(v || "\u0417\u0440\u0438\u0442\u0435\u043B\u044C").replace(/[<>\u0000-\u001f]/g, "").trim().slice(0, 24) || "\u0417\u0440\u0438\u0442\u0435\u043B\u044C";
}
__name(cleanName, "cleanName");
function cleanTitle(v) {
  return String(v || "").replace(/[<>\u0000-\u001f]/g, "").trim().slice(0, 100);
}
__name(cleanTitle, "cleanTitle");
function validVideoId(v) {
  return typeof v === "string" && /^[A-Za-z0-9_-]{11}$/.test(v);
}
__name(validVideoId, "validVideoId");
function normalizeViewerId(v) {
  const match = typeof v === "string" ? /^SK-([A-Za-z0-9]{28})$/i.exec(v.trim()) : null;
  return match ? "SK-" + match[1] : null;
}
__name(normalizeViewerId, "normalizeViewerId");
function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}
__name(encodePath, "encodePath");
function b64url(bytesOrString) {
  const bytes = typeof bytesOrString === "string" ? new TextEncoder().encode(bytesOrString) : bytesOrString;
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
__name(b64url, "b64url");
function pemToArrayBuffer(pem) {
  const base64 = pem.replace(/-----BEGIN PRIVATE KEY-----/g, "").replace(/-----END PRIVATE KEY-----/g, "").replace(/\s/g, "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
__name(pemToArrayBuffer, "pemToArrayBuffer");
async function accessToken(env) {
  const now = Math.floor(Date.now() / 1e3);
  if (cachedAccessToken && cachedAccessTokenUntil > now + 60) return cachedAccessToken;
  if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) throw new Error("\u041D\u0435 \u043D\u0430\u0441\u0442\u0440\u043E\u0435\u043D \u0441\u0435\u043A\u0440\u0435\u0442 FIREBASE_SERVICE_ACCOUNT_JSON \u0432 Cloudflare.");
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const unsigned = `${header}.${claim}`;
  const key = await crypto.subtle.importKey("pkcs8", pemToArrayBuffer(sa.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const assertion = `${unsigned}.${b64url(new Uint8Array(signature))}`;
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }) });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error(`\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u043E\u043B\u0443\u0447\u0438\u0442\u044C \u0442\u043E\u043A\u0435\u043D Google: ${data.error_description || data.error || response.status}`);
  cachedAccessToken = data.access_token;
  cachedAccessTokenUntil = now + Number(data.expires_in || 3600);
  return cachedAccessToken;
}
__name(accessToken, "accessToken");
async function dbRequest(env, path, method = "GET", body, extraHeaders = {}) {
  const token = await accessToken(env);
  const base = String(env.FIREBASE_DATABASE_URL || "").replace(/\/$/, "");
  if (!base) throw new Error("\u041D\u0435 \u043D\u0430\u0441\u0442\u0440\u043E\u0435\u043D \u0441\u0435\u043A\u0440\u0435\u0442 FIREBASE_DATABASE_URL.");
  const url = `${base}/${encodePath(path)}.json?access_token=${encodeURIComponent(token)}`;
  const headers = { "content-type": "application/json", ...extraHeaders };
  const response = await fetch(url, { method, headers, body: body === void 0 ? void 0 : JSON.stringify(body) });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) throw new Error(`Firebase Database ${response.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  return { data, headers: response.headers };
}
__name(dbRequest, "dbRequest");
async function getDb(env, path) {
  return (await dbRequest(env, path)).data;
}
__name(getDb, "getDb");
async function putDb(env, path, value) {
  return (await dbRequest(env, path, "PUT", value)).data;
}
__name(putDb, "putDb");
async function patchDb(env, path, value) {
  return (await dbRequest(env, path, "PATCH", value)).data;
}
__name(patchDb, "patchDb");
async function removeDb(env, path) {
  return (await dbRequest(env, path, "DELETE")).data;
}
__name(removeDb, "removeDb");
async function mutateDb(env, path, mutator, attempts = 5) {
  for (let i = 0; i < attempts; i++) {
    const token = await accessToken(env), base = String(env.FIREBASE_DATABASE_URL || "").replace(/\/$/, "");
    const url = `${base}/${encodePath(path)}.json?access_token=${encodeURIComponent(token)}`;
    const read = await fetch(url, { headers: { "x-firebase-etag": "true" } });
    const oldText = await read.text();
    let old = null;
    try {
      old = oldText ? JSON.parse(oldText) : null;
    } catch {
    }
    if (!read.ok) throw new Error(`Firebase read ${read.status}: ${oldText}`);
    const next = mutator(old);
    if (next === void 0) return { committed: false, value: old };
    const etag = read.headers.get("etag");
    const write = await fetch(url, { method: "PUT", headers: { "content-type": "application/json", "if-match": etag || "null_etag" }, body: JSON.stringify(next) });
    const text = await write.text();
    if (write.status === 412) continue;
    if (!write.ok) throw new Error(`Firebase write ${write.status}: ${text}`);
    let value = next;
    try {
      value = text ? JSON.parse(text) : next;
    } catch {
    }
    return { committed: true, value };
  }
  throw new Error("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u0435 \u0438\u0437-\u0437\u0430 \u043E\u0434\u043D\u043E\u0432\u0440\u0435\u043C\u0435\u043D\u043D\u044B\u0445 \u0437\u0430\u043F\u0440\u043E\u0441\u043E\u0432. \u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439 \u0435\u0449\u0451 \u0440\u0430\u0437.");
}
__name(mutateDb, "mutateDb");
async function settings(env) {
  return { ...DEFAULT_SETTINGS, ...await getDb(env, "tracks/publicSettings") || {} };
}
__name(settings, "settings");
async function lookupViewer(env, viewerId) {
  const match = /^SK-([A-Za-z0-9]{28})$/.exec(String(viewerId || ""));
  if (!match) throw new HttpError(400, "Неверный формат STRIMKO ID. Скопируй его без изменений с основного сайта.");
  const uid = match[1];
  const user = await getDb(env, `tracks/users/${uid}`);
  if (!user) throw new HttpError(404, "ID не найден. Сначала открой основной сайт STRIMKO и дождись создания ID.");
  return uid;
}
__name(lookupViewer, "lookupViewer");
var HttpError = class extends Error {
  static {
    __name(this, "HttpError");
  }
  constructor(status, message) {
    super(message);
    this.status = status;
  }
};
async function lookupFirebaseAccount(idToken, env) {
  if (!env.FIREBASE_API_KEY) throw new Error("Не настроен секрет FIREBASE_API_KEY в Cloudflare.");
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken })
  });
  const data = await response.json();
  const account = data.users && data.users[0];
  if (!response.ok || !account) throw new HttpError(401, "Не удалось подтвердить вход Firebase. Войди заново.");
  return account;
}
__name(lookupFirebaseAccount, "lookupFirebaseAccount");
async function verifyAdmin(request, env) {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") || "");
  if (!match) throw new HttpError(401, "Нужно войти в аккаунт администратора.");
  const account = await lookupFirebaseAccount(match[1], env);
  const allowedEmail = String(env.ADMIN_EMAIL || "").trim().toLowerCase();
  const allowedUid = String(env.ADMIN_UID || "").trim();
  if (!allowedEmail || !allowedUid) throw new HttpError(500, "Не настроены секреты ADMIN_EMAIL и ADMIN_UID в Cloudflare.");
  if (String(account.localId || "") !== allowedUid || String(account.email || "").toLowerCase() !== allowedEmail) {
    throw new HttpError(403, "У этого Firebase-аккаунта нет доступа к панели STRIMKO TRACKS. Проверь ADMIN_EMAIL и ADMIN_UID в Cloudflare.");
  }
  return account;
}
__name(verifyAdmin, "verifyAdmin");
function sortQueue(a, b) {
  const at = Number(a.createdAt || 0), bt = Number(b.createdAt || 0);
  if (at !== bt) return at - bt;
  const as = Number(a.sequence || 0), bs = Number(b.sequence || 0);
  if (as !== bs) return as - bs;
  return String(a.id).localeCompare(String(b.id));
}
__name(sortQueue, "sortQueue");
async function allQueue(env) {
  const raw = await getDb(env, "tracks/queue") || {};
  return Object.entries(raw).map(([id, value]) => ({ id, ...value || {} })).sort(sortQueue);
}
__name(allQueue, "allQueue");
async function nextSequence(env) {
  const result = await mutateDb(env, "tracks/meta/queueSequence", (old) => Number(old || 0) + 1);
  return Number(result.value || 1);
}
__name(nextSequence, "nextSequence");
async function clearOwnerOrder(env, order) {
  const ownerUid = order.ownerUid || await getDb(env, `tracks/orderOwners/${order.id}`);
  if (ownerUid) await removeDb(env, `tracks/userOrders/${ownerUid}/${order.id}`);
}
__name(clearOwnerOrder, "clearOwnerOrder");
async function heartbeat(request, env, body) {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") || "");
  if (!match) throw new HttpError(401, "Не удалось подтвердить сессию зрителя. Обнови основной сайт STRIMKO.");
  const account = await lookupFirebaseAccount(match[1], env);
  const uid = String(account.localId || "");
  if (!/^[A-Za-z0-9]{28}$/.test(uid)) throw new HttpError(401, "Некорректная сессия зрителя.");
  const now = Date.now();
  const playing = body.playing === true;
  const result = await mutateDb(env, `tracks/users/${uid}`, old => {
    const profile = old || { displayName: "Зритель", watchSeconds: 0, lastOrderAt: 0, createdAt: now };
    if (!playing) return { ...profile, lastHeartbeatAt: 0, updatedAt: now };
    const last = Number(profile.lastHeartbeatAt || 0);
    let added = 0;
    if (last > 0) {
      const elapsed = Math.floor((now - last) / 1000);
      if (elapsed >= 15 && elapsed <= 35) added = Math.min(elapsed, 25);
    }
    return {
      ...profile,
      watchSeconds: Math.max(0, Number(profile.watchSeconds || 0)) + added,
      lastHeartbeatAt: now,
      updatedAt: now
    };
  });
  return { ok: true, watchSeconds: Number(result.value?.watchSeconds || 0) };
}
__name(heartbeat, "heartbeat");
async function getProgress(env, body) {
  const viewerId = normalizeViewerId(body.viewerId);
  if (!viewerId) throw new HttpError(400, "\u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0439 \u0444\u043E\u0440\u043C\u0430\u0442. \u0421\u043A\u043E\u043F\u0438\u0440\u0443\u0439 ID \u0441 \u043E\u0441\u043D\u043E\u0432\u043D\u043E\u0433\u043E \u0441\u0430\u0439\u0442\u0430 STRIMKO.");
  const uid = await lookupViewer(env, viewerId);
  const [user, s] = await Promise.all([getDb(env, `tracks/users/${uid}`), settings(env)]);
  if (!user) throw new HttpError(404, "\u041F\u0440\u043E\u0444\u0438\u043B\u044C ID \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D. \u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u043E\u0442\u043A\u0440\u043E\u0439 \u043E\u0441\u043D\u043E\u0432\u043D\u043E\u0439 \u0441\u0430\u0439\u0442 STRIMKO.");
  return { ok: true, watchSeconds: Number(user.watchSeconds || 0), requiredMinutes: Math.max(1, Number(s.requiredMinutes) || 60), requestsEnabled: s.requestsEnabled !== false, maxPending: Math.max(1, Number(s.maxPending) || 1) };
}
__name(getProgress, "getProgress");
async function createOrder(env, body) {
  const viewerId = normalizeViewerId(body.viewerId), videoId = body.videoId;
  if (!viewerId) throw new HttpError(400, "\u0412\u0432\u0435\u0434\u0438 \u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u044B\u0439 ID STRIMKO.");
  if (!validVideoId(videoId)) throw new HttpError(400, "\u041D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u0430\u044F \u0441\u0441\u044B\u043B\u043A\u0430 YouTube.");
  const uid = await lookupViewer(env, viewerId), s = await settings(env);
  if (s.requestsEnabled === false) throw new HttpError(403, "\u0417\u0430\u043A\u0430\u0437\u044B \u0441\u0435\u0439\u0447\u0430\u0441 \u0432\u044B\u043A\u043B\u044E\u0447\u0435\u043D\u044B.");
  const requiredSeconds = Math.max(1, Number(s.requiredMinutes) || 60) * 60;
  let user = null;
  const lock = await mutateDb(env, `tracks/users/${uid}`, (old) => {
    if (!old) return void 0;
    const now = Date.now();
    if (Number(old.watchSeconds || 0) < requiredSeconds) return void 0;
    if (Number(old.orderLockAt || 0) > now - 2e4) return void 0;
    return { ...old, orderLockAt: now };
  });
  if (!lock.committed) {
    const fresh = await getDb(env, `tracks/users/${uid}`) || {};
    if (Number(fresh.watchSeconds || 0) < requiredSeconds) throw new HttpError(409, `\u041D\u0443\u0436\u043D\u043E \u043F\u043E\u0441\u043C\u043E\u0442\u0440\u0435\u0442\u044C \u0435\u0449\u0451 ${Math.max(1, Math.ceil((requiredSeconds - Number(fresh.watchSeconds || 0)) / 60))} \u043C\u0438\u043D\u0443\u0442.`);
    throw new HttpError(409, "\u0417\u0430\u043A\u0430\u0437 \u0443\u0436\u0435 \u043E\u0431\u0440\u0430\u0431\u0430\u0442\u044B\u0432\u0430\u0435\u0442\u0441\u044F. \u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439 \u0435\u0449\u0451 \u0440\u0430\u0437 \u0447\u0435\u0440\u0435\u0437 \u043D\u0435\u0441\u043A\u043E\u043B\u044C\u043A\u043E \u0441\u0435\u043A\u0443\u043D\u0434.");
  }
  user = lock.value;
  let createdOrderId = null;
  try {
    const userOrders = await getDb(env, `tracks/userOrders/${uid}`) || {};
    const all = await getDb(env, "tracks/queue") || {};
    let activeCount = 0;
    for (const id of Object.keys(userOrders)) if (["pending", "playing"].includes(all[id]?.status)) activeCount++;
    const max = Math.max(1, Math.min(10, Number(s.maxPending) || 1));
    if (activeCount >= max) throw new HttpError(409, `\u0414\u043E\u0441\u0442\u0438\u0433\u043D\u0443\u0442 \u043B\u0438\u043C\u0438\u0442: \u043C\u0430\u043A\u0441\u0438\u043C\u0443\u043C ${max} \u0430\u043A\u0442\u0438\u0432\u043D\u044B\u0445 \u0442\u0440\u0435\u043A(\u043E\u0432) \u043D\u0430 \u043E\u0434\u043D\u043E\u0433\u043E \u0437\u0440\u0438\u0442\u0435\u043B\u044F.`);
    const sequence = await nextSequence(env), now = Date.now();
    const orderId = `st${now.toString(36)}${sequence.toString(36)}${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
    const order = { displayName: cleanName(body.displayName), title: cleanTitle(body.title) || `YouTube \xB7 ${videoId}`, videoId, status: "pending", createdAt: now, sequence, ownerUid: uid };
    createdOrderId = orderId;
    await putDb(env, `tracks/queue/${orderId}`, order);
    await putDb(env, `tracks/orderOwners/${orderId}`, uid);
    await putDb(env, `tracks/userOrders/${uid}/${orderId}`, true);
    await patchDb(env, `tracks/users/${uid}`, { watchSeconds: 0, lastOrderAt: now, orderLockAt: 0, lastHeartbeatAt: 0, updatedAt: now });
    return { ok: true, orderNumber: orderId, message: "\u0417\u0430\u043A\u0430\u0437 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D \u0432 \u043A\u043E\u043D\u0435\u0446 \u043E\u0447\u0435\u0440\u0435\u0434\u0438. \u041F\u0440\u043E\u0433\u0440\u0435\u0441\u0441 \u0441\u0431\u0440\u043E\u0448\u0435\u043D." };
  } catch (e) {
    if (createdOrderId) {
      await removeDb(env, `tracks/queue/${createdOrderId}`).catch(() => {
      });
      await removeDb(env, `tracks/orderOwners/${createdOrderId}`).catch(() => {
      });
      await removeDb(env, `tracks/userOrders/${uid}/${createdOrderId}`).catch(() => {
      });
    }
    await patchDb(env, `tracks/users/${uid}`, { orderLockAt: 0 }).catch(() => {
    });
    throw e;
  }
}
__name(createOrder, "createOrder");
async function saveSettings(env, body) {
  const old = await settings(env);
  const next = {
    ...old,
    requiredMinutes: Math.min(1440, Math.max(1, Math.floor(Number(body.requiredMinutes) || 60))),
    maxPending: Math.min(10, Math.max(1, Math.floor(Number(body.maxPending) || 1))),
    requestsEnabled: body.requestsEnabled === true,
    volume: Math.min(100, Math.max(0, Math.floor(Number(body.volume ?? old.volume) || 0))),
    updatedAt: Date.now()
  };
  await putDb(env, "tracks/publicSettings", next);
  return { ok: true, settings: next };
}
__name(saveSettings, "saveSettings");
async function adminAction(env, body) {
  const { orderId, action } = body;
  if (typeof orderId !== "string" || !orderId || !["playing", "done", "rejected", "skipped", "disabled", "moveTop"].includes(action)) throw new HttpError(400, "\u041D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u0430\u044F \u043A\u043E\u043C\u0430\u043D\u0434\u0430.");
  const order = await getDb(env, `tracks/queue/${orderId}`);
  if (!order) throw new HttpError(404, "\u0422\u0440\u0435\u043A \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D.");
  const active = await getDb(env, "tracks/active");
  if (action === "moveTop") {
    const minSeq = Math.min(0, ...(await allQueue(env)).map((x) => Number(x.sequence || x.createdAt || 0)));
    await patchDb(env, `tracks/queue/${orderId}`, { createdAt: 0, sequence: minSeq - 1 });
    return { ok: true };
  }
  if (action === "playing") {
    if (active?.orderId && active.orderId !== orderId) await patchDb(env, `tracks/queue/${active.orderId}`, { status: "pending" });
    await patchDb(env, `tracks/queue/${orderId}`, { status: "playing", startedAt: Date.now() });
    await putDb(env, "tracks/active", { orderId, videoId: order.videoId, title: order.title, displayName: order.displayName, ownerUid: order.ownerUid || await getDb(env, `tracks/orderOwners/${orderId}`) || null, startedAt: Date.now() });
    return { ok: true };
  }
  const isActive = active?.orderId === orderId;
  await patchDb(env, `tracks/queue/${orderId}`, { status: action, finishedAt: Date.now() });
  await clearOwnerOrder(env, { id: orderId, ...order });
  if (isActive) {
    await removeDb(env, "tracks/active");
    const queue = await allQueue(env), next = queue.find((x) => x.status === "pending");
    if (next) {
      await patchDb(env, `tracks/queue/${next.id}`, { status: "playing", startedAt: Date.now() });
      await putDb(env, "tracks/active", { orderId: next.id, videoId: next.videoId, title: next.title, displayName: next.displayName, ownerUid: next.ownerUid || await getDb(env, `tracks/orderOwners/${next.id}`) || null, startedAt: Date.now() });
    }
  }
  return { ok: true };
}
__name(adminAction, "adminAction");
async function finishTrack(env, body) {
  const { orderId, videoId } = body;
  if (typeof orderId !== "string" || !validVideoId(videoId)) throw new HttpError(400, "\u041D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u043E\u0435 \u0441\u043E\u0431\u044B\u0442\u0438\u0435 \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u0438\u044F.");
  const active = await getDb(env, "tracks/active");
  if (!active || active.orderId !== orderId || active.videoId !== videoId) return { ok: true, ignored: true };
  const ended = await getDb(env, `tracks/queue/${orderId}`) || {};
  await patchDb(env, `tracks/queue/${orderId}`, { status: "done", finishedAt: Date.now() });
  await clearOwnerOrder(env, { id: orderId, ...ended });
  const latest = await getDb(env, "tracks/active");
  if (latest?.orderId === orderId) await removeDb(env, "tracks/active");
  const queue = await allQueue(env), next = queue.find((x) => x.status === "pending");
  if (next) {
    await patchDb(env, `tracks/queue/${next.id}`, { status: "playing", startedAt: Date.now() });
    await putDb(env, "tracks/active", { orderId: next.id, videoId: next.videoId, title: next.title, displayName: next.displayName, ownerUid: next.ownerUid || await getDb(env, `tracks/orderOwners/${next.id}`) || null, startedAt: Date.now() });
  }
  return { ok: true, nextOrderId: next?.id || null };
}
__name(finishTrack, "finishTrack");
var worker_default = {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
    const url = new URL(request.url), path = url.pathname.replace(/\/+$/, "") || "/";
    if (request.method === "GET" && path === "/health") return json({ ok: true, service: "STRIMKO TRACKS Worker" });
    if (request.method !== "POST") return json({ error: "\u0418\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0439 POST." }, 405);
    let body = {};
    try {
      body = await request.json();
    } catch {
      return json({ error: "\u041D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u044B\u0439 JSON." }, 400);
    }
    try {
      if (path === "/heartbeat") return json(await heartbeat(request, env, body));
      if (path === "/progress") return json(await getProgress(env, body));
      if (path === "/request") return json(await createOrder(env, body));
      if (path === "/finish") return json(await finishTrack(env, body));
      if (path === "/admin/settings") {
        await verifyAdmin(request, env);
        return json(await saveSettings(env, body));
      }
      if (path === "/admin/action") {
        await verifyAdmin(request, env);
        return json(await adminAction(env, body));
      }
      if (path === "/admin/settings/get") {
        await verifyAdmin(request, env);
        return json(await settings(env));
      }
      return json({ error: "\u041C\u0430\u0440\u0448\u0440\u0443\u0442 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D." }, 404);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u0430\u044F \u043E\u0448\u0438\u0431\u043A\u0430." }, error.status || 500);
    }
  }
};
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map
