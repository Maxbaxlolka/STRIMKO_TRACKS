(() => {
 const cfg=window.STRIMKO_TRACKS_FIREBASE_CONFIG;if(!cfg||!window.firebase)return;
 if(!firebase.apps.length)firebase.initializeApp(cfg);const db=firebase.database(),auth=firebase.auth();
 const workerBase=String(window.STRIMKO_WORKER_URL||'').replace(/\/$/,'');
 let player=null,current=null,loadingId=null,finishSent=false,currentVolume=80;
 function notice(t){document.getElementById('overlayNotice').textContent=t;}
 async function api(path,data){if(!workerBase||workerBase.includes('PASTE_CLOUDFLARE'))throw new Error('Cloudflare Worker URL is not configured');const r=await fetch(workerBase+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||`HTTP ${r.status}`);return d;}
 function loadYT(){if(window.YT&&window.YT.Player){createPlayer();return;}const s=document.createElement('script');s.src='https://www.youtube.com/iframe_api';document.head.appendChild(s);window.onYouTubeIframeAPIReady=createPlayer;}
 function applyVolume(){if(!player||!player.setVolume)return;try{player.setVolume(currentVolume);if(currentVolume>0&&player.unMute)player.unMute();if(currentVolume===0&&player.mute)player.mute();}catch(e){console.warn('Volume:',e);}}
 function createPlayer(){if(player)return;player=new YT.Player('player',{width:'1920',height:'1080',videoId:'',playerVars:{autoplay:1,controls:0,disablekb:1,fs:0,iv_load_policy:3,modestbranding:1,playsinline:1,rel:0},events:{onReady:()=>{applyVolume();if(current)play(current);},onStateChange:e=>{if(e.data===YT.PlayerState.ENDED&&current&&!finishSent){finishSent=true;const ended={...current};api('/finish',{orderId:ended.orderId,videoId:ended.videoId}).catch(err=>console.warn('Finish track:',err)).finally(()=>setTimeout(()=>finishSent=false,1200));}}}});}
 function play(item){if(!item||!item.videoId)return;current=item;loadingId=item.orderId;finishSent=false;document.getElementById('nowTitle').textContent=item.title||'Трек';document.getElementById('nowBy').textContent=item.displayName?`Заказал: ${item.displayName}`:'';document.getElementById('nowPlaying').hidden=false;notice('🎵 СЕЙЧАС ИГРАЕТ');if(player&&player.loadVideoById){player.loadVideoById(item.videoId);applyVolume();}else loadYT();}
 db.ref('tracks/publicSettings/volume').on('value',snap=>{const n=Number(snap.val());currentVolume=Number.isFinite(n)?Math.max(0,Math.min(100,n)):80;applyVolume();});
 db.ref('tracks/active').on('value',snap=>{const v=snap.val();if(!v){current=null;loadingId=null;document.getElementById('nowPlaying').hidden=true;notice('STRIMKO TRACKS · ожидание трека');if(player&&player.stopVideo)player.stopVideo();return;}if(v.orderId!==loadingId)play(v);});
 auth.signInAnonymously().catch(e=>console.warn('Overlay anonymous auth:',e));
})();
