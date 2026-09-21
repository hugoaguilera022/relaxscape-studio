const S={images:[],music:[],aiImages:[],aiMusic:[],externalMusic:[],selectedExternalMusic:[],aiMixHours:1,videos:[],image:null,music:null,hours:1,schedule:true,musicCategory:"Todas",aiReady:false,aiLoading:false};
const $=s=>document.querySelector(s), $$=s=>document.querySelectorAll(s);
async function api(url,opt){const r=await fetch(url,opt);let d={};let raw="";try{raw=await r.text();d=raw?JSON.parse(raw):{}}catch{};if(!r.ok)throw Error(d.error||`Error ${r.status}${raw?`: ${raw.slice(0,180)}`:""}`);return d}
async function load(){
  try{
    const d=await api("/api/library");
    S.images=d.images||[];
    S.music=d.music||[];
    S.videos=d.videos||[];
    render();
    if(!S.images.length){
      await loadPexels();
    } else {
      renderAICreator();
    }
  }catch(e){
    if($("#builderStatus")) $("#builderStatus").textContent=e.message;
    if($("#aiSelectionStatus")) $("#aiSelectionStatus").textContent=e.message;
  }
}
async function loadPexels(){
  const q=($("#prompt")?.value||"peaceful nature landscape").trim();
  $("#builderStatus").textContent="Buscando 8 paisajes Full HD de Pexels…";
  try{
    const d=await api("/api/pexels-landscapes?query="+encodeURIComponent(q));
    S.images=[...d.images,...S.images];
    S.image=S.image||d.images[0];
    render();
    $("#builderStatus").textContent="Paisajes listos. Elige uno y una pista de música.";
  }catch(e){$("#builderStatus").textContent=e.message}
}
function render(){renderImages();renderMusic();renderVideos();renderAICreator();$("#statVideos").textContent=S.videos.length;update();picker();}
async function ensureAIOptions(){ return; }

async function generateAIImagesOnly(){
  const prompt=(($("#aiImagePrompt").value||"").trim()||"peaceful nature landscape");
  S.aiLoading=true; S.aiImages=[]; S.image=null;
  const status=$("#aiSelectionStatus"), ig=$("#aiImageGrid");
  if(status)status.textContent="🤖 Generando paisajes con IA… esto puede tardar unos segundos.";
  if(ig)ig.innerHTML='<div class="empty">🤖 FLUX está creando tus paisajes a partir de la búsqueda…</div>';
  try{
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),125000);
    let d;
    try{
      d=await api("/api/ai-images",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({theme:prompt}),signal:controller.signal});
    }finally{clearTimeout(timer)}
    S.aiImages=d.images||[];
    if(S.aiImages[0])S.image=S.aiImages[0];
    renderAICreator();
    if(status)status.textContent="✓ "+S.aiImages.length+" paisaje(s) IA generado(s). Elige uno.";
  }catch(e){
    const detail=(e&&e.name==="AbortError")?"La generación IA tardó demasiado.":((e&&e.message)?e.message:"Error desconocido");
    if(status)status.textContent="❌ "+detail;
    if(ig)ig.innerHTML='<div class="empty">No se pudo generar el paisaje IA.<br><small>'+detail+'</small><br><small>Si aparece “HF_TOKEN” o “credits”, revisa la clave de Hugging Face en Render.</small></div>';
  }finally{S.aiLoading=false;renderAICreator()}
}

// Los botones de búsqueda IA están conectados directamente a sus motores independientes.
// Antes estaban en el HTML pero no tenían listener, por eso al pulsarlos no ocurría nada.
function bindAIButtons(){
  const imageBtn=$("#aiSearchImage");
  const loadBtn=$("#aiLoadPhotos");
  const musicBtn=$("#aiSearchMusic");
  if(imageBtn) imageBtn.onclick=generateAIImagesOnly;
  if(loadBtn) loadBtn.onclick=generateAIImagesOnly;
  if(musicBtn) musicBtn.onclick=generateAIMusicOnly;
}

