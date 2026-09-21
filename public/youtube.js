(()=>{
  const $=s=>document.querySelector(s);
  const api=async(url,opt)=>{
    const r=await fetch(url,opt);
    let d={}; const raw=await r.text();
    try{d=raw?JSON.parse(raw):{}}catch{}
    if(!r.ok) throw Error(d.error||("Error "+r.status));
    return d;
  };
  const status=msg=>{const el=$("#ytStatus");if(el)el.textContent=msg;};
  const escapeHtml=s=>String(s||"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

  async function analyze(){
    const url=($("#ytUrl")?.value||"").trim();
    if(!url){status("Pega primero el enlace de YouTube.");return;}
    const btn=$("#ytAnalyze");if(btn)btn.disabled=true;
    status("🔎 Analizando la referencia de YouTube…");
    try{
      const d=await api("/api/youtube-info?url="+encodeURIComponent(url));
      const meta=$("#ytMeta");
      if(meta)meta.textContent="✓ "+d.title+(d.author?" · "+d.author:"")+" · Referencia reconocida.";
      const visual=$("#ytVisualPrompt");
      if(visual&&!visual.value)visual.value="Paisaje relajante inspirado en: "+d.title;
      status("✓ Referencia reconocida. La IA usará esta referencia para crear una música original y el paisaje.");
    }catch(e){status("❌ "+e.message);}
    finally{if(btn)btn.disabled=false;}
  }

  async function waitMusic(){
    for(let i=0;i<180;i++){
      const d=await api("/api/ai-options-status");
      if(d.music?.length){
        return d.music[0];
      }
      if(d.musicErrors?.length)throw Error(d.musicErrors.join(" | "));
      await new Promise(r=>setTimeout(r,2000));
    }
    throw Error("La generación de música IA está tardando demasiado.");
  }

  async function create(){
    const url=($("#ytUrl")?.value||"").trim();
    const visual=(($("#ytVisualPrompt")?.value||"").trim()||"paisaje natural relajante, luz cinematográfica suave, atmósfera tranquila");
    if(!url){status("Pega primero el enlace de YouTube.");return;}
    const btn=$("#ytGenerate");if(btn)btn.disabled=true;
    const result=$("#ytResult");if(result)result.innerHTML="";
    try{
      status("🔎 Analizando la referencia de YouTube…");
      const info=await api("/api/youtube-info?url="+encodeURIComponent(url));

      const musicPrompt=[
        "Referencia de YouTube: "+info.title,
        info.author?"Autor/canal: "+info.author:"",
        "Crea una composición instrumental original inspirada en el ambiente, tema y sensación sugeridos por esta referencia.",
        "No copies ninguna melodía, grabación ni audio del vídeo.",
        "La música debe ser profesional, relajante y adecuada para acompañar un paisaje de larga duración.",
        visual
      ].filter(Boolean).join(". ").slice(0,700);

      status("🎵 La IA está creando una música original guiada por la referencia de YouTube…");
      await api("/api/ai-music",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({musicPrompt})
      });
      const preview=await waitMusic();

      status("🎚️ Creando una versión larga y continua de la música IA…");
      const music=await api("/api/generate-selected-long-music",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({music:preview.url,durationHours:1,musicPrompt})
      });

      status("🤖 Generando el paisaje IA con la configuración actual…");
      const images=await api("/api/ai-images",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({theme:visual})
      });
      const image=images.images?.[0];
      if(!image?.url)throw Error("La IA no devolvió ningún paisaje.");

      status("🎬 Montando el vídeo de 1 hora con la música creada por IA…");
      const video=await api("/api/generate-video",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({image:image.url,music:music.url,durationHours:1})
      });

      if(result){
        result.classList.remove("hidden");
        result.innerHTML='<div class="builder"><div class="builder-head"><div><div><h3>✓ Vídeo listo</h3><p>'+escapeHtml(info.title||"Referencia de YouTube")+'</p></div></div><span class="badge">MP4 · 1080p · 1 HORA</span></div><video controls playsinline style="width:100%;max-height:520px;border-radius:16px" src="'+video.url+'"></video><div class="builder-bottom"><span>Audio original generado por la IA a partir de la referencia.</span><a class="download" href="'+video.url+'" download>↓ Descargar MP4</a></div></div>';
        result.scrollIntoView({behavior:"smooth",block:"nearest"});
      }
      status("✓ Vídeo creado con música original generada por IA a partir de la referencia.");
    }catch(e){status("❌ "+e.message);}
    finally{if(btn)btn.disabled=false;}
  }

  document.addEventListener("click",e=>{
    if(e.target.closest("#ytAnalyze"))analyze();
    if(e.target.closest("#ytGenerate"))create();
  });
})();
