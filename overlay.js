(() => {
 const cfg=window.STRIMKO_TRACKS_FIREBASE_CONFIG;if(!cfg||!window.firebase)return;
 if(!firebase.apps.length)firebase.initializeApp(cfg);const db=firebase.database();const functions=firebase.app().functions('europe-west1');const call=n=>functions.httpsCallable(n);
 let player=null,current=null,loadingId=null,finishSent=false;
 function notice(t){document.getElementById('overlayNotice').textContent=t;}
 function loadYT(){if(window.YT&&window.YT.Player){createPlayer();return;}const s=document.createElement('script');s.src='https://www.youtube.com/iframe_api';document.head.appendChild(s);window.onYouTubeIframeAPIReady=createPlayer;}
 function createPlayer(){if(player)return;player=new YT.Player('player',{width:'1920',height:'1080',videoId:'',playerVars:{autoplay:1,controls:0,disablekb:1,fs:0,iv_load_policy:3,modestbranding:1,playsinline:1,rel:0},events:{onReady:()=>{if(current)play(current);},onStateChange:e=>{if(e.data===YT.PlayerState.ENDED&&current&&!finishSent){finishSent=true;call('tracksOverlayFinish')({orderId:current.orderId,videoId:current.videoId}).catch(err=>console.warn(err)).finally(()=>{setTimeout(()=>{finishSent=false;},1500);});}}}});}
 function play(item){if(!item||!item.videoId)return;current=item;loadingId=item.orderId;finishSent=false;document.getElementById('nowTitle').textContent=item.title||'Трек';document.getElementById('nowBy').textContent=item.displayName?`Заказал: ${item.displayName}`:'';document.getElementById('nowPlaying').hidden=false;notice('🎵 СЕЙЧАС ИГРАЕТ');if(player&&player.loadVideoById){player.loadVideoById(item.videoId);}else loadYT();}
 db.ref('tracks/active').on('value',snap=>{const v=snap.val();if(!v){current=null;document.getElementById('nowPlaying').hidden=true;notice('STRIMKO TRACKS · ожидание трека');return;}if(v.orderId!==loadingId)play(v);});
})();
