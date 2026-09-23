async function refreshYouTubePublishStatus(){
 const s=document.querySelector("#ytConnectionStatus"),b=document.querySelector("#ytConnectionBadge"),c=document.querySelector("#ytConnect"),d=document.querySelector("#ytDisconnect"),p=document.querySelector("#ytPublishNow");
 if(!s)return;
 try{
  const r=await fetch("/api/youtube/status"),x=await r.json();
  if(!x.configured){s.textContent="Faltan las credenciales OAuth de Google en Render.";b.textContent="No configurado";c.disabled=true;p.disabled=true;return}
  if(x.connected){s.textContent="✓ Canal conectado: "+(x.channel?.title||"YouTube");b.textContent="Conectado";c.classList.add("hidden");d.classList.remove("hidden");p.disabled=false}
  else{s.textContent=x.error||"No hay ningún canal conectado.";b.textContent="Sin vincular";c.classList.remove("hidden");d.classList.add("hidden");p.disabled=true}
 }catch(e){s.textContent="No se pudo comprobar YouTube: "+e.message}
}
document.addEventListener("DOMContentLoaded",()=>{
 const c=document.querySelector("#ytConnect"),d=document.querySelector("#ytDisconnect"),p=document.querySelector("#ytPublishNow"),s=document.querySelector("#ytPublishStatus");
 if(c)c.onclick=()=>{window.location.href="/api/youtube/connect"};
 if(d)d.onclick=async()=>{await fetch("/api/youtube/disconnect",{method:"POST"});refreshYouTubePublishStatus()};
 if(p)p.onclick=async()=>{
  p.disabled=true;s.textContent="🟡 Generando el vídeo y subiéndolo a YouTube…";
  try{
   const r=await fetch("/api/youtube/daily-publish",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({durationMinutes:Number(document.querySelector("#ytDailyDuration")?.value||60)})});
   const x=await r.json();if(!r.ok)throw Error(x.error||"No se pudo publicar");
   s.innerHTML='🟢 Publicado en YouTube: <a href="'+x.result.url+'" target="_blank" rel="noopener">Abrir vídeo</a>';
  }catch(e){s.textContent="🔴 "+e.message}finally{p.disabled=false}
 };
 refreshYouTubePublishStatus();
 if(new URLSearchParams(location.search).get("youtube")==="connected"){history.replaceState({},document.title,location.pathname);setTimeout(refreshYouTubePublishStatus,500)}
});