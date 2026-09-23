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
 const g=document.querySelector("#ytGeneratePreview"),s=document.querySelector("#ytPublishStatus"),previewBox=document.querySelector("#ytPreviewBox"),video=document.querySelector("#ytPreviewVideo"),confirmBox=document.querySelector("#ytUploadConfirm"),confirmBtn=document.querySelector("#ytConfirmUpload"),uploadStatus=document.querySelector("#ytUploadStatus");
 if(g)g.onclick=async()=>{
  g.disabled=true;s.textContent="🟡 Generando vídeo…";previewBox?.classList.add("hidden");confirmBox?.classList.add("hidden");
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
   const title=document.querySelector("#ytTitle"),opts=document.querySelector("#ytTitleOptions"),desc=document.querySelector("#ytDescription"),privacy=document.querySelector("#ytPrivacy");\n   if(title)title.value=done.title||"RelaxScape · Naturaleza y relajación";\n   if(opts){opts.innerHTML="";(done.titleOptions||[done.title||"RelaxScape · Naturaleza y relajación"]).forEach((v,i)=>{const o=document.createElement("option");o.value=v;o.textContent=v;if(i===0)o.selected=true;opts.appendChild(o)});opts.onchange=()=>{if(title)title.value=opts.value}}\n   if(desc)desc.value=done.description||"";
   previewBox?.classList.remove("hidden");confirmBox?.classList.remove("hidden");s.textContent="🟢 Vídeo generado. Revísalo antes de publicar.";window.__ytPendingVideo=done.name;
  }catch(e){s.textContent="🔴 "+e.message}finally{g.disabled=false}
 };
 if(confirmBtn)confirmBtn.onclick=async()=>{if(!window.__ytPendingVideo)return;confirmBtn.disabled=true;if(uploadStatus)uploadStatus.textContent="Subiendo el vídeo a YouTube…";try{const r=await fetch("/api/youtube/publish-existing",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",body:JSON.stringify({name:window.__ytPendingVideo,title:document.querySelector("#ytTitle")?.value,description:document.querySelector("#ytDescription")?.value,tags:["música relajante","relajación","meditación","naturaleza","sleep","ambient"],privacyStatus:document.querySelector("#ytPrivacy")?.value||"public"})});const x=await r.json();if(!r.ok)throw Error(x.error||"No se pudo subir el vídeo");if(uploadStatus)uploadStatus.textContent="🟢 Vídeo publicado correctamente en YouTube.";confirmBtn.textContent="✓ Subido a YouTube";}catch(e){if(uploadStatus)uploadStatus.textContent="🔴 "+e.message;confirmBtn.disabled=false}};refreshYouTubePublishStatus();
});