async function generateAIMusicOnly(){
  const prompt=(($("#aiMusicPrompt").value||"").trim()||"piano relaxing ambient");
  S.aiLoading=true; S.aiMusic=[]; S.externalMusic=[]; S.selectedExternalMusic=[]; S.music=null;
  const status=$("#aiSelectionStatus"), mg=$("#aiMusicList");
  if(status)status.textContent="🎵 Creando 3 propuestas musicales de 1 minuto…";
  if(mg)mg.innerHTML='<div class="empty">🎵 Generando 3 propuestas diferentes según tu búsqueda…</div>';
  try{
    const started=await api("/api/music-preview-options",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({musicPrompt:prompt})});
    let d=null;
    for(let i=0;i<120;i++){
      await new Promise(r=>setTimeout(r,700));
      d=await api("/api/music-preview-options-status?jobId="+encodeURIComponent(started.jobId));
      if(status)status.textContent="🎵 Generando propuestas… "+(d.progress||0)+"%";
      if(d.status==="succeeded")break;
      if(d.status==="failed")throw Error(d.error||"No se pudieron crear las propuestas.");
    }
    if(!d||d.status!=="succeeded")throw Error("La generación está tardando demasiado.");
    S.aiMusic=d.results||[];
    if(!S.aiMusic.length)throw Error("No se generaron propuestas musicales.");
    if(status)status.textContent="✓ 3 propuestas listas. Escucha las versiones de 1 minuto y elige una.";
    renderAICreator();
  }catch(e){
    if(status)status.textContent="Error de generación: "+e.message;
    if(mg)mg.innerHTML='<div class="empty">No se pudieron generar las propuestas.<br><small>'+e.message+"</small></div>";
  }finally{S.aiLoading=false;renderAICreator()}
}

async function importExternalMusic(x){
  const local=await api("/api/import-external-music",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
    preview:x.preview,name:x.name,soundId:x.id,sourceUrl:x.sourceUrl,username:x.username,license:x.license
  })});
  return local;
}
async function selectExternalMusic(x){
  const status=$("#aiSelectionStatus");
  if(status)status.textContent="Importando la previa para poder usarla en tu vídeo…";
  try{
    const local=await importExternalMusic(x);
    S.music=local;
    if(status)status.textContent="✓ Previa seleccionada. Ya puedes usarla para crear el vídeo.";
    renderAICreator(); update(); picker();
  }catch(e){
    if(status)status.textContent="No se pudo seleccionar la previa: "+e.message;
  }
}
async function downloadExternalMusic(x){
  const status=$("#aiSelectionStatus");
  if(status)status.textContent="Preparando la descarga de la previa…";
  try{
    const local=await importExternalMusic(x);
    const r=await fetch(local.url,{cache:"no-store"});
    if(!r.ok)throw new Error("No se pudo recuperar el archivo descargado.");
    const blob=await r.blob();
    const href=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=href;
    a.download=local.name||("freesound-"+x.id+".mp3");
    a.style.display="none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(href),3000);
    if(status)status.textContent="✓ Previa descargada.";
  }catch(e){
    if(status)status.textContent="No se pudo descargar la previa: "+e.message;
  }
}

