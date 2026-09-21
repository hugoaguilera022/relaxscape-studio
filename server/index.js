import express from "express";
import cors from "cors";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import cron from "node-cron";
import ffmpegPath from "ffmpeg-static";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const DATA = path.join(ROOT, "data");
const IMAGE_DIR = path.join(DATA, "images");
const MUSIC_DIR = path.join(DATA, "music");
const VIDEO_DIR = path.join(DATA, "videos");

for (const dir of [IMAGE_DIR, MUSIC_DIR, VIDEO_DIR]) fs.mkdirSync(dir, { recursive: true });

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(PUBLIC));
app.use("/media/images", express.static(IMAGE_DIR));
app.use("/media/music", express.static(MUSIC_DIR));
app.use("/media/videos", express.static(VIDEO_DIR));

const imageUpload = multer({
  storage: multer.diskStorage({
    destination: IMAGE_DIR,
    filename: (_, file, cb) => cb(null, `${Date.now()}-${safe(file.originalname)}`)
  }),
  limits: { fileSize: 30 * 1024 * 1024 }
});

const musicUpload = multer({
  storage: multer.diskStorage({
    destination: MUSIC_DIR,
    filename: (_, file, cb) => cb(null, `${Date.now()}-${safe(file.originalname)}`)
  }),
  limits: { fileSize: 200 * 1024 * 1024 }
});

