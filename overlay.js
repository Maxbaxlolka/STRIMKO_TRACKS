(()=>{
const cfg=window.STRIMKO_TRACKS_FIREBASE_CONFIG;
if(!window.firebase||!cfg)return;
if(!firebase.apps.length)firebase.initializeApp(cfg);
const db=firebase.database(),$=id=>document.getElementById(id);
let player=null,ready=false,current=null,loadedId=null,volume=80,desiredPaused=false;
function notice(){ $('overlayNotice').textContent=!current?'STRIMKO TRACKS · ожидание трека':desiredPaused?'⏸ ПАУЗА':'🎵 СЕЙЧАС ИГРАЕТ'; }
function sync(){
  notice();
  if(!ready||!player)return;
  if(!current){loadedId=null;player.stopVideo();return;}
  player.setVolume(volume);
  if(loadedId!==current.orderId){
    loadedId=current.orderId;
    if(desiredPaused){player.cueVideoById(current.videoId);player.pauseVideo();}
    else player.loadVideoById(current.videoId);
    return;
  }
  if(desiredPaused){player.pauseVideo();}
  else if(player.getPlayerState()!==YT.PlayerState.PLAYING&&player.getPlayerState()!==YT.PlayerState.BUFFERING){
    player.playVideo();
  }
}
function init(){
  if(player)return;
  if(!window.YT?.Player){
    if(!document.querySelector('script[data-strimko-yt]')){
      const s=document.createElement('script');s.dataset.strimkoYt='1';s.src='https://www.youtube.com/iframe_api';document.head.append(s);
    }
    window.onYouTubeIframeAPIReady=init;
    return;
  }
  player=new YT.Player('player',{width:'1920',height:'1080',playerVars:{autoplay:1,controls:0,playsinline:1},events:{
    onReady:()=>{ready=true;sync();},
    onStateChange:e=>{
      if(e.data===YT.PlayerState.ENDED)$('overlayNotice').textContent='Трек завершён · переключение очереди';
      if(e.data===YT.PlayerState.PLAYING&&desiredPaused)player.pauseVideo();
    },
    onError:e=>{$('overlayNotice').textContent='Ошибка YouTube: '+e.data;}
  }});
}
db.ref('tracks/publicSettings/volume').on('value',s=>{
  volume=Math.max(0,Math.min(100,Number(s.val()??80)));
  if(ready&&player)player.setVolume(volume);
});
db.ref('tracks/active').on('value',s=>{
  const v=s.val();
  current=v||null;
  desiredPaused=!!v?.paused;
  $('nowPlaying').hidden=!v;
  if(v){$('nowTitle').textContent=v.title||'Трек';$('nowBy').textContent=v.displayName||'';}
  sync();
});
init();
})();
