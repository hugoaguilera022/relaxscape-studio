const S={images:[],music:[],videos:[],image:null,music:null,hours:1,schedule:true};
const $=s=>document.querySelector(s), $$=s=>document.querySelectorAll(s);
async function api(url,opt){const r=await fetch(url,opt);let d={};try{d=await r.json()}catch{};if(!r.ok)throw Error(d.error||"Error");return d}
async function load(){try{const d=await api("/api/library");S.images=d.images;S.music=d.music;S.videos=d.videos;render();}catch(e){$("#builderStatus").textContent=e.message;}}
function render(){renderImages();renderMusic();renderVideos();$("#statVideos").textContent=S.videos.length;update();picker();}
function renderImages(){const el=$("#imageGrid");el.innerHTML=S.images.length?S.images.map(x=>`<div class="media ${S.image?.url===x.url?"selected":""}" data-url="${x.url}" data-name="${x.name}"><img src="${x.url}"></div>`).join(""):'<div class="empty">No hay paisajes. Sube uno o créalo con IA.</div>';$$(".media").forEach(e=>e.onclick=()=>{S.image={url:e.dataset.url,name:e.dataset.name};render()})}
function renderMusic(){const el=$("#musicList");el.innerHTML=S.music.length?S.music.map(x=>`<div class="track ${S.music?.url===x.url?"selected":""}" data-url="${x.url}" data-name="${x.name}"><b>♫ ${x.name}</b><audio controls src="${x.url}"></audio></div>`).join(""):'<div class="empty">No hay música. Sube una pista o créala con IA.</div>';$$(".track").forEach(e=>e.onclick=ev=>{if(ev.target.tagName==="AUDIO")return;S.music={url:e.dataset.url,name:e.dataset.name};render()})}
function renderVideos(){const el=$("#videos");el.innerHTML=S.videos.length?S.videos.map(x=>`<div class="video-item"><small>${x.name}</small><a href="${x.url}" target="_blank">Abrir / descargar →</a></div>`).join(""):'<div class="empty">Todavía no hay vídeos generados.</div>'}
function update(){$("#selectedLandscape").innerHTML=S.image?`<b>${S.image.name}</b> <span>⌄</span>`:`Selecciona un paisaje <span>⌄</span>`;$("#selectedTrack").innerHTML=S.music?`<b>${S.music.name}</b> <span>⌄</span>`:`Selecciona una pista <span>⌄</span>`;$$(".dur").forEach(b=>b.classList.toggle("active",Number(b.dataset.hours)===S.hours))}
function picker(){const lp=$("#landscapePicker"),mp=$("#musicPicker");lp.innerHTML=S.images.map(x=>`<div class="picker-item" data-u="${x.url}" data-n="${x.name}">${x.name}</div>`).join("");mp.innerHTML=S.music.map(x=>`<div class="picker-item" data-u="${x.url}" data-n="${x.name}">${x.name}</div>`).join("");$$(".picker-item").forEach(e=>e.onclick=()=>{if(e.parentElement.id==="landscapePicker")S.image={url:e.dataset.u,name:e.dataset.n};else S.music={url:e.dataset.u,name:e.dataset.n};render()})}
$("#selectedLandscape").onclick=()=>$("#landscapePicker").classList.toggle("open");
$("#selectedTrack").onclick=()=>$("#musicPicker").classList.toggle("open");
$$(".dur").forEach(b=>b.onclick=()=>{S.hours=Number(b.dataset.hours);update()});
$$(".nav").forEach(b=>b.onclick=()=>{$$(".nav").forEach(x=>x.classList.remove("active"));b.classList.add("active");$$(".tab").forEach(x=>x.classList.remove("active"));$("#"+b.dataset.tab).classList.add("active")});
$("#imageInput").onchange=async e=>{if(!e.target.files[0])return;const fd=new FormData();fd.append("image",e.target.files[0]);$("#builderStatus").textContent="Subiendo imagen…";try{S.image=await api("/api/upload/image",{method:"POST",body:fd});await load()}catch(x){$("#builderStatus").textContent=x.message}};
$("#musicInput").onchange=async e=>{if(!e.target.files[0])return;const fd=new FormData();fd.append("music",e.target.files[0]);$("#builderStatus").textContent="Subiendo música…";try{S.music=await api("/api/upload/music",{method:"POST",body:fd});await load()}catch(x){$("#builderStatus").textContent=x.message}};
$("#aiImage").onclick=async()=>{const p=$("#prompt").value||"Ultra-realistic cinematic peaceful landscape, natural light, no people, no text, photorealistic";$("#builderStatus").textContent="Generando paisaje IA…";try{S.image=await api("/api/generate-image",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompt:p})});await load()}catch(x){$("#builderStatus").textContent=x.message}};
$("#generate").onclick=async()=>{if(!S.image||!S.music){$("#builderStatus").textContent="Selecciona un paisaje y una pista.";return}$("#generate").disabled=true;$("#builderStatus").textContent="Generando vídeo…";try{const d=await api("/api/generate-video",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({image:S.image.url,music:S.music.url,durationHours:S.hours})});$("#video").src=d.url;$("#download").href=d.url;$("#result").classList.remove("hidden");$("#builderStatus").textContent="Vídeo terminado.";await load();}catch(x){$("#builderStatus").textContent=x.message}finally{$("#generate").disabled=false}};
$("#aiVideo").onclick=()=>generateAI("video");
$("#aiMusic").onclick=()=>generateAI("music");
$("#aiBoth").onclick=()=>generateAI("both");
async function generateAI(type){
  const prompt=$("#aiPrompt").value.trim()||"A peaceful cinematic mountain lake at sunrise, gentle mist over the water, slow camera movement, calming atmosphere, no people, no text.";
  const status=$("#aiStatus"); const buttons=["#aiVideo","#aiMusic","#aiBoth"]; buttons.forEach(x=>$(x).disabled=true); status.classList.add("busy");
  const durationHours=Number($("#aiDuration").value);
  let v=null,m=null;
  try{
    if(type==="video"||type==="both"){
      status.textContent="Generando vídeo con Veo 3.1… puede tardar unos minutos.";
      v=await api("/api/generate-ai-video",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompt,aspectRatio:$("#aiAspect").value})});
      $("#video").src=v.url;$("#download").href=v.url;$("#result").classList.remove("hidden");
    }
    if(type==="music"||type==="both"){
      status.textContent="Generando música con Lyria 3.5…";
      m=await api("/api/generate-ai-music",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompt:`${prompt}. Instrumental ambient relaxation for sleep and meditation, very slow tempo, soft piano, warm pads, subtle atmosphere, no vocals, no lyrics, no drums.`,mode:"instrumental"})});
      S.music={name:m.name,url:m.url};
      await load();
      if(type==="both"){
        status.textContent="Mezclando vídeo + música…";
        const mixed=await api("/api/mux-video-audio",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({video:v.url,music:m.url,durationHours})});
        $("#video").src=mixed.url;$("#download").href=mixed.url;
      }
    }
    status.textContent=type==="both"?"Vídeo y música generados y mezclados.":"Contenido generado correctamente.";
    await load();
  }catch(e){status.textContent=e.message}finally{buttons.forEach(x=>$(x).disabled=false);status.classList.remove("busy")}
}
$("#closeResult").onclick=()=>$("#result").classList.add("hidden");
$("#refresh").onclick=load;
$("#saveSchedule").onclick=()=>{S.schedule=$("#scheduleToggle").checked;localStorage.relaxSchedule=JSON.stringify({enabled:S.schedule,hour:$("#scheduleHour").value,duration:$("#scheduleDuration").value});$("#statSchedule").textContent=S.schedule?"Diaria":"Pausada";alert("Programación guardada en este navegador. El render automático del servidor usa DAILY_VIDEO_HOUR.");};
try{const x=JSON.parse(localStorage.relaxSchedule||"null");if(x){$("#scheduleToggle").checked=x.enabled;$("#scheduleHour").value=x.hour;$("#scheduleDuration").value=x.duration;$("#statSchedule").textContent=x.enabled?"Diaria":"Pausada"}}catch{}
load();