function safe(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

const MUSIC_ENGINE_VERSION = "v8-prompt-aware-ambient-composer";

const BUILTIN_MUSIC = [
  ["relax-piano.mp3","Piano nocturno","Sueño",261.63,329.63,392],
  ["relax-ocean.mp3","Ondas del océano","Naturaleza",220,277.18,329.63],
  ["relax-meditation.mp3","Meditación profunda","Meditación",174.61,261.63,349.23],
  ["relax-dream.mp3","Sueño tranquilo","Sueño",196,246.94,293.66],
  ["relax-rain.mp3","Lluvia suave","Naturaleza",146.83,220,293.66],
  ["relax-forest.mp3","Bosque sereno","Naturaleza",164.81,246.94,329.63],
  ["relax-mountains.mp3","Montañas al amanecer","Naturaleza",196,293.66,392],
  ["relax-sunset.mp3","Atardecer cálido","Relax",174.61,220,329.63],
  ["relax-night.mp3","Noche estrellada","Sueño",130.81,196,261.63],
  ["relax-deep-sleep.mp3","Sueño profundo","Sueño",110,164.81,220],
  ["relax-spa.mp3","Spa y bienestar","Relax",220,329.63,440],
  ["relax-yoga.mp3","Yoga tranquilo","Meditación",146.83,220,369.99],
  ["relax-focus.mp3","Concentración","Concentración",261.63,392,523.25],
  ["relax-calm.mp3","Calma absoluta","Relax",196,246.94,349.23],
  ["relax-fireplace.mp3","Chimenea acogedora","Relax",130.81,196,293.66],
  ["relax-river.mp3","Río tranquilo","Naturaleza",164.81,220,329.63],
  ["relax-piano-rain.mp3","Piano y lluvia","Sueño",196,246.94,392],
  ["relax-ocean-night.mp3","Océano nocturno","Sueño",164.81,220,329.63],
  ["relax-zen.mp3","Zen oriental","Meditación",146.83,220,293.66],
  ["relax-breathing.mp3","Respiración y calma","Meditación",130.81,174.61,261.63],
  ["relax-clouds.mp3","Nubes suaves","Relax",196,293.66,440],
  ["relax-waterfall.mp3","Cascada relajante","Naturaleza",174.61,261.63,349.23],
  ["relax-cafe.mp3","Café tranquilo","Relax",220,329.63,392],
  ["relax-study.mp3","Estudio profundo","Concentración",196,293.66,392]
].map(([file,label,category,f1,f2,f3])=>({file,label,category,f1,f2,f3}));

function writeWav(file, samples, sampleRate=44100, channels=2){
  const dataSize=samples.length*2, b=Buffer.alloc(44+dataSize);
  b.write("RIFF",0); b.writeUInt32LE(36+dataSize,4); b.write("WAVE",8); b.write("fmt ",12);
  b.writeUInt32LE(16,16); b.writeUInt16LE(1,20); b.writeUInt16LE(channels,22);
  b.writeUInt32LE(sampleRate,24); b.writeUInt32LE(sampleRate*channels*2,28);
  b.writeUInt16LE(channels*2,32); b.writeUInt16LE(16,34); b.write("data",36); b.writeUInt32LE(dataSize,40);
  for(let i=0;i<samples.length;i++) b.writeInt16LE(Math.max(-32767,Math.min(32767,Math.round(samples[i]*32767))),44+i*2);
  fs.writeFileSync(file,b);
}

function makeCompositionWav(track, wavPath){
  // Motor armónico v7: ambient cinematográfico, progresiones lentas, voice-leading
  // estricto, melodía respirada y capas suaves. Se renderiza a 22.05 kHz y se
  // entrega a FFmpeg a 44.1 kHz para mantener calidad sin bloquear Render.
  const sr=8000, dur=7, n=sr*dur, samples=new Float32Array(n*2);
  const profile=String(track.musicProfile||"").toLowerCase();
  const ultraCalm=/relax|calm|sleep|meditat|peace|soft|ambient|piano|nature|spa|healing|stress|anxiety/.test(profile);
  const darkCalm=/deep|night|dream|sleep/.test(profile);
  const seed=Math.abs(Math.floor(track.f1*100 + track.f2*10 + track.f3 + (track.variant||0)*137)) % 1000;
  const variant=Number(track.variant||0)%4;
  const flowing=/ocean|water|river|rain|waterfall|waves/.test(profile);
  const nature=/forest|mountain|nature|bamboo|garden|birds/.test(profile);
  const dream=/dream|sleep|night|star|moon|meditat|zen/.test(profile);
  const bpmSet=flowing?[42,46,50,54]:dream?[38,40,43,46]:nature?[44,48,52,56]:[40,44,48,52];
  const bpm=bpmSet[variant], beat=60/bpm, bar=beat*4;
  const hz=m=>440*Math.pow(2,(m-69)/12);
  const midiFromHz=f=>69+12*Math.log2(f/440);
  const baseMidi=Math.round(midiFromHz(track.f1));
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

  // Tonalidades/colores distintos, pero siempre diatónicos y consonantes.
  const modes=[
    {scale:[0,2,4,5,7,9,11], name:"major"},
    {scale:[0,2,3,5,7,9,10], name:"dorian"},
    {scale:[0,2,3,5,7,8,10], name:"minor"}
  ];
  const modeIndex=darkCalm ? 2 : ((seed+variant)%modes.length);
  const mode=modes[modeIndex];
  const scale=mode.scale;

  // Progresiones pensadas para reposo: tónica, subdominante y dominante
  // suave, evitando cadencias bruscas. La última vuelta resuelve claramente.
  const progressions=[
    [0,4,5,3,0,2,4,0],
    [0,5,3,4,0,3,5,0],
    [0,3,4,5,0,4,3,0],
    [0,5,1,4,0,3,4,0]
  ];
  const degrees=progressions[(seed+variant*2)%progressions.length];

  const chordIntervals=[
    [0,4,7,11,14], // maj9
    [0,3,7,10,14], // min9
    [0,3,7,10,14], // min9
    [0,4,7,11,14]  // maj9
  ];

  // Acordes con terceras/7as/9as diatónicas. Cada voz busca la posición
  // más cercana a la anterior para que los cambios sean fluidos.
  const chords=[];
  let prev=[baseMidi+12,baseMidi+16,baseMidi+19,baseMidi+23,baseMidi+26];
  for(let b=0;b<8;b++){
    const degree=degrees[b];
    const root=baseMidi+scale[degree];
    const isMinor=((degree===2||degree===3||degree===5)&&mode.name!=="major");
    const extensionSet=[
      [0,4,7,11,14],
      [0,3,7,10,14],
      [0,4,7,10,14],
      [0,3,7,11,14]
    ];
    const intervals=isMinor?[0,3,7,10,14]:extensionSet[(variant+b+seed)%extensionSet.length];
    let raw=intervals.map(iv=>root+iv);
    while(raw[0]<baseMidi+10) raw=raw.map(x=>x+12);
    while(raw[raw.length-1]>baseMidi+38) raw=raw.map(x=>x-12);
    const notes=raw.map((x,i)=>{
      const choices=[x-12,x,x+12];
      return choices.reduce((best,v)=>Math.abs(v-prev[i])<Math.abs(best-prev[i])?v:best,choices[0]);
    });
    prev=notes;
    chords.push({root,notes});
  }

  const piano=(f,t,vel=1)=>{
    if(t<0||t>3.8)return 0;
    const attack=Math.min(.025,t);
    const env=(t<attack?t/attack:Math.exp(-1.55*(t-attack)))*Math.exp(-Math.max(0,t-3.1)*5);
    const inharm=.0012*f*f/10000;
    return vel*env*(
      .72*Math.sin(2*Math.PI*f*t)+
      .17*Math.sin(2*Math.PI*(2*f+inharm)*t)+
      .075*Math.sin(2*Math.PI*(3*f+inharm*1.7)*t)+
      .028*Math.sin(2*Math.PI*(4*f+inharm*2.4)*t)
    );
  };
  const padVoice=(f,t,vel=1)=>{
    if(t<0)return 0;
    const attack=1.15;
    const env=(1-Math.exp(-t/attack))*Math.exp(-t/18);
    const det=.0018;
    return vel*env*(
      .48*Math.sin(2*Math.PI*f*t)+
      .24*Math.sin(2*Math.PI*f*(1-det)*t)+
      .24*Math.sin(2*Math.PI*f*(1+det)*t)+
      .055*Math.sin(2*Math.PI*2*f*t)
    );
  };
  const bass=(f,t,vel=.045)=>{
    const env=(1-Math.exp(-t/.12))*Math.exp(-t/5.5);
    return vel*env*Math.sin(2*Math.PI*f*t);
  };

  // Eventos: arpegio lento, melodía con silencios y notas de paso siempre
  // pertenecientes al acorde/escala. Nada de notas aleatorias fuera de tono.
  const events=[];
  const arpPatterns=[
    [0,1,2,4,2,1],
    [0,2,1,4,1,2],
    [0,1,4,2],
    [0,2,4,1,2,4,1,0]
  ];
  const arp=arpPatterns[variant];
  for(let b=0;b<8;b++){
    const ch=chords[b];
    for(let j=0;j<arp.length;j++){
      const note=ch.notes[arp[(j+seed+b)%arp.length]];
      const slot=bar/arp.length;
      const swing=variant===2 ? (j%2?beat*.10:0) : 0;
      events.push({t:b*bar+j*slot+.08+swing,f:hz(note),v:ultraCalm ? (.060+(j===0?.015:0)) : (.085+(j===0?.025:0))});
    }
  }

  const melodyPatterns=[
    [4,3,2,3,null,2,1,null],
    [2,3,4,null,3,2,null,1],
    [4,null,3,2,3,null,1,2],
    [2,4,null,3,2,null,3,1]
  ];
  const mp=melodyPatterns[(seed+variant+(ultraCalm?1:0))%melodyPatterns.length];
  for(let b=0;b<8;b++){
    const ch=chords[b];
    for(let j=0;j<8;j++){
      const degree=mp[(j+seed)%mp.length];
      if(degree===null) continue;
      const pool=[
        ch.notes[0]+12,ch.notes[1]+12,ch.notes[2]+12,
        ch.notes[4]+12,ch.notes[1]+14
      ];
      const note=pool[degree%pool.length];
      // Entradas fuera del pulso para una sensación humana y flotante.
      const rhythmOffset=[.18,.05,.28,.10][variant];
      const t=b*bar+j*(beat/2)+beat*(j%2===0?rhythmOffset:.04);
      events.push({t,f:hz(note),v:ultraCalm ? (.050+(j%4===0?.012:0)) : (.095+(j%4===0?.025:0))});
    }
  }

  // Una nota grave por compás: refuerza el centro tonal sin crear un ritmo marcado.
  const bassStep=variant===1 ? bar/2 : bar;
  const bassEvents=[];
  for(let b=0;b<8;b++){
    const ch=chords[b];
    bassEvents.push({t:b*bar,f:hz(ch.root-24),v:variant===3?.045:.055});
    if(variant===1) bassEvents.push({t:b*bar+bassStep,f:hz(ch.root-24),v:.035});
  }
  const eventsByBar=Array.from({length:8},()=>[]);
  for(const ev of events){
    const eb=Math.max(0,Math.min(7,Math.floor(ev.t/bar)));
    eventsByBar[eb].push(ev);
  }

  for(let i=0;i<n;i++){
    const t=i/sr;
    const b=Math.min(7,Math.floor(t/bar));
    const ch=chords[b];
    let left=0,right=0;

    // Pad: cada acorde tiene su propia envolvente; no se reinicia cada ciclo
    // dentro del acorde, evitando clics y cambios artificiales.
    const chordT=t-b*bar;
    const pan=.08*Math.sin(2*Math.PI*t/19);
    const padNotes=[ch.notes[0]-12,ch.notes[1],ch.notes[3],ch.notes[4]];
    const padLevels=ultraCalm ? [.060,.038,.026,.016] : [.045,.028,.020,.012];
    const padScale=variant===0?1.0:variant===1?.88:variant===2?.72:.94;
    for(let p=0;p<padNotes.length;p++){
      const v=padVoice(hz(padNotes[p]),chordT,padLevels[p]*padScale);
      left+=v*(1-pan); right+=v*(1+pan);
    }

    // Bajo ligado al cambio de acorde, sin oscilador permanente que produzca
    // choques armónicos entre acordes.
    const activeBass=bassEvents.filter(x=>x.t<=t).slice(-1)[0];
    const bt=activeBass ? t-activeBass.t : 999;
    const bv=activeBass ? bass(activeBass.f,bt,activeBass.v) : 0;
    left+=bv; right+=bv;

    for(const ev of events){
      const nt=t-ev.t;
      if(nt>=0 && nt<3.8){
        const v=piano(ev.f,nt,ev.v);
        const ep=.06*Math.sin(2*Math.PI*(ev.t+t)/23);
        left+=v*(1-ep); right+=v*(1+ep);
      }
    }
    for(const ev of previousEvents){
      const nt=t-ev.t;
      if(nt>=0 && nt<3.8){
        const v=piano(ev.f,nt,ev.v);
        const ep=.06*Math.sin(2*Math.PI*(ev.t+t)/23);
        left+=v*(1-ep); right+=v*(1+ep);
      }
    }

    // Aire alto muy sutil, siempre basado en la 9ª del acorde.
    const air=padVoice(hz(ch.notes[4]+12),chordT,ultraCalm ? .009 : (variant===2?.012:.006));
    left+=air*.88; right+=air*1.05;

    // Entrada/salida global muy suave para que el preview pueda repetirse.
    const inG=Math.min(1,t/2.2);
    const outG=Math.min(1,(dur-t)/2.8);
    const master=inG*outG;
    left=Math.tanh(left*1.15)*master;
    right=Math.tanh(right*1.15)*master;

    samples[i*2]=clamp(left,-.78,.78);
    samples[i*2+1]=clamp(right,-.78,.78);
  }

  let peak=0;
  for(let i=0;i<samples.length;i++) peak=Math.max(peak,Math.abs(samples[i]));
  const gain=peak>.001?Math.min(1.45,.82/peak):1;
  for(let i=0;i<samples.length;i++) samples[i]*=gain;
  writeWav(wavPath,samples,sr,2);
}
async function ensureBuiltinMusic(tracks=BUILTIN_MUSIC){
  const marker=path.join(MUSIC_DIR,".relaxscape-music-engine-v10");
  if(!fs.existsSync(marker)){try{fs.writeFileSync(marker,MUSIC_ENGINE_VERSION)}catch{}}
  const pending=tracks.filter(t=>!fs.existsSync(path.join(MUSIC_DIR,t.file)));
  await Promise.all(pending.map(async track=>{
    const out=path.join(MUSIC_DIR,track.file), wav=path.join(MUSIC_DIR,"."+track.file+".wav");
    try{
      console.log("[Music v10] Generando:",track.label);
      makeCompositionWav(track,wav);
      await runFfmpeg(["-y","-stream_loop","-1","-i",wav,"-t","24","-c:a","libmp3lame","-b:a","160k","-ar","44100",out]);
      console.log("[Music v10] Lista:",track.file);
    }catch(e){console.error("[Music v10] ERROR",track.file,e.message)}
    finally{try{fs.rmSync(wav,{force:true})}catch{}}
  }));
}
function listFiles(dir, base) {
  return fs.readdirSync(dir)
    .filter(f => !f.startsWith("."))
    .map(f => ({ name: f, url: `${base}/${encodeURIComponent(f)}` }));
}

app.get("/api/library", (_, res) => {
  // La biblioteca nunca genera audio durante la carga de la web.
  // La música se prepara solo cuando el usuario pulsa Crear IA.
  res.json({
    images: listFiles(IMAGE_DIR, "/media/images"),
    music: listFiles(MUSIC_DIR, "/media/music"),
    videos: listFiles(VIDEO_DIR, "/media/videos").reverse()
  });
});

app.post("/api/upload/image", imageUpload.single("image"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No se recibió ninguna imagen." });
  res.json({ name: req.file.filename, url: `/media/images/${encodeURIComponent(req.file.filename)}` });
});

app.get("/api/pexels-landscapes", async (req, res) => {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return res.status(400).json({ error: "Falta PEXELS_API_KEY en Render." });
  const query = String(req.query.query || "peaceful nature landscape").slice(0, 100);
  try {
    const search = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=40&page=${1 + Math.floor(Math.random() * 5)}&orientation=landscape&size=large&locale=en-US`, { headers: { Authorization: key } });
    const data = await search.json();
    if (!search.ok) return res.status(search.status).json({ error: "Pexels: " + (data.error || data.message || ("HTTP " + search.status)) });
    const photos = (data.photos || [])
      .filter(p => p.width >= 1920 && p.height >= 1080 && (p.src?.large2x || p.src?.large))
      .sort((a,b) => (b.width*b.height) - (a.width*a.height))
      .slice(0, 8);
    if (!photos.length) return res.status(404).json({ error: "Pexels no encontró suficientes fotos Full HD para este paisaje." });
    const saved = [];
    for (const photo of photos) {
      const url = photo.src?.large2x || photo.src?.large;
      const r = await fetch(url);
      if (!r.ok) continue;
      const filename = `pexels-${photo.id}-${Date.now()}.jpg`;
      fs.writeFileSync(path.join(IMAGE_DIR, filename), Buffer.from(await r.arrayBuffer()));
      saved.push({ name: filename, url: `/media/images/${encodeURIComponent(filename)}`, photographer: photo.photographer || "Pexels", sourceUrl: photo.url });
    }
    if (!saved.length) return res.status(502).json({ error: "No se pudieron descargar las fotos de Pexels." });
    res.json({ images: saved });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/upload/music", musicUpload.single("music"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No se recibió ninguna pista." });
  res.json({ name: req.file.filename, url: `/media/music/${encodeURIComponent(req.file.filename)}` });
});

app.post("/api/generate-image", async (req, res) => {
  const prompt = String(req.body.prompt || "Ultra-realistic cinematic peaceful landscape, natural light, no people, no text, photorealistic");
  try {
    const item = await generatePollinationsImageFile(
      prompt + ". Wide 16:9 composition, suitable for a premium relaxing video, no text.",
      1
    );
    res.json(item);
  } catch (e) {
    res.status(502).json({ error: "Error de generación IA gratuita: " + e.message });
  }
});



function pollinationsHeaders() {
  const h = {};
  if (process.env.POLLINATIONS_API_KEY) h.Authorization = "Bearer " + process.env.POLLINATIONS_API_KEY;
  return h;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function generatePollinationsImageFile(prompt, index) {
  // Pollinations actualmente puede exigir autenticación en su API. Si no hay
  // una clave gratuita configurada, usamos Pexels como respaldo sin coste.
  const url = "https://gen.pollinations.ai/image/" + encodeURIComponent(prompt) +
    "?width=1920&height=1080&nologo=true&model=flux";
  try {
    const r = await fetchWithTimeout(url, { headers: pollinationsHeaders() }, 30000);
    if (r.ok && (r.headers.get("content-type") || "").includes("image")) {
      const filename = "ai-free-option-" + Date.now() + "-" + index + ".jpg";
      fs.writeFileSync(path.join(IMAGE_DIR, filename), Buffer.from(await r.arrayBuffer()));
      return { name: filename, url: "/media/images/" + encodeURIComponent(filename), ai: true, provider: "Pollinations" };
    }
    throw new Error("Pollinations imagen HTTP " + r.status);
  } catch (pollError) {
    const key = process.env.PEXELS_API_KEY;
    if (!key) throw pollError;
    const q = "peaceful relaxing " + prompt.replace(/[^a-zA-Z0-9áéíóúüñÁÉÍÓÚÜÑ ]/g, " ").slice(0, 100);
    const r = await fetchWithTimeout(
      "https://api.pexels.com/v1/search?query=" + encodeURIComponent(q) +
      "&per_page=15&orientation=landscape&size=large",
      { headers: { Authorization: key } },
      20000
    );
    const data = await r.json().catch(() => ({}));
    const photo = (data.photos || []).find(p => p.src?.large2x || p.src?.large);
    if (!r.ok || !photo) throw pollError;
    const img = await fetchWithTimeout(photo.src?.large2x || photo.src.large, {}, 20000);
    if (!img.ok) throw pollError;
    const filename = "free-landscape-option-" + Date.now() + "-" + index + ".jpg";
    fs.writeFileSync(path.join(IMAGE_DIR, filename), Buffer.from(await img.arrayBuffer()));
    return {
      name: filename,
      url: "/media/images/" + encodeURIComponent(filename),
      ai: false,
      provider: "Pexels",
      fallback: true
    };
  }
}

async function generatePollinationsMusicFile(prompt, index) {
  const url = "https://gen.pollinations.ai/audio/" + encodeURIComponent(prompt);
  const r = await fetchWithTimeout(url, { headers: pollinationsHeaders() }, 12000);
  if (!r.ok) throw new Error("Pollinations música HTTP " + r.status);
  const type = r.headers.get("content-type") || "";
  if (!type.includes("audio") && !type.includes("mpeg") && !type.includes("octet-stream")) {
    throw new Error("Pollinations no devolvió audio.");
  }
  const filename = "ai-free-music-" + Date.now() + "-" + index + ".mp3";
  fs.writeFileSync(path.join(MUSIC_DIR, filename), Buffer.from(await r.arrayBuffer()));
  return { name: filename, url: "/media/music/" + encodeURIComponent(filename), ai: true, provider: "Pollinations" };
}


async function generateLyriaMusicFile(prompt, index=1) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY no configurada");
  const r = await fetchWithTimeout("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      model: "lyria-3-clip-preview",
      input: prompt,
      response_format: { type: "audio" }
    })
  }, 45000);
  const data = await r.json();
  if (!r.ok) throw new Error(data.error?.message || ("Lyria HTTP " + r.status));
  const b64 = data.output_audio?.data;
  if (!b64) throw new Error("Lyria no devolvió audio.");
  const filename = "ai-lyria-relax-" + Date.now() + "-" + index + ".mp3";
  fs.writeFileSync(path.join(MUSIC_DIR, filename), Buffer.from(b64, "base64"));
  return { name: filename, url: "/media/music/" + encodeURIComponent(filename), ai: true, provider: "Google Lyria 3", generated: true, fallback: false };
}

function makeFallbackLandscape(filename, theme="nature") {
  const safeTheme = String(theme).replace(/[&<>"]/g, "");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
  <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#102a43"/><stop offset="0.55" stop-color="#4b7a8f"/><stop offset="1" stop-color="#d8b47a"/></linearGradient><linearGradient id="water" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#294f63"/><stop offset="1" stop-color="#0b2638"/></linearGradient></defs>
  <rect width="1920" height="1080" fill="url(#sky)"/><circle cx="1510" cy="270" r="115" fill="#ffe7ad" opacity=".9"/>
  <path d="M0 720 L360 410 L610 690 L900 300 L1280 720 L1530 430 L1920 760 L1920 1080 L0 1080Z" fill="#183747"/>
  <path d="M0 790 L430 570 L760 800 L1080 500 L1410 820 L1700 600 L1920 790 L1920 1080 L0 1080Z" fill="#102936"/>
  <path d="M0 820 Q480 760 960 830 T1920 810 L1920 1080 L0 1080Z" fill="url(#water)" opacity=".95"/>
  <text x="70" y="1010" fill="#fff" opacity=".55" font-family="Arial" font-size="34">RelaxScape · ${safeTheme}</text></svg>`;
  fs.writeFileSync(path.join(IMAGE_DIR, filename), svg);
  return { name: filename, url: "/media/images/" + encodeURIComponent(filename), ai: false, provider: "RelaxScape local fallback", fallback: true, label: "Paisaje relajante" };
}

let aiMusicPreparing = false;
let aiMusicTracks = [];

function getAIMusicOptions(){
  const defs = aiMusicTracks.length ? aiMusicTracks : [
    { ...BUILTIN_MUSIC[0], label:"Piano nocturno" },
    { ...BUILTIN_MUSIC[1], label:"Piano y océano" },
    { ...BUILTIN_MUSIC[16], label:"Piano y lluvia" },
    { ...BUILTIN_MUSIC[3], label:"Piano soñador" }
  ];
  return defs.map(t => {
    if(!t || !t.file || !fs.existsSync(path.join(MUSIC_DIR,t.file))) return null;
    return {
      name:t.file,
      url:"/media/music/"+encodeURIComponent(t.file),
      ai:true,
      provider:"RelaxScape Ambient Engine",
      generated:true,
      fallback:false,
      label:t.label,
      category:t.category
    };
  }).filter(Boolean);
}

app.post("/api/ai-options", async (req, res) => {
  const theme = String(req.body?.theme || "peaceful lake, misty mountains, soft dawn light").trim().slice(0, 120);
  const musicPrompt = String(req.body?.musicPrompt || "very slow peaceful ambient piano, warm soft pads, gentle evolving harmony, deep calm atmosphere, spacious reverb, no drums, no rhythmic pulse").trim().slice(0, 220);
  const images = [];
  const imageErrors = [];

  try {
    const key = process.env.PEXELS_API_KEY;
    if (!key) throw new Error("Falta PEXELS_API_KEY en Render.");
    const r = await fetchWithTimeout(
      "https://api.pexels.com/v1/search?query=" + encodeURIComponent(theme + " peaceful nature") +
      "&per_page=30&orientation=landscape&size=large&locale=en-US",
      { headers: { Authorization: key } }, 8000
    );
    if (!r.ok) throw new Error("Pexels HTTP " + r.status);
    const data = await r.json();
    const pool = (data.photos || [])
      .filter(p => p.src?.large || p.src?.large2x)
      .sort(() => Math.random() - 0.5)
      .slice(0, 4);
    pool.forEach((photo,i) => {
      const src=photo.src?.large || photo.src?.large2x;
      images.push({name:"pexels-"+photo.id+".jpg",url:src,sourceUrl:src,ai:false,provider:"Pexels",fallback:false,label:"Paisaje gratuito "+(i+1)});
    });
    if(images.length<4) imageErrors.push("Pexels devolvió "+images.length+" de 4 imágenes.");
  } catch(e) {
    imageErrors.push(e.message || "Error de Pexels");
  }

  if(images.length<4){
    const needed=4-images.length;
    for(let i=0;i<needed;i++){
      const filename="relaxscape-local-landscape-"+Date.now()+"-"+i+".svg";
      images.push(makeFallbackLandscape(filename,theme));
    }
    imageErrors.push("Se completaron los 4 paisajes con fondos locales porque Pexels no devolvió suficientes resultados.");
  }

  // Generamos las 4 previews aquí antes de responder. Así las tarjetas nunca
  // apuntan a archivos inexistentes y el audio se puede reproducir inmediatamente.
  aiMusicTracks = aiTracksForBackground(musicPrompt);
  aiMusicPreparing = true;
  try {
    await ensureBuiltinMusic(aiMusicTracks);
  } catch(e) {
    console.error("[AI Music] preparación:",e.message);
  } finally {
    aiMusicPreparing = false;
  }
  const music=getAIMusicOptions();
  res.json({
    images,
    music,
    musicReady:music.length>=4,
    musicPreparing:false,
    imageErrors,
    musicErrors:music.length<4?["No se pudieron crear las 4 previews musicales."]:[],
    provider:"RelaxScape Free"
  });
});

function hashText(text){
  let h=2166136261;
  for(const ch of String(text)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)}
  return (h>>>0).toString(36);
}
function aiTracksForBackground(prompt=""){ 
  const p=String(prompt||"very slow peaceful ambient piano, warm soft pads, spacious reverb, no drums").slice(0,220);
  const seedBase=parseInt(hashText(p),36)||1;
  const bases=[
    [196,246.94,293.66],[174.61,220,261.63],[146.83,196,246.94],[164.81,220,277.18]
  ];
  return bases.map((f,i)=>{
    const b=BUILTIN_MUSIC[i];
    const shift=((seedBase+i*7)%7)-3;
    const variant=i;
    const profiles=[
      "variation 1: flowing piano and warm pads, spacious and legato",
      "variation 2: softer minor/dorian atmosphere, sparse melody and long notes",
      "variation 3: gentle rhythmic pulse, wider arpeggio and brighter air texture",
      "variation 4: deep cinematic ambient, different chord voicings and descending melody"
    ];
    return {...b,
      file:"ai-prompt-"+hashText(p)+"-v10-"+(i+1)+".mp3",
      label:"IA · "+(i+1),
      variant,
      f1:f[0]*Math.pow(2,shift/12),f2:f[1]*Math.pow(2,shift/12),f3:f[2]*Math.pow(2,shift/12),
      musicProfile:p+" "+profiles[i]
    };
  });
}

app.get("/api/ai-options-status", (_,res)=>{
  const music=getAIMusicOptions();
  res.json({music,musicReady:music.length>=4,musicPreparing:aiMusicPreparing});
});

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, args);
    let stderr = "";
    p.stderr.on("data", d => stderr += d.toString());
    p.on("close", code => code === 0 ? resolve() : reject(new Error(stderr.slice(-4000))));
  });
}


