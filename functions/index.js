const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getDatabase, ServerValue } = require('firebase-admin/database');
const { getAuth } = require('firebase-admin/auth');
const crypto = require('crypto');
initializeApp();
const db = getDatabase();
const REGION = 'europe-west1';
const DEFAULTS = { requiredMinutes: 60, cooldownMinutes: 30, maxPending: 1, requestsEnabled: true };
const now = () => Date.now();
function requireAuth(req) { if (!req.auth) throw new HttpsError('unauthenticated', 'Сначала войди в аккаунт.'); return req.auth.uid; }
function requireAdmin(req) { const uid=requireAuth(req); if(req.auth.token.admin!==true) throw new HttpsError('permission-denied','Требуются права администратора.'); return uid; }
function cleanName(v){return String(v||'Зритель').replace(/[<>\u0000-\u001f]/g,'').trim().slice(0,24)||'Зритель';}
function cleanTitle(v){return String(v||'').replace(/[<>\u0000-\u001f]/g,'').trim().slice(0,100);}
function validVideoId(v){return typeof v==='string'&&/^[A-Za-z0-9_-]{11}$/.test(v);}
async function settings(){const s=(await db.ref('tracks/publicSettings').get()).val()||{};return {...DEFAULTS,...s};}

function normalizeViewerId(v){return typeof v==='string'&&/^SK-[A-F0-9]{24}$/.test(v.trim().toUpperCase())?v.trim().toUpperCase():null;}
exports.tracksGetOrCreateViewerId = onCall({region:REGION,enforceAppCheck:false},async req=>{
 const uid=requireAuth(req),userRef=db.ref(`tracks/users/${uid}`),snap=await userRef.get();let u=snap.val()||{};
 if(u.viewerId&&normalizeViewerId(u.viewerId)&&(await db.ref(`tracks/viewerIds/${u.viewerId}`).get()).val()===uid)return {ok:true,viewerId:u.viewerId};
 let viewerId=null;
 for(let i=0;i<5;i++){const candidate='SK-'+crypto.randomBytes(12).toString('hex').toUpperCase();const result=await db.ref(`tracks/viewerIds/${candidate}`).transaction(old=>old===null?uid:undefined);if(result.committed){viewerId=candidate;break;}}
 if(!viewerId)throw new HttpsError('internal','Не удалось создать ID. Попробуй ещё раз.');
 const displayName=u.displayName||('Зритель-'+viewerId.slice(-4));
 await userRef.update({viewerId,displayName,watchSeconds:Number(u.watchSeconds||0),lastOrderAt:Number(u.lastOrderAt||0),createdAt:Number(u.createdAt||now())});
 return {ok:true,viewerId};
});
exports.tracksGetViewerProgress = onCall({region:REGION,enforceAppCheck:false},async req=>{
 const viewerId=normalizeViewerId(req.data?.viewerId);if(!viewerId)throw new HttpsError('invalid-argument','Проверь ID STRIMKO.');
 const uid=(await db.ref(`tracks/viewerIds/${viewerId}`).get()).val();if(!uid)throw new HttpsError('not-found','ID не найден. Сначала открой STRIMKO и получи ID.');
 const u=(await db.ref(`tracks/users/${uid}`).get()).val()||{},s=await settings();
 return {ok:true,watchSeconds:Number(u.watchSeconds||0),requiredMinutes:Math.max(1,Number(s.requiredMinutes)||60),requestsEnabled:s.requestsEnabled===true};
});
exports.tracksStopWatch = onCall({region:REGION,enforceAppCheck:false},async req=>{
 const uid=requireAuth(req);await db.ref(`tracks/sessions/${uid}`).update({active:false,lastBeatAt:now()});return {ok:true};
});
exports.tracksRequestByViewerId = onCall({region:REGION,enforceAppCheck:false},async req=>{
 const viewerId=normalizeViewerId(req.data?.viewerId),videoId=req.data?.videoId,title=cleanTitle(req.data?.title),displayName=cleanName(req.data?.displayName||'Зритель');
 if(!viewerId)throw new HttpsError('invalid-argument','Введи корректный ID STRIMKO.');
 if(!validVideoId(videoId))throw new HttpsError('invalid-argument','Некорректная ссылка YouTube.');
 const uid=(await db.ref(`tracks/viewerIds/${viewerId}`).get()).val();if(!uid)throw new HttpsError('not-found','ID не найден. Сначала открой STRIMKO и получи ID.');
 const s=await settings();if(!s.requestsEnabled)throw new HttpsError('failed-precondition','Заказы сейчас выключены.');
 const userRef=db.ref(`tracks/users/${uid}`),snap=await userRef.get(),u=snap.val();if(!u)throw new HttpsError('not-found','Профиль ID не найден.');
 const needed=Math.max(1,Number(s.requiredMinutes)||60)*60;if(Number(u.watchSeconds||0)<needed)throw new HttpsError('failed-precondition',`Нужно посмотреть ещё ${Math.ceil((needed-Number(u.watchSeconds||0))/60)} минут.`);
 const t=now(),cooldown=Math.max(0,Number(s.cooldownMinutes)||0)*60000,last=Number(u.lastOrderAt||0);
 if(t-last<cooldown)throw new HttpsError('resource-exhausted',`Повторный заказ доступен через ${Math.ceil((cooldown-(t-last))/60000)} мин.`);
 const userOrders=(await db.ref(`tracks/userOrders/${uid}`).get()).val()||{};let pending=0;
 for(const orderId of Object.keys(userOrders)){const os=await db.ref(`tracks/queue/${orderId}/status`).get();if(['pending','playing'].includes(os.val()))pending++;}
 if(pending>=Math.max(1,Number(s.maxPending)||1))throw new HttpsError('resource-exhausted','У тебя уже есть трек в очереди.');
 let accepted=false;await userRef.transaction(old=>{if(!old)return;if(now()-Number(old.lastOrderAt||0)<cooldown||Number(old.orderLockAt||0)>t-15000)return;old.lastOrderAt=t;old.orderLockAt=t;accepted=true;return old;});
 if(!accepted)throw new HttpsError('resource-exhausted','Заказ уже отправлен или действует пауза.');
 const orderRef=db.ref('tracks/queue').push();await orderRef.set({displayName,title:title||`YouTube · ${videoId}`,videoId,status:'pending',createdAt:t});
 await db.ref(`tracks/orderOwners/${orderRef.key}`).set(uid);await db.ref(`tracks/userOrders/${uid}/${orderRef.key}`).set(true);
 return {ok:true,orderNumber:orderRef.key};
});

