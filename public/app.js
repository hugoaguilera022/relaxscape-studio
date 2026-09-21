const S={images:[],music:[],aiImages:[],aiMusic:[],videos:[],image:null,music:null,hours:1,schedule:true,musicCategory:"Todas",aiReady:false,aiLoading:false};
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
async function ensureAIOptions(){
  if(S.aiReady||S.aiLoading)return;
  S.aiLoading=true;
  const status=$("#aiSelectionStatus"),ig=$("#aiImageGrid"),mg=$("#aiMusicList");
  if(status)status.textContent="Preparando 4 paisajes y 4 músicas según tus descripciones…";
  if(ig)ig.innerHTML='<div class="empty">✨ Buscando 4 paisajes…</div>';
  if(mg)mg.innerHTML='<div class="empty">♫ Preparando 4 músicas…</div>';
  try{
    const d=await api("/api/ai-options",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({theme:($("#aiImagePrompt")?.value||$("#prompt")?.value||"peaceful lake, misty mountains, soft dawn light").trim(),musicPrompt:($("#aiMusicPrompt")?.value||"very slow peaceful ambient piano, warm soft pads, gentle evolving harmony, deep calm atmosphere, no drums, no rhythmic pulse, spacious reverb").trim()})});
    S.aiImages=d.images||[]; S.aiMusic=d.music||[];
    if(S.aiImages[0])S.image=S.aiImages[0];
    if(S.aiMusic[0])S.music=S.aiMusic[0];
    renderAICreator();
    if(S.aiImages.length && S.aiMusic.length>=4){
      S.aiReady=true;
      if(status)status.textContent="✓ 4 paisajes y 4 músicas listas.";
    }else{
      if(status)status.textContent="✓ Paisajes listos. Generando las 4 músicas…";
      await waitForAIMusic();
    }
  }catch(e){
    if(status)status.textContent="Error: "+e.message;
    if(ig)ig.innerHTML='<div class="empty">No se pudieron cargar los paisajes.<br><small>'+e.message+'</small></div>';
    if(mg)mg.innerHTML='<div class="empty">No se pudo preparar la música.<br><small>'+e.message+'</small></div>';
  }finally{S.aiLoading=false;renderAICreator()}
}
async function waitForAIMusic(){
  for(let attempt=0;attempt<144;attempt++){
    await new Promise(r=>setTimeout(r,2500));
    try{
      const d=await api("/api/ai-options-status");
      if(d.music?.length){
        S.aiMusic=d.music;
        if(!S.music)S.music=S.aiMusic[0];
        renderAICreator();
      }
      if(d.musicReady){
        S.aiReady=!!(S.aiImages.length&&S.aiMusic.length>=4);
        if($("#aiSelectionStatus"))$("#aiSelectionStatus").textContent="✓ 4 paisajes y 4 músicas listas.";
        return;
      }
      if(d.musicErrors?.length){ if($("#aiSelectionStatus"))$("#aiSelectionStatus").textContent="Error de música: "+d.musicErrors[0]; return; }
      if($("#aiSelectionStatus"))$("#aiSelectionStatus").textContent="✓ Paisajes listos · generando música "+Math.min(4,Math.floor(attempt/4)+1)+"/4…";
    }catch(e){}
  }
  if($("#aiSelectionStatus"))$("#aiSelectionStatus").textContent="Las fotos están listas; la música todavía está preparándose. Déjala terminar; las 4 pistas se generan en segundo plano.";
}
function renderAICreator(){
  const ig=$("#aiImageGrid"),mg=$("#aiMusicList");
  if(ig){
    ig.innerHTML=S.aiImages.length?S.aiImages.map((x,i)=>'<button class="ai-photo '+(S.image?.url===x.url?"selected":"")+'" data-url="'+x.url+'" data-name="'+x.name+'"><img src="'+x.url+'" alt="Paisaje IA '+(i+1)+'"><span>Opción IA '+(i+1)+' · 2K</span></button>').join(""):'<div class="empty">✨ Generando opciones IA…</div>';
    $$("#aiImageGrid .ai-photo").forEach(e=>e.onclick=()=>{S.image={url:e.dataset.url,name:e.dataset.name};renderAICreator()});
  }
  if(mg){
    mg.innerHTML=S.aiMusic.length?S.aiMusic.map((x,i)=>'<div class="ai-track '+(S.music?.url===x.url?"selected":"")+'" data-url="'+x.url+'" data-name="'+x.name+'"><div><b>♫ Música original '+(i+1)+'</b><small>Previa · melodía · ambiente · texturas</small></div><div class="ai-track-actions"><audio controls preload="none" src="'+x.url+'"></audio><a class="preview-download" href="'+x.url+'" download>↓ Descargar previa</a></div></div>').join(""):'<div class="empty">♫ Generando opciones IA…</div>';
    $$("#aiMusicList .ai-track").forEach(e=>e.onclick=ev=>{if(ev.target.tagName==="AUDIO")return;S.music={url:e.dataset.url,name:e.dataset.name};renderAICreator()});
  }
  if($("#aiSelectedPhoto"))$("#aiSelectedPhoto").textContent=S.image?prettyImageName(S.image.name):"Sin foto";
  if($("#aiSelectedMusic"))$("#aiSelectedMusic").textContent=S.music?prettyMusicName(S.music.name):"Sin música";
  if($("#aiSelectionStatus")&&!S.aiLoading)$("#aiSelectionStatus").textContent=S.image&&S.music?"Todo listo. Elige la combinación que quieras y crea tu vídeo de 1 hora.":"Selecciona una foto y una música para continuar.";
}
function prettyImageName(name){return name?.replace(/\.(jpg|jpeg|png|webp)$/i,"").replace(/^pexels-\d+-/,"").replace(/^ai-/,"Imagen IA").replace(/[-_]/g," ")||"Foto";}
function renderImages(){const el=$("#imageGrid");el.innerHTML=S.images.length?S.images.map(x=>`<div class="media ${S.image?.url===x.url?"selected":""}" data-url="${x.url}" data-name="${x.name}"><img src="${x.url}"></div>`).join(""):'<div class="empty">No hay paisajes. Sube uno o créalo con IA.</div>';$$(".media").forEach(e=>e.onclick=()=>{S.image={url:e.dataset.url,name:e.dataset.name};render()})}
function prettyMusicName(name){name=String(name||"");const map={"relax-piano.mp3":"Piano nocturno","relax-ocean.mp3":"Ondas del océano","relax-meditation.mp3":"Meditación profunda","relax-dream.mp3":"Sueño tranquilo","relax-rain.mp3":"Lluvia suave","relax-forest.mp3":"Bosque sereno","relax-mountains.mp3":"Montañas al amanecer","relax-sunset.mp3":"Atardecer cálido","relax-night.mp3":"Noche estrellada","relax-deep-sleep.mp3":"Sueño profundo","relax-spa.mp3":"Spa y bienestar","relax-yoga.mp3":"Yoga tranquilo","relax-focus.mp3":"Concentración","relax-calm.mp3":"Calma absoluta","relax-fireplace.mp3":"Chimenea acogedora","relax-river.mp3":"Río tranquilo","relax-piano-rain.mp3":"Piano y lluvia","relax-ocean-night.mp3":"Océano nocturno","relax-zen.mp3":"Zen oriental","relax-breathing.mp3":"Respiración y calma","relax-clouds.mp3":"Nubes suaves","relax-waterfall.mp3":"Cascada relajante","relax-cafe.mp3":"Café tranquilo","relax-study.mp3":"Estudio profundo"};return map[name]||name.replace(/\.mp3$/i,"").replace(/[-_]/g," ")}
function musicCategory(name){const map={"relax-piano.mp3":"Sueño","relax-ocean.mp3":"Naturaleza","relax-meditation.mp3":"Meditación","relax-dream.mp3":"Sueño","relax-rain.mp3":"Naturaleza","relax-forest.mp3":"Naturaleza","relax-mountains.mp3":"Naturaleza","relax-sunset.mp3":"Relax","relax-night.mp3":"Sueño","relax-deep-sleep.mp3":"Sueño","relax-spa.mp3":"Relax","relax-yoga.mp3":"Meditación","relax-focus.mp3":"Concentración","relax-calm.mp3":"Relax","relax-fireplace.mp3":"Relax","relax-river.mp3":"Naturaleza","relax-piano-rain.mp3":"Sueño","relax-ocean-night.mp3":"Sueño","relax-zen.mp3":"Meditación","relax-breathing.mp3":"Meditación","relax-clouds.mp3":"Relax","relax-waterfall.mp3":"Naturaleza","relax-cafe.mp3":"Relax","relax-study.mp3":"Concentración"};return map[name]||"Relax"}
function renderMusic(){const el=$("#musicList");const tracks=S.musicCategory==="Todas"?S.music:S.music.filter(x=>musicCategory(x.name)===S.musicCategory);el.innerHTML=tracks.length?tracks.map(x=>`<div class="track ${S.music?.url===x.url?"selected":""}" data-url="${x.url}" data-name="${x.name}"><b>♫ ${prettyMusicName(x.name)}</b><small>${musicCategory(x.name)}</small><audio controls src="${x.url}"></audio></div>`).join(""):'<div class="empty">No hay pistas en esta categoría.</div>';$$(".track").forEach(e=>e.onclick=ev=>{if(ev.target.tagName==="AUDIO")return;S.music={url:e.dataset.url,name:e.dataset.name};render()})}
function renderVideos(){const el=$("#videos");el.innerHTML=S.videos.length?S.videos.map(x=>`<div class="video-item"><small>${x.name}</small><a href="${x.url}" target="_blank">Abrir / descargar →</a></div>`).join(""):'<div class="empty">Todavía no hay vídeos generados.</div>'}
function update(){$("#selectedLandscape").innerHTML=S.image?`<b>${S.image.name}</b> <span>⌄</span>`:`Selecciona un paisaje <span>⌄</span>`;$("#selectedTrack").innerHTML=S.music?`<b>${S.music.name}</b> <span>⌄</span>`:`Selecciona una pista <span>⌄</span>`;$$(".dur").forEach(b=>b.classList.toggle("active",Number(b.dataset.hours)===S.hours))}
function picker(){const lp=$("#landscapePicker"),mp=$("#musicPicker");lp.innerHTML=S.images.map(x=>`<div class="picker-item" data-u="${x.url}" data-n="${x.name}">${x.name}</div>`).join("");mp.innerHTML=S.music.map(x=>`<div class="picker-item" data-u="${x.url}" data-n="${x.name}">${x.name}</div>`).join("");$$(".picker-item").forEach(e=>e.onclick=()=>{if(e.parentElement.id==="landscapePicker")S.image={url:e.dataset.u,name:e.dataset.n};else S.music={url:e.dataset.u,name:e.dataset.n};render()})}
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
async function searchAI(){
  S.aiReady=false;S.aiLoading=false;S.aiImages=[];S.aiMusic=[];S.image=null;S.music=null;
  renderAICreator();
  await ensureAIOptions();
}
$("#aiLoadPhotos").onclick=searchAI;
$("#aiSearchImage").onclick=searchAI;
$("#aiSearchMusic").onclick=searchAI;
$("#aiGoMusic").onclick=()=>{$$(".nav").forEach(x=>x.classList.remove("active"));$(".tab").forEach(x=>x.classList.remove("active"));document.querySelector('[data-tab="music"]').classList.add("active");$("#music").classList.add("active");};
$("#aiCreateHour").onclick=async()=>{
  if(!S.image||!S.music){$("#aiSelectionStatus").textContent="Selecciona primero una foto y una música.";return}
  const btn=$("#aiCreateHour");btn.disabled=true;
  try{
    $("#aiSelectionStatus").textContent="1/2 · Preparando 1 hora a partir de la previa musical…";
    const long=await api("/api/generate-selected-long-music",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({music:S.music.url,durationHours:1})});
    $("#aiSelectionStatus").textContent="2/2 · Creando tu vídeo Full HD de 1 hora…";
    const d=await api("/api/generate-video",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({image:S.image.url,music:long.url,durationHours:1})});
    $("#video").src=d.url;$("#download").href=d.url;$("#result").classList.remove("hidden");
    $("#aiSelectionStatus").textContent="¡Vídeo terminado! La música larga se ha creado desde la previa que escuchaste.";
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
load();