app.post("/api/generate-relax-mix", async (req, res) => {
  const hours = Number(req.body?.durationHours || 1);
  if (![1, 2].includes(hours)) return res.status(400).json({ error: "La duración debe ser de 1 o 2 horas." });
  try {
    await ensureBuiltinMusic();
    const available = BUILTIN_MUSIC.map(t => path.join(MUSIC_DIR, t.file)).filter(fs.existsSync);
    if (available.length < 6) return res.status(503).json({ error: "La biblioteca musical todavía no está lista." });

    // No renderizamos 24 pistas completas: creamos un collage corto y lo repetimos.
    // Esto hace que la generación tarde segundos/minutos, no una hora real de FFmpeg.
    const selected = [...available].sort(() => Math.random() - 0.5).slice(0, Math.min(12, available.length));
    const stamp = Date.now();
    const workDir = path.join(MUSIC_DIR, "mix-" + stamp);
    fs.mkdirSync(workDir, { recursive: true });
    const basePath = path.join(workDir, "base.mp3");
    const finalName = "relaxscape-relax-mix-" + hours + "h-" + stamp + ".mp3";
    const finalPath = path.join(MUSIC_DIR, finalName);

    try {
      const inputs = [];
      const filters = [];
      for (let i = 0; i < selected.length; i++) {
        inputs.push("-i", selected[i]);
        filters.push("[" + i + ":a]aresample=44100,volume=0.82[a" + i + "]");
      }
      let current = "a0";
      for (let i = 1; i < selected.length; i++) {
        const next = "mix" + i;
        filters.push("[" + current + "][a" + i + "]acrossfade=d=4:c1=tri:c2=tri[" + next + "]");
        current = next;
      }

      await runFfmpeg(["-y", ...inputs, "-filter_complex", filters.join(";"), "-map", "[" + current + "]", "-t", "300", "-c:a", "libmp3lame", "-b:a", "128k", basePath]);
      // El archivo final se crea como un bucle rápido. No se recodifica toda la hora.
      await runFfmpeg(["-y", "-stream_loop", "-1", "-i", basePath, "-t", String(hours * 3600), "-c:a", "copy", finalPath]);

      res.json({
        name: finalName,
        url: "/media/music/" + encodeURIComponent(finalName),
        hours,
        provider: "RelaxScape",
        type: "mixed-library",
        tracks: selected.map(f => path.basename(f)),
        styles: [...new Set(BUILTIN_MUSIC.map(x => x.category))]
      });
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  } catch (e) {
    console.error("Error creando mezcla RelaxScape:", e.message);
    res.status(500).json({ error: "No se pudo crear la mezcla relajante: " + e.message });
  }
});

app.post("/api/generate-selected-long-music", async (req,res)=>{
  const { music, durationHours=1 }=req.body||{};
  if(!music) return res.status(400).json({error:"Selecciona una música de previa."});
  const hours=Number(durationHours);
  if(![1,2].includes(hours)) return res.status(400).json({error:"La duración debe ser de 1 o 2 horas."});
  const name=decodeURIComponent(String(music).split("/").pop());
  const source=path.join(MUSIC_DIR,name);
  if(!fs.existsSync(source)) return res.status(404).json({error:"No se encontró la previa musical seleccionada."});
  const stamp=Date.now(), work=path.join(MUSIC_DIR,"long-"+stamp), base=path.join(work,"base.mp3");
  const finalName="relaxscape-selected-"+hours+"h-"+stamp+".mp3", out=path.join(MUSIC_DIR,finalName);
  fs.mkdirSync(work,{recursive:true});
  try{
    // Convertimos la previa en un bloque de 6 minutos con un crossfade
    // central y después lo repetimos hasta completar exactamente la duración.
    await runFfmpeg(["-y","-i",source,"-i",source,
      "-filter_complex","[0:a]aresample=44100,volume=.96[a0];[1:a]aresample=44100,volume=.96[a1];[a0][a1]acrossfade=d=8:c1=tri:c2=tri[base]",
      "-map","[base]","-c:a","libmp3lame","-b:a","160k",base]);
    await runFfmpeg(["-y","-stream_loop","-1","-i",base,"-t",String(hours*3600),
      "-c:a","libmp3lame","-b:a","160k","-ar","44100",out]);
    res.json({name:finalName,url:"/media/music/"+encodeURIComponent(finalName),hours,sourcePreview:name,provider:"RelaxScape Ambient Engine"});
  }catch(e){
    console.error("Error creando música larga desde previa:",e.message);
    res.status(500).json({error:"No se pudo crear el audio largo: "+e.message});
  }finally{fs.rmSync(work,{recursive:true,force:true})}
});

app.post("/api/generate-video", async (req, res) => {
  const { image, music, durationHours = 1 } = req.body || {};
  if (!image || !music) return res.status(400).json({ error: "Selecciona una imagen y una pista de música." });
  const imageName = decodeURIComponent(image.split("/").pop());
  const musicName = decodeURIComponent(music.split("/").pop());
  let imagePath = path.join(IMAGE_DIR, imageName);
  if (!fs.existsSync(imagePath) && /^https?:\/\//i.test(image)) {
    const downloaded = await fetchWithTimeout(image, {}, 8000);
    if (!downloaded.ok) return res.status(502).json({ error: "No se pudo descargar el paisaje seleccionado." });
    const localName = "selected-pexels-" + Date.now() + ".jpg";
    imagePath = path.join(IMAGE_DIR, localName);
    fs.writeFileSync(imagePath, Buffer.from(await downloaded.arrayBuffer()));
  }
  const musicPath = path.join(MUSIC_DIR, musicName);
  if (!fs.existsSync(imagePath) || !fs.existsSync(musicPath)) return res.status(404).json({ error: "No se encontró el archivo seleccionado." });
  const hours = Number(durationHours);
  if (hours !== 1) return res.status(400).json({ error: "RelaxScape genera vídeos de 1 hora." });
  const filename = `relaxscape-${Date.now()}-${hours}h.mp4`;
  const out = path.join(VIDEO_DIR, filename);
  try {
    await runFfmpeg([
      "-y","-loop","1","-i",imagePath,"-stream_loop","-1","-i",musicPath,
      "-t",String(hours*3600),
      "-vf","scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
      "-c:v","libx264","-preset","veryfast","-crf","23","-c:a","aac","-b:a","160k","-shortest",out
    ]);
    res.json({ url: `/media/videos/${filename}`, name: filename });
  } catch (e) { res.status(500).json({ error: "No se pudo generar el vídeo: " + e.message }); }
});

async function generatePexelsVideo(prompt, aspectRatio, key, durationHours = 1) {
  const rawPrompt = String(prompt || "peaceful nature landscape");
  const aliases = {
    lluvia: "rain nature drops",
    bosque: "forest woodland nature",
    oceano: "ocean sea waves",
    mar: "ocean sea waves",
    montanas: "mountains mountain landscape",
    montaña: "mountains mountain landscape",
    lago: "lake water landscape",
    nieve: "snow winter landscape",
    playa: "beach ocean coast",
    atardecer: "sunset golden hour landscape",
    amanecer: "sunrise dawn landscape",
    cascada: "waterfall nature",
    rio: "river flowing water nature",
    fuego: "fireplace fire cozy",
    nubes: "clouds sky"
  };

  const normalized = rawPrompt.toLowerCase();
  const extra = Object.entries(aliases)
    .filter(([word]) => normalized.includes(word))
    .map(([, terms]) => terms)
    .join(" ");

  const query = (rawPrompt + " " + extra)
    .replace(/[^a-zA-Z0-9áéíóúüñÁÉÍÓÚÜÑ ,.-]/g, " ")
    .replace(/\s+/g, " ").trim().slice(0, 180) || "peaceful nature landscape";

  const hours = Number(durationHours);
  if (![1, 2].includes(hours)) throw new Error("La duración debe ser de 1 o 2 horas.");

  const orientation = aspectRatio === "9:16" ? "portrait" : "landscape";
  const page = 1 + Math.floor(Math.random() * 5);

  // Usamos FOTOS de Pexels: hay mucha más variedad que en vídeo.
  // Pedimos muchos resultados y después escogemos varias fotos de máxima calidad.
  const search = await fetch(
    `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=80&page=${page}&orientation=${orientation}&size=large&locale=en-US`,
    { headers: { Authorization: key } }
  );
  const data = await search.json();
  if (!search.ok) throw new Error("Pexels: " + (data.error || data.message || ("HTTP " + search.status)));

  const photos = (data.photos || []).filter(p => p.src?.large2x || p.src?.large);
  if (!photos.length) throw new Error("Pexels no encontró fotos para esa búsqueda. Prueba con otro paisaje.");

  const targetW = aspectRatio === "9:16" ? 1080 : 1920;
  const targetH = aspectRatio === "9:16" ? 1920 : 1080;
  const targetPixels = targetW * targetH;

  const candidates = photos
    .map(photo => {
      const src = photo.src?.large2x || photo.src?.large || photo.src?.original;
      const width = Number(photo.width || 0);
      const height = Number(photo.height || 0);
      const pixels = width * height;
      const isPortrait = height > width;
      const correctOrientation = aspectRatio === "9:16" ? isPortrait : !isPortrait;
      return { photo, src, width, height, pixels, correctOrientation };
    })
    .filter(x => x.src && x.correctOrientation && x.width >= targetW * 0.8 && x.height >= targetH * 0.8);

  if (!candidates.length) {
    throw new Error("Pexels no encontró fotos con resolución suficiente para ese formato.");
  }

  // Primero calidad: nos quedamos con el 35% de mayor resolución.
  candidates.sort((a, b) => b.pixels - a.pixels);
  const qualityPoolSize = Math.max(12, Math.ceil(candidates.length * 0.35));
  const qualityPool = candidates.slice(0, qualityPoolSize);

  // Después variedad: seleccionamos 10 fotos aleatorias del grupo de mayor calidad.
  const shuffled = qualityPool.sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, Math.min(10, shuffled.length));

  if (selected.length < 4) {
    throw new Error("Pexels no encontró suficientes fotos de calidad para crear la secuencia.");
  }

  const stamp = Date.now();
  const workDir = path.join(VIDEO_DIR, `photo-${stamp}`);
  const finalName = `relaxscape-photos-${stamp}-${hours}h.mp4`;
  const finalPath = path.join(VIDEO_DIR, finalName);
  fs.mkdirSync(workDir, { recursive: true });

  try {
    console.log("[Pexels Fotos] Seleccionadas:", selected.map(x => x.photo.id).join(", "));

    // Descargamos las fotos seleccionadas en paralelo.
    await Promise.all(selected.map(async (item, i) => {
      const r = await fetch(item.src);
      if (!r.ok) throw new Error("No se pudo descargar una foto de Pexels (HTTP " + r.status + ").");
      fs.writeFileSync(path.join(workDir, `photo-${i}.jpg`), Buffer.from(await r.arrayBuffer()));
    }));

    // Creamos solo un clip corto (~60 s) y lo repetimos en el navegador.
    // Así la generación sigue siendo rápida aunque el usuario elija 1 o 2 horas.
    const clipSeconds = 6;
    const inputs = [];
    const filters = [];

    for (let i = 0; i < selected.length; i++) {
      inputs.push("-loop", "1", "-t", String(clipSeconds), "-i", path.join(workDir, `photo-${i}.jpg`));
      filters.push(
        `[${i}:v]scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH},setsar=1,format=yuv420p[v${i}]`
      );
    }

    const concatInputs = selected.map((_, i) => `[v${i}]`).join("");
    filters.push(`${concatInputs}concat=n=${selected.length}:v=1:a=0[outv]`);

    const clipPath = path.join(workDir, "slideshow.mp4");
    await runFfmpeg([
      "-y",
      ...inputs,
      "-filter_complex", filters.join(";"),
      "-map", "[outv]",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "20",
      "-movflags", "+faststart",
      clipPath
    ]);

    fs.renameSync(clipPath, finalPath);

    return {
      name: finalName,
      url: `/media/videos/${finalName}`,
      source: "Pexels Photos",
      sourceUrl: "https://www.pexels.com/",
      resolution: `${targetW}x${targetH}`,
      photos: selected.length,
      durationHours: hours,
      loop: true,
      clipDurationSeconds: selected.length * clipSeconds
    };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

app.post("/api/generate-ai-video", async (req, res) => {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return res.status(400).json({ error: "Añade PEXELS_API_KEY en Render. La API de Pexels es gratuita y permite seleccionar paisajes de alta calidad." });
  const prompt = req.body.prompt || "peaceful cinematic nature landscape, relaxing atmosphere, no people, no text";
  const aspectRatio = req.body.aspectRatio === "9:16" ? "9:16" : "16:9";
  try {
    const durationHours = Number(req.body.durationHours || 1);
    const result = await generatePexelsVideo(prompt, aspectRatio, key, durationHours);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/generate-ai-music", async (req, res) => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(400).json({ error: "Añade GEMINI_API_KEY en Render para activar Lyria." });
  const base = req.body.prompt || "Peaceful ambient music for sleep and relaxation, soft piano and warm pads.";
  const mode = req.body.mode === "song" ? "Create a complete song with a gentle arrangement." : "Instrumental only, no vocals, no lyrics.";
  const prompt = `${base}. ${mode} Suitable for a relaxing visual landscape video.`;
  try {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ model: "lyria-3.5", input: prompt, response_format: { type: "audio" } })
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data.error?.message || "No se pudo generar la música." });
    const b64 = data.output_audio?.data;
    if (!b64) throw new Error("Lyria terminó pero no devolvió audio.");
    const filename = `ai-music-${Date.now()}.mp3`;
    fs.writeFileSync(path.join(MUSIC_DIR, filename), Buffer.from(b64, "base64"));
    res.json({ name: filename, url: `/media/music/${filename}` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});



app.post("/api/mux-video-audio", async (req, res) => {
  const { video, music, durationHours = 1 } = req.body || {};
  if (!video || !music) return res.status(400).json({ error: "Faltan el vídeo o la música." });
  const videoName = decodeURIComponent(video.split("/").pop());
  const musicName = decodeURIComponent(music.split("/").pop());
  const videoPath = path.join(VIDEO_DIR, videoName);
  const musicPath = path.join(MUSIC_DIR, musicName);
  if (!fs.existsSync(videoPath) || !fs.existsSync(musicPath)) return res.status(404).json({ error: "No se encontró el archivo para mezclar." });
  const hours = Number(durationHours);
  if (![1, 2].includes(hours)) return res.status(400).json({ error: "La duración debe ser de 1 o 2 horas." });
  const filename = `ai-relax-${Date.now()}-${hours}h.mp4`;
  const out = path.join(VIDEO_DIR, filename);
  try {
    await runFfmpeg([
      "-y","-stream_loop","-1","-i",videoPath,"-stream_loop","-1","-i",musicPath,
      "-t",String(hours * 3600),
      "-map","0:v:0","-map","1:a:0","-c:v","libx264","-preset","veryfast","-crf","24","-c:a","aac","-b:a","160k",out
    ]);
    res.json({ name: filename, url: `/media/videos/${filename}` });
  } catch (e) { res.status(500).json({ error: "No se pudo mezclar vídeo y música: " + e.message }); }
});

async function refreshDailyLandscape() {
  const key = process.env.PEXELS_API_KEY;
  if (!key) throw new Error("Falta PEXELS_API_KEY para renovar el paisaje diario.");
  const queries = [
    "peaceful mountain lake sunrise","calm ocean sunset","misty forest nature",
    "rainy window nature","waterfall peaceful nature","snowy mountains landscape",
    "starry night landscape","peaceful river valley","clouds over mountains",
    "tropical beach calm ocean"
  ];
  const query = queries[Math.floor(Math.random() * queries.length)];
  const page = 1 + Math.floor(Math.random() * 10);
  const r = await fetch(
    `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=40&page=${page}&orientation=landscape&size=large&locale=en-US`,
    { headers: { Authorization: key } }
  );
  const data = await r.json();
  if (!r.ok) throw new Error("Pexels: " + (data.error || data.message || ("HTTP " + r.status)));
  const photos = (data.photos || []).filter(p =>
    p.width >= 1920 && p.height >= 1080 && (p.src?.large2x || p.src?.large)
  );
  if (!photos.length) throw new Error("Pexels no encontró un paisaje diario en Full HD.");
  const photo = photos[Math.floor(Math.random() * photos.length)];
  const url = photo.src?.large2x || photo.src?.large;
  const img = await fetch(url);
  if (!img.ok) throw new Error("No se pudo descargar el paisaje diario.");
  const today = new Date().toISOString().slice(0, 10);
  const filename = `daily-landscape-${today}-${photo.id}.jpg`;
  fs.writeFileSync(path.join(IMAGE_DIR, filename), Buffer.from(await img.arrayBuffer()));
  return { name: filename, url: `/media/images/${encodeURIComponent(filename)}`, photographer: photo.photographer || "Pexels", sourceUrl: photo.url };
}

async function generateDaily() {
  const music = listFiles(MUSIC_DIR, "/media/music");
  if (!music.length) return console.log("Daily render omitido: falta música.");
  try {
    const dailyImage = await refreshDailyLandscape();
    const today = new Date().toISOString().slice(0, 10);
    const dayNumber = Math.floor(Date.parse(today + "T00:00:00Z") / 86400000);
    const musicPool = music.filter(x => !x.name.startsWith("ai-music-"));
    const pool = musicPool.length ? musicPool : music;
    const musicItem = pool[((dayNumber % pool.length) + pool.length) % pool.length];

    const imagePath = path.join(IMAGE_DIR, dailyImage.name);
    const musicPath = path.join(MUSIC_DIR, musicItem.name);
    const filename = `daily-${today}.mp4`;
    const out = path.join(VIDEO_DIR, filename);

    await runFfmpeg([
      "-y","-loop","1","-i",imagePath,"-stream_loop","-1","-i",musicPath,"-t","3600",
      "-vf","scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
      "-c:v","libx264","-preset","veryfast","-crf","23","-c:a","aac","-b:a","160k","-shortest",out
    ]);
    console.log("Daily video creado:", filename, "paisaje:", dailyImage.name, "música:", musicItem.name);
  } catch (e) {
    console.error("Daily render error:", e.message);
  }
}


app.get("/health", (_, res) => res.json({ ok: true, service: "RelaxScape", musicEngine: MUSIC_ENGINE_VERSION }));

try {
  const rawHour = Number(process.env.DAILY_VIDEO_HOUR ?? 7);
  const hour = Number.isInteger(rawHour) && rawHour >= 0 && rawHour <= 23 ? rawHour : 7;
  cron.schedule("0 " + hour + " * * *", generateDaily);
  console.log("[Cron] Programado a las", hour + ":00");
} catch (e) {
  console.error("[Cron] Desactivado por configuración inválida:", e.message);
}

process.on("unhandledRejection", e => console.error("[UnhandledRejection]", e));
process.on("uncaughtException", e => console.error("[UncaughtException]", e));

app.get("*splat", (_, res) => res.sendFile(path.join(PUBLIC, "index.html")));

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`RelaxScape activo en http://localhost:${port}`);
});