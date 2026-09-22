(()=>{const $=s=>document.querySelector(s);const api=async(url,opt)=>{const r=await fetch(url,opt);let d={};const raw=await r.text();try{d=raw?JSON.parse(raw):{}}catch{}if(!r.ok)throw Error(d.error||("Error "+r.status));return d};const status=m=>{const e=$("#ytStatus");if(e)e.textContent=m};const esc=s=>String(s||"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
function parseYouTubeId(raw){
  try{
    const normalized=/^https?:\/\//i.test(raw)?raw:"https://"+raw;
    const u=new URL(normalized);
    const host=u.hostname.toLowerCase().replace(/^www\./,"");
    if(!["youtube.com","m.youtube.com","music.youtube.com","youtube-nocookie.com","youtu.be"].includes(host))return "";
    let id=host==="youtu.be"?(u.pathname.split("/").filter(Boolean)[0]||""):(u.searchParams.get("v")||"");
    if(!id){
      const m=u.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/i);
      id=m?.[1]||"";
    }
    return decodeURIComponent(String(id||"")).split(/[?&#]/)[0].trim().match(/^[A-Za-z0-9_-]{11}$/)?.[0]||"";
  }catch{return ""}
}
async function getYouTubeInfo(raw){
  try{return await api("/api/youtube-info?url="+encodeURIComponent(raw));}
  catch(serverError){
    const id=parseYouTubeId(raw);
    if(!id)throw serverError;
    try{
      const r=await fetch("https://www.youtube.com/oembed?url="+encodeURIComponent("https://www.youtube.com/watch?v="+id)+"&format=json");
      const d=await r.json();
      return {title:d.title||("Vídeo de YouTube · "+id),author:d.author_name||"",thumbnail:d.thumbnail_url||("https://i.ytimg.com/vi/"+id+"/hqdefault.jpg"),description:"",keywords:"",category:"",duration:"",sourceUrl:raw,videoId:id,audioAnalysisAvailable:false};
    }catch{}
    return {title:"Vídeo de YouTube · "+id,author:"",thumbnail:"https://i.ytimg.com/vi/"+id+"/hqdefault.jpg",description:"",keywords:"",category:"",duration:"",sourceUrl:raw,videoId:id,audioAnalysisAvailable:false};
  }
}
async function analyze(){const url=($("#ytUrl")?.value||"").trim();if(!url){status("Pega primero el enlace de YouTube.");return}const b=$("#ytAnalyze");if(b)b.disabled=true;status("🔎 Analizando la referencia de YouTube…");try{const d=await getYouTubeInfo(url);const m=$("#ytMeta");if(m)m.textContent="✓ "+d.title+(d.author?" · "+d.author:"")+" · Referencia reconocida.";const v=$("#ytVisualPrompt");if(v&&!v.value)v.value="Representación visual fiel al contenido real del vídeo: "+d.title+". No asumir que es un paisaje; respetar exactamente lugar, sujeto, actividad, época, objetos, clima y ambiente descritos en la referencia.";status("✓ Referencia reconocida. Se generará una única versión en máxima calidad.")}catch(e){status("❌ "+e.message)}finally{if(b)b.disabled=false}}
async function create(){
  const url=($("#ytUrl")?.value||"").trim();
  const visual=(($("#ytVisualPrompt")?.value||"").trim()||"Representación visual fiel al contenido real del vídeo");
  if(!url){status("Pega primero el enlace de YouTube.");return}
  const b=$("#ytGenerate");if(b)b.disabled=true;
  const result=$("#ytResult");if(result)result.innerHTML="";
  try{
    status("🔎 Analizando a fondo la referencia de YouTube…");
    const info=await getYouTubeInfo(url);

    const sourceContext=[
      "REFERENCIA REAL DEL VÍDEO DE YOUTUBE",
      "Título exacto: "+info.title,
      info.author?"Canal/artista: "+info.author:"",
      info.category?"Categoría: "+info.category:"",
      info.duration?"Duración original: "+info.duration+" segundos":"",
      info.description?"Descripción completa disponible: "+info.description:"",
      info.keywords?"Palabras clave y etiquetas: "+info.keywords:"",
      "La referencia es la fuente principal. Identifica y conserva el tema concreto, lugar, sujeto, actividad, objetos, época, clima, iluminación, emoción, género, instrumentación y ambiente.",
      "No inventes un paisaje si el vídeo no es de paisaje. No conviertas música, una actuación, una ciudad, un interior, un vehículo, una persona u otra temática en naturaleza genérica."
    ].filter(Boolean).join(". ");

    const visualTheme=[
      sourceContext,
      "Genera UNA ÚNICA imagen original de máxima calidad para representar este mismo vídeo.",
      "La imagen debe ser una representación directa y específica del contenido descrito por la referencia, no una interpretación genérica de relajación.",
      "Respeta exactamente el sujeto principal, lugar, actividad, objetos, época, clima, iluminación y atmósfera cuando estén disponibles.",
      "Composición cinematográfica 16:9, fotorealista, detallada, profesional, sin texto añadido, sin logos y sin elementos que contradigan la referencia.",
      visual
    ].join(". ").slice(0,700);

    const musicPrompt=[
      sourceContext,
      "Crea UNA ÚNICA pista instrumental original específicamente inspirada en esta referencia.",
      "La identidad musical debe seguir el género, instrumentación, tempo aproximado, energía, época, ambiente y emoción que puedan inferirse de la información real del vídeo.",
      "Si se mencionan instrumentos concretos, úsalos. Si se menciona un género concreto, respeta su lenguaje musical. Si no hay información suficiente para identificar un instrumento, no inventes uno solo por usar un preset de relajación.",
      "No conviertas automáticamente la referencia en ambient genérico: la búsqueda y los metadatos son la fuente de verdad.",
      "La pista debe ser original y no copiar melodías, grabaciones, voces ni audio del vídeo de YouTube.",
      "Producción profesional, mezcla limpia, estéreo, 48 kHz y 320 kbps en el archivo generado."
    ].join(". ").slice(0,700);

    status("🖼️🎵 Generando una sola imagen + una sola pista, dedicando todos los recursos a la versión de mayor calidad…");

    const [imageData,musicStart]=await Promise.all([
      api("/api/ai-images",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({theme:visualTheme,count:1})
      }),
      api("/api/ai-music",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({musicPrompt:musicPrompt,count:1})
      })
    ]);

    const images=(imageData.images||[]).slice(0,1);
    if(images.length!==1)throw Error("La IA no generó una imagen válida para la referencia.");

    let musicData=null;
    for(let i=0;i<480;i++){
      musicData=await api("/api/ai-options-status");
      if(String(musicData.generationId||"")===String(musicStart.generationId||"") && (musicData.musicReady||((musicData.music||[]).length>=1)))break;
      if(musicData.musicErrors?.length && !musicData.musicPreparing)throw Error(musicData.musicErrors.join(" | "));
      status("🎵 Generando la pista específica de la referencia…");
      await new Promise(r=>setTimeout(r,1000));
    }
    if(!musicData||String(musicData.generationId||"")!==String(musicStart.generationId||"")||!musicData.musicReady)throw Error("La IA musical no terminó la pista de la referencia.");
    const music=(musicData.music||[]).slice(0,1);
    if(music.length!==1)throw Error("La IA no generó una pista musical válida.");

    status("🎬 Creando la única vista previa en 1080p…");
    const started=await api("/api/video-preview-options",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        musicPrompt:musicPrompt,
        images:[images[0].url],
        music:[music[0].url]
      })
    });

    let d=null;
    for(let i=0;i<600;i++){
      await new Promise(r=>setTimeout(r,1000));
      d=await api("/api/video-preview-options-status?jobId="+encodeURIComponent(started.jobId));
      status("🎬 Generando vídeo IA… "+(d.progress||0)+"% · "+(d.stage||"preparando"));
      if(d.status==="succeeded")break;
      if(d.status==="failed")throw Error(d.error||"No se pudo crear el vídeo.");
    }
    if(!d||d.status!=="succeeded")throw Error("La generación del vídeo está tardando demasiado.");
    const options=d.results||[];
    if(options.length!==1)throw Error("No se generó la versión completa.");

    const option=options[0];
    result.classList.remove("hidden");
    result.innerHTML='<div class="builder"><div class="builder-head"><div><div><h3>🎬 Versión IA de máxima calidad</h3><p>'+esc(info.title||"Referencia de YouTube")+'</p></div></div><span class="badge">1 × 60 S · MP4 · 1080p</span></div><div class="ai-track"><div><b>🎬 Versión única</b><small>60 segundos · imagen IA + música IA · 1080p</small></div><div class="ai-track-actions"><video controls playsinline preload="metadata" style="width:100%;max-width:720px;border-radius:12px" src="'+option.url+'"></video></div></div><div class="mixer-duration" style="margin-top:18px"><label>Duración final <select id="ytFinalHours"><option value="1">1 hora</option><option value="2">2 horas</option><option value="3">3 horas</option><option value="4">4 horas</option><option value="6">6 horas</option><option value="8">8 horas</option><option value="12">12 horas</option><option value="24">24 horas</option></select></label><button type="button" id="ytCreateFinal" class="primary">🎬 Crear vídeo final</button></div></div>';

    result._ytOptions=options;
    result._ytImages=images;
    result._ytMusic=music;
    result._ytPrompt=musicPrompt;
    result._ytSelected=option;
    status("✓ Versión única lista: imagen y música generadas específicamente a partir de la referencia.");
    result.scrollIntoView({behavior:"smooth",block:"nearest"});
  }catch(e){
    status("❌ "+e.message);
  }finally{
    if(b)b.disabled=false;
  }
}document.addEventListener("click",async e=>{
  if(e.target.closest("#ytAnalyze"))return analyze();
  if(e.target.closest("#ytGenerate"))return create();
  if(e.target.closest("#ytCreateFinal")){
    const r=$("#ytResult"),chosen=r?._ytSelected;
    if(!r||!chosen)return;
    const h=Number($("#ytFinalHours")?.value||1),image=r._ytImages?.[0],music=r._ytMusic?.[0],prompt=r._ytPrompt,b=$("#ytCreateFinal");
    if(b)b.disabled=true;
    try{
      status("🎬 Creando el vídeo final de "+h+" hora"+(h===1?"":"s")+" en 1080p…");
      const d=await api("/api/video-preview-final",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({image:image?.url||"",music:music?.url||"",musicPrompt:prompt,variant:1,durationHours:h})
      });
      r.innerHTML='<div class="builder"><div class="builder-head"><div><div><h3>✓ Vídeo final listo</h3><p>Versión única · referencia de YouTube</p></div></div><span class="badge">MP4 · 1080p · '+h+' HORA'+(h===1?"":"S")+'</span></div><video controls playsinline style="width:100%;max-height:520px;border-radius:16px" src="'+d.url+'"></video><div class="builder-bottom"><span>Vídeo generado a partir de la única versión IA.</span><a class="download" href="'+d.url+'" download>↓ Descargar MP4</a></div></div>';
      status("✓ Vídeo final creado.");
      r.scrollIntoView({behavior:"smooth",block:"nearest"})
    }catch(e){
      status("❌ "+e.message);
      if(b)b.disabled=false
    }
  }
});