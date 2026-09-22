(()=>{const $=s=>document.querySelector(s);const api=async(url,opt)=>{const r=await fetch(url,opt);let d={};const raw=await r.text();try{d=raw?JSON.parse(raw):{}}catch{}if(!r.ok)throw Error(d.error||("Error "+r.status));return d};const status=m=>{const e=$("#ytStatus");if(e)e.textContent=m};const esc=s=>String(s||"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
async function analyze(){const url=($("#ytUrl")?.value||"").trim();if(!url){status("Pega primero el enlace de YouTube.");return}const b=$("#ytAnalyze");if(b)b.disabled=true;status("🔎 Analizando la referencia de YouTube…");try{const d=await api("/api/youtube-info?url="+encodeURIComponent(url));const m=$("#ytMeta");if(m)m.textContent="✓ "+d.title+(d.author?" · "+d.author:"")+" · Referencia reconocida.";const v=$("#ytVisualPrompt");if(v&&!v.value)v.value="Paisaje relajante inspirado en: "+d.title;status("✓ Referencia reconocida. Ya puedes crear las 3 versiones.")}catch(e){status("❌ "+e.message)}finally{if(b)b.disabled=false}}
async function create(){
  const url=($("#ytUrl")?.value||"").trim();
  const visual=(($("#ytVisualPrompt")?.value||"").trim()||"paisaje relajante inspirado en el contenido del vídeo");
  if(!url){status("Pega primero el enlace de YouTube.");return}
  const b=$("#ytGenerate");if(b)b.disabled=true;
  const result=$("#ytResult");if(result)result.innerHTML="";
  try{
    status("🔎 Analizando la referencia de YouTube…");
    const info=await api("/api/youtube-info?url="+encodeURIComponent(url));

    const sourceContext=[
      "REFERENCIA REAL DEL VÍDEO",
      "Título: "+info.title,
      info.author?"Canal/artista: "+info.author:"",
      info.description?"Descripción real: "+info.description:"",
      info.keywords?"Palabras clave: "+info.keywords:"",
      "No te bases únicamente en el título: usa toda la información disponible para identificar tema, lugar, época, actividad, clima, objetos, emoción y ambiente del vídeo."
    ].filter(Boolean).join(". ");

    const visualTheme=[
      sourceContext,
      "Genera una FAMILIA VISUAL COHERENTE de tres escenas para el mismo vídeo.",
      "Las tres imágenes deben representar EXACTAMENTE el mismo lugar, sujeto principal, época, clima, paleta ambiental y situación descritos por la referencia.",
      "NO cambies el tema entre versiones. No conviertas una escena en otra actividad o paisaje.",
      "Las diferencias permitidas son únicamente encuadre, distancia de cámara, composición, hora/luz ligeramente distinta y perspectiva.",
      visual,
      "Imágenes originales, sin texto, sin logos y sin personas salvo que sean esenciales para el contenido."
    ].join(". ").slice(0,700);

    const musicPrompt=[
      sourceContext,
      "Crea música instrumental original específicamente inspirada en el contenido real de esta referencia.",
      "La música debe corresponder a su lugar, actividad, época, clima, emoción, ambiente, instrumentos y estilo cuando estén indicados.",
      "No generes una pista genérica de naturaleza si la referencia trata de otro tema.",
      "Haz cuatro interpretaciones claramente diferentes pero todas fieles a la misma referencia.",
      "No copies ninguna melodía, grabación ni audio del vídeo.",
      "La música debe ser profesional y adecuada para acompañar un vídeo largo."
    ].join(". ").slice(0,700);

    status("🤖 Usando exactamente la IA de Crear IA para generar imágenes y música…");

    const [imageData,musicStart]=await Promise.all([
      api("/api/ai-images",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({theme:visualTheme})
      }),
      api("/api/ai-music",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({musicPrompt:musicPrompt})
      })
    ]);

    const images=(imageData.images||[]).slice(0,3);
    if(images.length<3)throw Error("La IA de Crear IA no generó 3 imágenes válidas.");
    let musicData=null;
    for(let i=0;i<480;i++){
      musicData=await api("/api/ai-options-status");
      if(String(musicData.generationId||"")===String(musicStart.generationId||"") && (musicData.musicReady||((musicData.music||[]).length>=4)))break;
      if(musicData.musicErrors?.length && !musicData.musicPreparing)throw Error(musicData.musicErrors.join(" | "));
      status("🎵 La IA de Crear IA está generando la música… "+(musicData.music?.length||0)+"/4 versiones");
      await new Promise(r=>setTimeout(r,1000));
    }
    if(!musicData||String(musicData.generationId||"")!==String(musicStart.generationId||"")||!musicData.musicReady)throw Error("La IA de Crear IA no terminó las 4 versiones musicales.");
    const music=(musicData.music||[]).slice(0,3);
    if(music.length<3)throw Error("La IA de Crear IA no generó 3 pistas musicales válidas.");

    status("🎬 Creando exactamente 3 vídeos: imagen IA + música IA emparejadas…");
    const started=await api("/api/video-preview-options",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        musicPrompt:musicPrompt,
        images:images.map(x=>x.url),
        music:music.map(x=>x.url)
      })
    });

    let d=null;
    for(let i=0;i<600;i++){
      await new Promise(r=>setTimeout(r,1000));
      d=await api("/api/video-preview-options-status?jobId="+encodeURIComponent(started.jobId));
      status("🎬 Generando vídeos IA… "+(d.progress||0)+"% · "+(d.stage||"preparando"));
      if(d.status==="succeeded")break;
      if(d.status==="failed")throw Error(d.error||"No se pudieron crear los vídeos.");
    }
    if(!d||d.status!=="succeeded")throw Error("La generación de los tres vídeos está tardando demasiado.");
    const options=d.results||[];
    if(options.length!==3)throw Error("No se generaron los 3 vídeos completos.");

    result.classList.remove("hidden");
    result.innerHTML='<div class="builder"><div class="builder-head"><div><div><h3>🎬 3 versiones IA listas</h3><p>'+esc(info.title||"Referencia de YouTube")+'</p></div></div><span class="badge">3 × 60 S · MP4 · 720p</span></div><div class="ai-music-list">'+options.map((x,i)=>'<div class="ai-track"><div><b>🎬 Vídeo '+(i+1)+'</b><small>60 segundos · imagen IA + música IA '+x.variant+'</small></div><div class="ai-track-actions"><video controls playsinline preload="metadata" style="width:100%;max-width:520px;border-radius:12px" src="'+x.url+'"></video><button type="button" class="primary yt-select" data-yt-select="'+i+'">Seleccionar este vídeo</button></div></div>').join("")+'</div><div class="mixer-duration" style="margin-top:18px"><label>Duración final <select id="ytFinalHours"><option value="1">1 hora</option><option value="2">2 horas</option><option value="3">3 horas</option><option value="4">4 horas</option><option value="6">6 horas</option><option value="8">8 horas</option><option value="12">12 horas</option><option value="24">24 horas</option></select></label><button type="button" id="ytCreateFinal" class="primary" disabled>🎬 Crear vídeo final</button></div></div>';

    result._ytOptions=options;
    result._ytImages=images;
    result._ytMusic=music;
    result._ytPrompt=musicPrompt;
    result._ytSelected=null;
    status("✓ Las 3 versiones usan directamente la IA de Crear IA y están emparejadas con la referencia.");
    result.scrollIntoView({behavior:"smooth",block:"nearest"});
  }catch(e){
    status("❌ "+e.message);
  }finally{
    if(b)b.disabled=false;
  }
}
document.addEventListener("click",async e=>{if(e.target.closest("#ytAnalyze"))return analyze();if(e.target.closest("#ytGenerate"))return create();const s=e.target.closest("[data-yt-select]");if(s){const r=$("#ytResult"),o=r?._ytOptions;if(!r||!o)return;const i=Number(s.dataset.ytSelect),chosen=o[i];r._ytSelected=chosen;r.querySelectorAll(".yt-select").forEach(x=>{x.classList.remove("selected");x.textContent="Seleccionar este vídeo"});s.classList.add("selected");s.textContent="✓ Seleccionado";const f=$("#ytCreateFinal");if(f)f.disabled=false;status("✓ Vídeo "+(i+1)+" seleccionado. Ahora elige la duración final.");return}if(e.target.closest("#ytCreateFinal")){const r=$("#ytResult"),chosen=r?._ytSelected;if(!r||!chosen)return;const h=Number($("#ytFinalHours")?.value||1),image=r._ytImages?.[chosen.variant-1],music=r._ytMusic?.[chosen.variant-1],prompt=r._ytPrompt,b=$("#ytCreateFinal");if(b)b.disabled=true;try{status("🎬 Creando el vídeo final de "+h+" hora"+(h===1?"":"s")+"…");const d=await api("/api/video-preview-final",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({image:image.url,music:music?.url||"",musicPrompt:prompt,variant:chosen.variant,durationHours:h})});r.innerHTML='<div class="builder"><div class="builder-head"><div><div><h3>✓ Vídeo final listo</h3><p>Versión seleccionada</p></div></div><span class="badge">MP4 · 1080p · '+h+' HORA'+(h===1?"":"S")+'</span></div><video controls playsinline style="width:100%;max-height:520px;border-radius:16px" src="'+d.url+'"></video><div class="builder-bottom"><span>Vídeo generado a partir de la versión seleccionada.</span><a class="download" href="'+d.url+'" download>↓ Descargar MP4</a></div></div>';status("✓ Vídeo final creado.");r.scrollIntoView({behavior:"smooth",block:"nearest"})}catch(e){status("❌ "+e.message);if(b)b.disabled=false}}});})();