async function addExternalMusicToMix(x){
  if(!x)return;
  if(S.selectedExternalMusic.some(v=>String(v.id)===String(x.id))){
    S.selectedExternalMusic=S.selectedExternalMusic.filter(v=>String(v.id)!==String(x.id));
  }else{
    if(S.selectedExternalMusic.length>=6){
      const status=$("#aiSelectionStatus");
      if(status)status.textContent="Puedes seleccionar hasta 6 sonidos para la mezcla.";
      return;
    }
    S.selectedExternalMusic.push(x);
  }
  renderAICreator();
}
async function createSelectedFreesoundMix(){
  const status=$("#aiSelectionStatus");
  const selected=S.selectedExternalMusic||[];
  if(selected.length<2){
    if(status)status.textContent="Selecciona al menos 2 sonidos en la búsqueda para crear una mezcla.";
    return;
  }
  const btn=$("#createSelectedFreesoundMix");
  if(btn)btn.disabled=true;
  if(status)status.textContent="🎚️ Preparando los "+selected.length+" sonidos seleccionados…";
  try{
    const d=await api("/api/mix-selected-freesound",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        tracks:selected.map(x=>({id:x.id,preview:x.preview,name:x.name,sourceUrl:x.sourceUrl,username:x.username,license:x.license})),
        durationHours:S.aiMixHours
      })
    });
    if(status)status.textContent="🎚️ Creando la mezcla real y preparando una previa de 90 segundos…";
    let job=null;
    for(let n=0;n<240;n++){
      job=await api("/api/mix-selected-freesound-status?jobId="+encodeURIComponent(d.jobId));
      if(job.preview && !S.music){
        S.music={url:job.preview.url,name:job.preview.name,isFreesoundPreview:true,durationHours:S.aiMixHours};
        renderAICreator();update();picker();
        if(status)status.textContent="✓ Previa real de la mezcla lista. La mezcla de "+S.aiMixHours+" hora"+(S.aiMixHours===1?"":"s")+" sigue preparándose en segundo plano.";
      }
      if(job.status==="succeeded"){
        S.music=job.result;
        if(status)status.textContent="✓ Mezcla completa de "+S.aiMixHours+" hora"+(S.aiMixHours===1?"":"s")+" lista. Ya puedes escucharla y usarla en el vídeo.";
        renderAICreator();update();picker();
        break;
      }
      if(job.status==="failed")throw Error(job.error||"No se pudo crear la mezcla.");
      await new Promise(r=>setTimeout(r,3000));
    }
    if(!job || job.status!=="succeeded")throw Error("La creación de la mezcla está tardando demasiado. La previa puede seguir escuchándose mientras termina.");
  }catch(e){
    if(status)status.textContent="No se pudo crear la mezcla: "+e.message;
  }finally{
    const b=$("#createSelectedFreesoundMix"); if(b)b.disabled=false;
  }
}
async function waitForAIMusic(){
  const started=Date.now();
  const timeoutMs=8*60*1000;
  while(Date.now()-started<timeoutMs){
    const d=await api("/api/ai-options-status");
    S.aiMusic=d.music||[];
    renderAICreator();
    if(d.musicReady || S.aiMusic.length>=4){
      if(S.aiMusic[0] && !S.music)S.music=S.aiMusic[0];
      return d;
    }
    if(d.musicErrors?.length && !d.musicPreparing){
      throw Error(d.musicErrors.join(" | "));
    }
    const status=$( "#aiSelectionStatus");
    if(status){
      const count=S.aiMusic.length;
      status.textContent=count
        ? "♫ "+count+"/4 versiones listas. La IA sigue generando las restantes…"
        : "♫ Generando 4 versiones profesionales con IA…";
    }
    await new Promise(r=>setTimeout(r,3000));
  }
  throw Error("La generación musical tardó demasiado. Vuelve a intentarlo.");
}

