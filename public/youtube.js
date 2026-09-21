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

  async function analyze(){
    const url=($("#ytUrl")?.value||"").trim();
    if(!url){status("Pega primero el enlace de YouTube.");return;}
    const btn=$("#ytAnalyze"); if(btn)btn.disabled=true;
    status("🔎 Analizando el enlace de YouTube…");
    try{
      const d=await api("/api/youtube-info?url="+encodeURIComponent(url));
      const meta=$("#ytMeta");
      if(meta)meta.textContent="✓ "+d.title+(d.author?" · "+d.author:"")+" · Enlace reconocido. Ahora sube el audio que tienes derecho a utilizar.";
      const visual=$("#ytVisualPrompt");
      if(visual&&!visual.value)visual.value="Paisaje relajante inspirado en el ambiente de: "+d.title;
      status("✓ Vídeo reconocido. Sube el audio original y pulsa «Crear vídeo».");
    }catch(e){
      status("❌ "+e.message);
    }finally{if(btn)btn.disabled=false;}
  }

  async function create(){
    const url=($("#ytUrl")?.value||"").trim();
    const file=$("#ytAudio")?.files?.[0];
    const visual=(($("#ytVisualPrompt")?.value||"").trim()||"paisaje natural relajante, luz cinematográfica suave, atmósfera tranquila");
    if(!url){status("Pega primero el enlace de YouTube.");return;}
    if(!file){status("Sube el archivo de audio que tienes derecho a utilizar.");return;}

    const btn=$("#ytGenerate"); if(btn)btn.disabled=true;
    const result=$("#ytResult"); if(result)result.innerHTML="";
    try{
      status("🔎 Comprobando el enlace de YouTube…");
      const info=await api("/api/youtube-info?url="+encodeURIComponent(url));

      status("🤖 Generando el paisaje IA con la configuración actual…");
      const images=await api("/api/ai-images",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({theme:visual})
      });
      const image=images.images?.[0];
      if(!image?.url)throw Error("La IA no devolvió ningún paisaje.");

      status("🎧 Subiendo el audio original…");
      const form=new FormData();
      form.append("music",file,file.name);
      const uploaded=await api("/api/upload/music",{method:"POST",body:form});

      status("🎬 Montando el vídeo de 1 hora con el paisaje IA y tu audio…");
      const video=await api("/api/generate-video",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({image:image.url,music:uploaded.url,durationHours:1})
      });

      if(result){
        result.classList.remove("hidden");
        result.innerHTML='<div class="builder"><div class="builder-head"><div><div><h3>✓ Vídeo listo</h3><p>'+escapeHtml(info.title||"Vídeo de YouTube")+'</p></div></div><span class="badge">MP4 · 1080p · 1 HORA</span></div><video controls playsinline style="width:100%;max-height:520px;border-radius:16px" src="'+video.url+'"></video><div class="builder-bottom"><span>Audio conservado del archivo que subiste.</span><a class="download" href="'+video.url+'" download>↓ Descargar MP4</a></div></div>';
        result.scrollIntoView({behavior:"smooth",block:"nearest"});
      }
      status("✓ Vídeo creado correctamente.");
    }catch(e){
      status("❌ "+e.message);
    }finally{if(btn)btn.disabled=false;}
  }

  function escapeHtml(s){
    return String(s||"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  }

  document.addEventListener("click",e=>{
    if(e.target.closest("#ytAnalyze")) analyze();
    if(e.target.closest("#ytGenerate")) create();
  });
})();