exports.tracksCreateProfile = onCall({region:REGION, enforceAppCheck:false}, async req=>{
 const uid=requireAuth(req);const user=await getAuth().getUser(uid);const displayName=cleanName(req.data?.displayName||user.displayName||user.email?.split('@')[0]);
 const ref=db.ref(`tracks/users/${uid}`);await ref.transaction(old=>old?{...old,displayName,emailVerified:!!user.emailVerified}:{displayName,watchSeconds:0,lastOrderAt:0,createdAt:now(),emailVerified:!!user.emailVerified});return {ok:true};
});
exports.tracksStartWatch = onCall({region:REGION, enforceAppCheck:false}, async req=>{
 const uid=requireAuth(req);const t=now();const ref=db.ref(`tracks/sessions/${uid}`);await ref.set({startedAt:t,lastBeatAt:t,watchSecondsAtStart:Number(((await db.ref(`tracks/users/${uid}/watchSeconds`).get()).val())||0),active:true});return {ok:true,serverTime:t};
});
exports.tracksHeartbeat = onCall({region:REGION, enforceAppCheck:false}, async req=>{
 const uid=requireAuth(req), t=now(), sessionRef=db.ref(`tracks/sessions/${uid}`), userRef=db.ref(`tracks/users/${uid}`);
 let gained=0, rejected=false;
 await sessionRef.transaction(s=>{if(!s||!s.active){rejected=true;return;}const delta=t-Number(s.lastBeatAt||0);if(delta<18000||delta>45000){if(delta>45000){s.lastBeatAt=t;s.active=true;}else rejected=true;return s;}gained=Math.floor(delta/1000);s.lastBeatAt=t;s.lastSeenAt=t;return s;});
 if(gained>0){let watchSeconds=0;await userRef.transaction(u=>{u=u||{displayName:'Зритель',watchSeconds:0};u.watchSeconds=Math.max(0,Number(u.watchSeconds||0))+gained;u.updatedAt=t;watchSeconds=u.watchSeconds;return u;});return {ok:true,watchSeconds};}
 const u=(await userRef.get()).val()||{};return {ok:!rejected,watchSeconds:Number(u.watchSeconds||0)};
});
exports.tracksRequest = onCall({region:REGION, enforceAppCheck:false}, async req=>{
 const uid=requireAuth(req), videoId=req.data?.videoId, title=cleanTitle(req.data?.title);const authUser=await getAuth().getUser(uid);if(!authUser.emailVerified)throw new HttpsError('failed-precondition','Подтверди email по ссылке из письма перед заказом.');if(!validVideoId(videoId))throw new HttpsError('invalid-argument','Некорректная ссылка YouTube.');
 const s=await settings();if(!s.requestsEnabled)throw new HttpsError('failed-precondition','Заказы сейчас выключены.');
 const userRef=db.ref(`tracks/users/${uid}`), userSnap=await userRef.get(), u=userSnap.val();if(!u)throw new HttpsError('failed-precondition','Профиль не найден. Выйди и войди снова.');
 const needed=Math.max(1,Number(s.requiredMinutes)||60)*60;if(Number(u.watchSeconds||0)<needed)throw new HttpsError('failed-precondition',`Нужно посмотреть ещё ${Math.ceil((needed-Number(u.watchSeconds||0))/60)} минут.`);
 const t=now(), cooldown=Math.max(0,Number(s.cooldownMinutes)||0)*60000;if(t-Number(u.lastOrderAt||0)<cooldown)throw new HttpsError('resource-exhausted',`Повторный заказ доступен через ${Math.ceil((cooldown-(t-Number(u.lastOrderAt||0)))/60000)} мин.`);
 const userOrders=(await db.ref(`tracks/userOrders/${uid}`).get()).val()||{};let pending=0;for(const orderId of Object.keys(userOrders)){const orderSnap=await db.ref(`tracks/queue/${orderId}/status`).get();if(['pending','playing'].includes(orderSnap.val()))pending++;}if(pending>=Math.max(1,Number(s.maxPending)||1))throw new HttpsError('resource-exhausted','У тебя уже есть трек в очереди.');
 const orderRef=db.ref('tracks/queue').push();const record={displayName:cleanName(u.displayName),videoId,title:title||`YouTube · ${videoId}`,status:'pending',createdAt:t};
 // Transaction protects against simultaneous requests by the same account.
 let accepted=false;await userRef.transaction(old=>{if(!old)return;const last=Number(old.lastOrderAt||0);if(last>=t || now()-last<cooldown || Number(old.orderLockAt||0)>t-15000)return;old.lastOrderAt=t;old.orderLockAt=t;accepted=true;return old;});if(!accepted)throw new HttpsError('resource-exhausted','Заказ уже отправлен или действует пауза.');
 await orderRef.set(record);await db.ref(`tracks/orderOwners/${orderRef.key}`).set(uid);await db.ref(`tracks/userOrders/${uid}/${orderRef.key}`).set(true);return {ok:true,orderNumber:orderRef.key};
});
exports.tracksAdminSetSettings = onCall({region:REGION, enforceAppCheck:false}, async req=>{
 requireAdmin(req);const d=req.data||{};const v={requiredMinutes:Math.min(1440,Math.max(1,Math.floor(Number(d.requiredMinutes)||60))),cooldownMinutes:Math.min(1440,Math.max(0,Math.floor(Number(d.cooldownMinutes)||0))),maxPending:Math.min(10,Math.max(1,Math.floor(Number(d.maxPending)||1))),requestsEnabled:d.requestsEnabled===true,updatedAt:now()};await db.ref('tracks/publicSettings').set(v);return {ok:true,settings:v};
});
exports.tracksAdminQueueAction = onCall({region:REGION, enforceAppCheck:false}, async req=>{
 requireAdmin(req);const {orderId,action}=req.data||{};if(typeof orderId!=='string'||!orderId||!['playing','done','rejected','moveTop'].includes(action))throw new HttpsError('invalid-argument','Некорректная команда.');const ref=db.ref(`tracks/queue/${orderId}`);const snap=await ref.get();if(!snap.exists())throw new HttpsError('not-found','Заказ не найден.');const order=snap.val();
 if(action==='playing'){
  const old=(await db.ref('tracks/active').get()).val();if(old?.orderId&&old.orderId!==orderId){await db.ref(`tracks/queue/${old.orderId}/status`).set('pending');}
  await ref.update({status:'playing'});await db.ref('tracks/active').set({orderId,videoId:order.videoId,title:order.title,displayName:order.displayName,startedAt:now(),updatedAt:now()});
 }else if(action==='moveTop'){await ref.update({createdAt:0});}
 else {await ref.update({status:action,finishedAt:now()});const owner=(await db.ref(`tracks/orderOwners/${orderId}`).get()).val();if(owner)await db.ref(`tracks/userOrders/${owner}/${orderId}`).remove();const active=(await db.ref('tracks/active').get()).val();if(active?.orderId===orderId)await db.ref('tracks/active').remove();}
 return {ok:true};
});
// The OBS overlay may notify the backend that the current YouTube player ended. It cannot create or alter orders.
exports.tracksOverlayFinish = onCall({region:REGION, enforceAppCheck:false}, async req=>{
 const {orderId,videoId}=req.data||{};if(typeof orderId!=='string'||!validVideoId(videoId))throw new HttpsError('invalid-argument','Некорректное событие.');
 const activeRef=db.ref('tracks/active'), snap=await activeRef.get(), active=snap.val();if(!active||active.orderId!==orderId||active.videoId!==videoId)throw new HttpsError('failed-precondition','Активный трек уже изменился.');
 await db.ref(`tracks/queue/${orderId}`).update({status:'done',finishedAt:now()});const owner=(await db.ref(`tracks/orderOwners/${orderId}`).get()).val();if(owner)await db.ref(`tracks/userOrders/${owner}/${orderId}`).remove();await activeRef.remove();
 const q=await db.ref('tracks/queue').orderByChild('createdAt').get();let next=null;q.forEach(x=>{const v=x.val();if(!next&&v.status==='pending')next={id:x.key,...v};});if(next){await db.ref(`tracks/queue/${next.id}`).update({status:'playing'});await activeRef.set({orderId:next.id,videoId:next.videoId,title:next.title,displayName:next.displayName,startedAt:now(),updatedAt:now()});}
 return {ok:true,nextOrderId:next?.id||null};
});