function escapeHtml(v){return String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]))}
function formatDuration(sec){const s=Math.max(0,Math.round(Number(sec)||0));return Math.floor(s/60)+":"+String(s%60).padStart(2,"0")}
function renderAICreator(){
  const ig=$("#aiImageGrid"),mg=$("#aiMusicList"),mx=$("#aiMixer");
  if(ig){
    ig.innerHTML=S.aiImages.length?S.aiImages.map((x,i)=>'<button class="ai-photo '+(S.image?.url===x.url?"selected":"")+'" data-url="'+x.url+'" data-name="'+x.name+'"><img src="'+x.url+'" alt="Paisaje IA '+(i+1)+'"><span>Opción IA '+(i+1)+' · 2K</span></button>').join(""):'<div class="empty">✨ Generando opciones IA…</div>';
    $$("#aiImageGrid .ai-photo").forEach(e=>e.onclick=()=>{S.image={url:e.dataset.url,name:e.dataset.name};renderAICreator()});
  }
  if(mg){
    if(S.externalMusic.length){
      mg.innerHTML=S.externalMusic.map((x,i)=>{
        const selected=S.selectedExternalMusic.some(v=>String(v.id)===String(x.id));
        return '<div class="ai-track '+(selected?"selected":"")+'" data-external-id="'+x.id+'"><div><b>♫ '+escapeHtml(x.name)+'</b><small>Freesound · '+escapeHtml(x.username||"")+' · '+escapeHtml(x.license||"")+' · '+formatDuration(x.duration)+'</small></div><div class="ai-track-actions"><audio controls preload="metadata" src="'+x.preview+'"></audio><button type="button" class="mix-select '+(selected?"selected":"")+'" data-select-external="'+x.id+'">'+(selected?"✓ En la mezcla":"＋ Añadir a mezcla")+'</button><button type="button" class="preview-download" data-download-external="'+x.id+'">↓ Descargar previa</button><a class="preview-download" href="'+x.sourceUrl+'" target="_blank" rel="noopener">↗ Ver fuente</a></div></div>';
      }).join("");
      $$("#aiMusicList .ai-track").forEach(e=>e.onclick=ev=>{
        if(ev.target.tagName==="AUDIO" || ev.target.tagName==="A" || ev.target.closest("[data-download-external]") || ev.target.closest("[data-select-external]"))return;
        const x=S.externalMusic.find(v=>String(v.id)===String(e.dataset.externalId));
        if(x)selectExternalMusic(x);
      });
      $$("#aiMusicList [data-select-external]").forEach(b=>b.onclick=ev=>{
        ev.stopPropagation();
        const x=S.externalMusic.find(v=>String(v.id)===String(b.dataset.selectExternal));
        if(x)addExternalMusicToMix(x);
      });
      $$("#aiMusicList [data-download-external]").forEach(b=>b.onclick=ev=>{
        ev.stopPropagation();
        const x=S.externalMusic.find(v=>String(v.id)===String(b.dataset.downloadExternal));
        if(x)downloadExternalMusic(x);
      });
    }else if(S.aiMusic.length){
      mg.innerHTML=S.aiMusic.map((x,i)=>'<div class="ai-track '+(S.music?.url===x.url?"selected":"")+'" data-url="'+x.url+'" data-name="'+x.name+'"><div><b>♫ Música original '+(i+1)+'</b><small>Previa · melodía · ambiente · texturas</small></div><div class="ai-track-actions"><audio controls preload="metadata" src="'+x.url+(x.url.includes("?")?"&":"?")+"fresh="+encodeURIComponent(x.name+"-"+Date.now())+'"></audio><a class="preview-download" href="'+x.url+'" download>↓ Descargar previa</a></div></div>').join("");
      $$("#aiMusicList .ai-track").forEach(e=>e.onclick=ev=>{if(ev.target.tagName==="AUDIO")return;S.music={url:e.dataset.url,name:e.dataset.name};renderAICreator()});
    }else{
      mg.innerHTML='<div class="empty">♫ Busca una música o un sonido para seleccionar las fuentes de tu mezcla.</div>';
    }
  }
  if(mx){
    if(S.selectedExternalMusic.length){
      mx.innerHTML='<div class="mixer-selected-head"><div><b>🎚️ Sonidos seleccionados</b><small>'+S.selectedExternalMusic.length+'/6 · Puedes quitar cualquiera antes de mezclar.</small></div></div>'+S.selectedExternalMusic.map((x,i)=>'<div class="mixer-item"><span>'+String(i+1).padStart(2,"0")+'</span><div><b>'+escapeHtml(x.name)+'</b><small>Freesound · '+escapeHtml(x.username||"")+'</small></div><button type="button" class="ghost" data-remove-mix="'+x.id+'">Quitar</button></div>').join("")+'<div class="mixer-duration"><label>Duración de la mezcla <select id="aiMixHours"><option value="1" '+(S.aiMixHours===1?"selected":"")+'>1 hora</option><option value="2" '+(S.aiMixHours===2?"selected":"")+'>2 horas</option></select></label><small>La previa que escuches será exactamente la mezcla seleccionada.</small></div><button type="button" id="createSelectedFreesoundMix" class="primary mixer-create" '+(S.selectedExternalMusic.length<2?"disabled":"")+'>🎚️ Crear mezcla de los sonidos seleccionados</button>'+((S.music?.isFreesoundMix||S.music?.isFreesoundPreview)?'<div class="mixer-preview"><b>▶ Previa de la mezcla · '+(S.music.durationHours||S.aiMixHours)+' h</b><audio controls preload="metadata" src="'+S.music.url+'"></audio><small>Puedes escucharla completa, pausarla y mover el cursor por cualquier parte de la mezcla.</small></div>':'');
      $$("#aiMixer [data-remove-mix]").forEach(b=>b.onclick=()=>{S.selectedExternalMusic=S.selectedExternalMusic.filter(v=>String(v.id)!==String(b.dataset.removeMix));renderAICreator()});
      const dh=$("#aiMixHours");
      if(dh)dh.onchange=()=>{S.aiMixHours=Number(dh.value)===2?2:1};
      const mb=$("#createSelectedFreesoundMix");
      if(mb)mb.onclick=createSelectedFreesoundMix;
    }else{
      mx.innerHTML='<div class="empty">Añade al menos 2 sonidos desde la búsqueda y aquí aparecerán juntos para crear la mezcla.</div>';
    }
  }
  if($("#aiSelectedPhoto"))$("#aiSelectedPhoto").textContent=S.image?prettyImageName(S.image.name):"Sin foto";
  if($("#aiSelectedMusic"))$("#aiSelectedMusic").textContent=S.music?prettyMusicName(S.music.name):"Sin música";
  if($("#aiSelectionStatus")&&!S.aiLoading)$("#aiSelectionStatus").textContent=S.image&&S.music?"Todo listo. Elige la combinación que quieras y crea tu vídeo de 1 hora.":"Selecciona una foto y una música para continuar.";
}
function prettyImageName(name){return name?.replace(/\.(jpg|jpeg|png|webp)$/i,"").replace(/^pexels-\d+-/,"").replace(/^ai-/,"Imagen IA").replace(/[-_]/g," ")||"Foto";}
function renderImages(){const el=$("#imageGrid");el.innerHTML=S.images.length?S.images.map(x=>`<div class="media ${S.image?.url===x.url?"selected":""}" data-url="${x.url}" data-name="${x.name}"><img src="${x.url}"></div>`).join(""):'<div class="empty">No hay paisajes. Sube uno o créalo con IA.</div>';$$(".media").forEach(e=>e.onclick=()=>{S.image={url:e.dataset.url,name:e.dataset.name};render()})}
function prettyMusicName(name){name=String(name||"");const map={"relax-piano.mp3":"Piano nocturno","relax-ocean.mp3":"Ondas del océano","relax-meditation.mp3":"Meditación profunda","relax-dream.mp3":"Sueño tranquilo","relax-rain.mp3":"Lluvia suave","relax-forest.mp3":"Bosque sereno","relax-mountains.mp3":"Montañas al amanecer","relax-sunset.mp3":"Atardecer cálido","relax-night.mp3":"Noche estrellada","relax-deep-sleep.mp3":"Sueño profundo","relax-spa.mp3":"Spa y bienestar","relax-yoga.mp3":"Yoga tranquilo","relax-focus.mp3":"Concentración","relax-calm.mp3":"Calma absoluta","relax-fireplace.mp3":"Chimenea acogedora","relax-river.mp3":"Río tranquilo","relax-piano-rain.mp3":"Piano y lluvia","relax-ocean-night.mp3":"Océano nocturno","relax-zen.mp3":"Zen oriental","relax-breathing.mp3":"Respiración y calma","relax-clouds.mp3":"Nubes suaves","relax-waterfall.mp3":"Cascada relajante","relax-cafe.mp3":"Café tranquilo","relax-study.mp3":"Estudio profundo"};return map[name]||name.replace(/\.mp3$/i,"").replace(/[-_]/g," ")}
function musicCategory(name){const map={"relax-piano.mp3":"Sueño","relax-ocean.mp3":"Naturaleza","relax-meditation.mp3":"Meditación","relax-dream.mp3":"Sueño","relax-rain.mp3":"Naturaleza","relax-forest.mp3":"Naturaleza","relax-mountains.mp3":"Naturaleza","relax-sunset.mp3":"Relax","relax-night.mp3":"Sueño","relax-deep-sleep.mp3":"Sueño","relax-spa.mp3":"Relax","relax-yoga.mp3":"Meditación","relax-focus.mp3":"Concentración","relax-calm.mp3":"Relax","relax-fireplace.mp3":"Relax","relax-river.mp3":"Naturaleza","relax-piano-rain.mp3":"Sueño","relax-ocean-night.mp3":"Sueño","relax-zen.mp3":"Meditación","relax-breathing.mp3":"Meditación","relax-clouds.mp3":"Relax","relax-waterfall.mp3":"Naturaleza","relax-cafe.mp3":"Relax","relax-study.mp3":"Concentración"};return map[name]||"Relax"}
function renderMusic(){const el=$("#musicList");const libraryTracks=Array.isArray(S.music)?S.music:[];const tracks=S.musicCategory==="Todas"?libraryTracks:libraryTracks.filter(x=>musicCategory(x.name)===S.musicCategory);el.innerHTML=tracks.length?tracks.map(x=>`<div class="track ${S.music?.url===x.url?"selected":""}" data-url="${x.url}" data-name="${x.name}"><b>♫ ${prettyMusicName(x.name)}</b><small>${musicCategory(x.name)}</small><audio controls src="${x.url}"></audio></div>`).join(""):'<div class="empty">No hay pistas en esta categoría.</div>';$$(".track").forEach(e=>e.onclick=ev=>{if(ev.target.tagName==="AUDIO")return;S.music={url:e.dataset.url,name:e.dataset.name};render()})}
function renderVideos(){const el=$("#videos");el.innerHTML=S.videos.length?S.videos.map(x=>`<div class="video-item"><small>${x.name}</small><a href="${x.url}" target="_blank">Abrir / descargar →</a></div>`).join(""):'<div class="empty">Todavía no hay vídeos generados.</div>'}
function update(){$("#selectedLandscape").innerHTML=S.image?`<b>${S.image.name}</b> <span>⌄</span>`:`Selecciona un paisaje <span>⌄</span>`;$("#selectedTrack").innerHTML=S.music?`<b>${S.music.name}</b> <span>⌄</span>`:`Selecciona una pista <span>⌄</span>`;$$(".dur").forEach(b=>b.classList.toggle("active",Number(b.dataset.hours)===S.hours))}
function picker(){const lp=$("#landscapePicker"),mp=$("#musicPicker");const libraryTracks=Array.isArray(S.music)?S.music:(S.music?[S.music]:[]);lp.innerHTML=S.images.map(x=>`<div class="picker-item" data-u="${x.url}" data-n="${x.name}">${x.name}</div>`).join("");mp.innerHTML=libraryTracks.map(x=>`<div class="picker-item" data-u="${x.url}" data-n="${x.name}">${x.name}</div>`).join("");$$(".picker-item").forEach(e=>e.onclick=()=>{if(e.parentElement.id==="landscapePicker")S.image={url:e.dataset.u,name:e.dataset.n};else S.music={url:e.dataset.u,name:e.dataset.n};render()})}
$("#selectedLandscape").onclick=()=>$("#landscapePicker").classList.toggle("open");
$("#selectedTrack").onclick=()=>$("#musicPicker").classList.toggle("open");
$$(".dur").forEach(b=>b.onclick=()=>{S.hours=Number(b.dataset.hours);update()});
$$(".nav").forEach(b=>b.onclick=async()=>{
  $$(".nav").forEach(x=>x.classList.remove("active"));b.classList.add("active");
  $$(".tab").forEach(x=>x.classList.remove("active"));$("#"+b.dataset.tab).classList.add("active");
  if(b.dataset.tab==="ai"){
    renderAICreator();
    await ensureAIOptions();
  }
});
$("#imageInput").onchange=async e=>{if(!e.target.files[0])return;const fd=new FormData();fd.append("image",e.target.files[0]);$("#builderStatus").textContent="Subiendo imagen…";try{S.image=await api("/api/upload/image",{method:"POST",body:fd});await load()}catch(x){$("#builderStatus").textContent=x.message}};
$("#musicInput").onchange=async e=>{if(!e.target.files[0])return;const fd=new FormData();fd.append("music",e.target.files[0]);$("#builderStatus").textContent="Subiendo música…";try{S.music=await api("/api/upload/music",{method:"POST",body:fd});await load()}catch(x){$("#builderStatus").textContent=x.message}};
$("#aiImage").onclick=async()=>{const p=$("#prompt").value||"Ultra-realistic cinematic peaceful landscape, natural light, no people, no text, photorealistic";$("#builderStatus").textContent="Generando paisaje IA…";try{S.image=await api("/api/generate-image",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompt:p})});await load()}catch(x){$("#builderStatus").textContent=x.message}};
$("#generate").onclick=async()=>{if(!S.image||!S.music){$("#builderStatus").textContent="Selecciona un paisaje y una pista.";return}$("#generate").disabled=true;$("#builderStatus").textContent="Generando vídeo…";try{const d=await api("/api/generate-video",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({image:S.image.url,music:S.music.url,durationHours:1})});$("#video").src=d.url;$("#download").href=d.url;$("#download").setAttribute("download",d.name||"relaxscape-video.mp4");$("#result").classList.remove("hidden");$("#builderStatus").textContent="Vídeo terminado.";await load();}catch(x){$("#builderStatus").textContent=x.message}finally{$("#generate").disabled=false}};
$("#aiGoMusic").onclick=()=>{$$(".nav").forEach(x=>x.classList.remove("active"));$(".tab").forEach(x=>x.classList.remove("active"));document.querySelector('[data-tab="music"]').classList.add("active");$("#music").classList.add("active");};
$("#aiCreateHour").onclick=async()=>{
  if(!S.image||!S.music){$("#aiSelectionStatus").textContent="Selecciona primero una foto y una música.";return}
  if(S.music.isFreesoundPreview){$("#aiSelectionStatus").textContent="La previa está lista, pero la mezcla completa todavía se está preparando. Espera a que termine para crear el vídeo.";return}
  const btn=$("#aiCreateHour");btn.disabled=true;
  try{
    let musicForVideo=S.music;
    if(!S.music.generatedFromSearch && !S.music.isFreesoundMix && !S.music.isFreesoundPreview){
      $("#aiSelectionStatus").textContent="1/2 · Preparando 1 hora a partir de la previa musical…";
      musicForVideo=await api("/api/generate-selected-long-music",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({music:S.music.url,durationHours:1,musicPrompt:($("#aiMusicPrompt")?.value||$("#prompt")?.value||"").trim()})});
    }
    const videoHours=Number(S.music?.durationHours||S.aiMixHours||1)===2?2:1;
    $("#aiSelectionStatus").textContent="2/2 · Creando tu vídeo Full HD de "+videoHours+" hora"+(videoHours===1?"":"s")+" con la mezcla…";
    const d=await api("/api/generate-video",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({image:S.image.url,music:musicForVideo.url,durationHours:videoHours})});
    $("#video").src=d.url;$("#download").href=d.url;$("#download").setAttribute("download",d.name||"relaxscape-video.mp4");$("#result").classList.remove("hidden");
    $("#aiSelectionStatus").textContent="¡Vídeo terminado! Se ha utilizado la mezcla de "+videoHours+" hora"+(videoHours===1?"":"s")+" seleccionada.";
    await load();
  }catch(e){$("#aiSelectionStatus").textContent=e.message}
  finally{btn.disabled=false}
};
$("#closeResult").onclick=()=>$("#result").classList.add("hidden");
async function createRelaxMix(hours){
  const status=$("#mixStatus"), b=hours===1?$("#mix1h"):$("#mix2h");
  if(b)b.disabled=true;
  if(status)status.textContent="Preparando una mezcla larga con toda la biblioteca…";
  try{
    const d=await api("/api/generate-relax-mix",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({durationHours:hours})});
    const item={name:d.name,url:d.url};
    S.music=[item,...S.music.filter(x=>x.url!==item.url)];
    S.music=item;
    renderMusic();picker();update();
    if(status)status.textContent="✓ Mezcla de "+hours+" hora"+(hours===1?"":"s")+" creada con "+(d.tracks?.length||24)+" pistas y transiciones suaves.";
  }catch(e){if(status)status.textContent=e.message}
  finally{if(b)b.disabled=false}
}
$("#mix1h").onclick=()=>createRelaxMix(1);
$("#mix2h").onclick=()=>createRelaxMix(2);
$("#refresh").onclick=load;$("#loadPexels").onclick=loadPexels;
$$("#landscapeCategories button").forEach(b=>b.onclick=()=>{$("#prompt").value=b.dataset.q;loadPexels()});
$$("#musicFilters button").forEach(b=>b.onclick=()=>{$$("#musicFilters button").forEach(x=>x.classList.remove("active"));b.classList.add("active");S.musicCategory=b.dataset.cat;renderMusic()});
$("#saveSchedule").onclick=()=>{S.schedule=$("#scheduleToggle").checked;localStorage.relaxSchedule=JSON.stringify({enabled:S.schedule,hour:$("#scheduleHour").value,duration:$("#scheduleDuration").value});$("#statSchedule").textContent=S.schedule?"Diaria":"Pausada";alert("Programación guardada en este navegador. El render automático del servidor usa DAILY_VIDEO_HOUR.");};
try{const x=JSON.parse(localStorage.relaxSchedule||"null");if(x){$("#scheduleToggle").checked=x.enabled;$("#scheduleHour").value=x.hour;$("#scheduleDuration").value=x.duration;$("#statSchedule").textContent=x.enabled?"Diaria":"Pausada"}}catch{}
bindAIButtons();
load();
