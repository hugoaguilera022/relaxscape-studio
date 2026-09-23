async function refreshYouTubePublishStatus(){
 const s=document.querySelector("#ytConnectionStatus"),b=document.querySelector("#ytConnectionBadge"),g=document.querySelector("#ytGeneratePreview"),info=document.querySelector("#ytAccountInfo"),card=document.querySelector("#ytChannelCard"),avatar=document.querySelector("#ytChannelAvatar"),name=document.querySelector("#ytChannelName"),id=document.querySelector("#ytChannelId");
 if(!s)return;
 try{
  const r=await fetch("/api/youtube/status",{credentials:"same-origin",cache:"no-store"}),x=await r.json();
  if(!x.configured){s.textContent="Faltan las credenciales OAuth de Google en Render.";b.textContent="No configurado";if(g)g.disabled=true;if(card)card.classList.add("hidden");return}
  if(x.connected && x.channel){
   s.textContent="✓ Canal de YouTube vinculado"; if(card)card.classList.remove("hidden"); if(name)name.textContent=x.channel?.title||"Canal de YouTube"; if(id)id.textContent=x.channel?.id?"ID del canal: "+x.channel.id:"Canal reconocido por Google"; if(avatar){avatar.src=x.channel?.thumbnail||"https://www.gstatic.com/youtube/img/branding/youtubelogo/svg/youtubelogo.svg";avatar.onerror=()=>{avatar.style.display="none"}}
   b.textContent="Conectado";
   if(g)g.disabled=false;
   if(info)info.textContent=window.RelaxScapeUser?.email?("Cuenta Google: "+window.RelaxScapeUser.email+". El canal de YouTube se reconoce automáticamente con esta misma sesión."): "Canal de YouTube reconocido automáticamente.";
  }else{
   s.textContent=window.RelaxScapeUser?.email?"Tu cuenta está iniciada, pero YouTube todavía no está autorizado. Cierra sesión y vuelve a iniciar sesión con Google para conceder el acceso a YouTube.":"Inicia sesión en RelaxScape con Google para reconocer automáticamente tu canal.";
   b.textContent="Pendiente"; if(card)card.classList.add("hidden");
   if(g)g.disabled=true;
   if(info)info.textContent="No hay un segundo inicio de sesión: la cuenta de Google de RelaxScape es la cuenta que se utilizará para YouTube.";
  }
 }catch(e){s.textContent="No se pudo comprobar YouTube: "+e.message}
}
document.addEventListener("DOMContentLoaded",()=>{
 const g=document.querySelector("#ytGeneratePreview"),s=document.querySelector("#ytPublishStatus"),previewBox=document.querySelector("#ytPreviewBox"),video=document.querySelector("#ytPreviewVideo");
 if(g)g.onclick=async()=>{
  g.disabled=true;s.textContent="🟡 Generando vídeo…";previewBox?.classList.add("hidden");
  try{
   const r=await fetch("/api/youtube/daily-generate",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",body:JSON.stringify({durationMinutes:Number(document.querySelector("#ytDailyDuration")?.value||60)})});
   const x=await r.json();if(!r.ok)throw Error(x.error||"No se pudo iniciar la generación");
   const jobId=x.result?.jobId;if(!jobId)throw Error("El servidor no devolvió el trabajo de generación.");
   let done=null;
   for(let i=0;i<900;i++){
    const sr=await fetch("/api/youtube/daily-generate-status?jobId="+encodeURIComponent(jobId),{credentials:"same-origin",cache:"no-store"});
    const sx=await sr.json();
    if(sx.status==="succeeded"&&sx.result){done=sx.result;break}
    if(sx.status==="failed")throw Error(sx.error||"La generación del vídeo falló.");
    s.textContent="🟡 "+(sx.message||"Generando vídeo…")+" "+(sx.progress||0)+"%";
    await new Promise(resolve=>setTimeout(resolve,2000));
   }
   if(!done)throw Error("La generación tardó demasiado.");
   if(video){video.src=done.url+"?v="+Date.now();video.load()}
   previewBox?.classList.remove("hidden");s.textContent="🟢 Vídeo generado. Puedes visualizarlo aquí antes de cualquier publicación.";window.__ytPendingVideo=done.name;
  }catch(e){s.textContent="🔴 "+e.message}finally{g.disabled=false}
 };
 refreshYouTubePublishStatus();
});
