async function refreshYouTubePublishStatus(){
 const s=document.querySelector("#ytConnectionStatus"),b=document.querySelector("#ytConnectionBadge"),g=document.querySelector("#ytGeneratePreview"),info=document.querySelector("#ytAccountInfo");
 if(!s)return;
 try{
  const r=await fetch("/api/youtube/status",{credentials:"same-origin",cache:"no-store"}),x=await r.json();
  if(!x.configured){s.textContent="Faltan las credenciales OAuth de Google en Render.";b.textContent="No configurado";if(g)g.disabled=true;return}
  if(x.connected){
   s.textContent="✓ Canal detectado: "+(x.channel?.title||"YouTube");
   b.textContent="Conectado";
   if(g)g.disabled=false;
   if(info)info.textContent=window.RelaxScapeUser?.email?("Cuenta Google: "+window.RelaxScapeUser.email+". El canal de YouTube se reconoce automáticamente con esta misma sesión."): "Canal de YouTube reconocido automáticamente.";
  }else{
   s.textContent=window.RelaxScapeUser?.email?"Tu cuenta está iniciada, pero YouTube todavía no está autorizado. Cierra sesión y vuelve a iniciar sesión con Google para conceder el acceso a YouTube.":"Inicia sesión en RelaxScape con Google para reconocer automáticamente tu canal.";
   b.textContent="Pendiente";
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
   const x=await r.json();if(!r.ok)throw Error(x.error||"No se pudo generar");
   if(video){video.src=x.result.url+"?v="+Date.now();video.load()}
   previewBox?.classList.remove("hidden");s.textContent="🟢 Vídeo generado. Puedes visualizarlo aquí antes de cualquier publicación.";window.__ytPendingVideo=x.result.name;
  }catch(e){s.textContent="🔴 "+e.message}finally{g.disabled=false}
 };
 refreshYouTubePublishStatus();
});
