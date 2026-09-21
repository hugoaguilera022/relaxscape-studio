import express from "express";
import cors from "cors";
import multer from "multer";
import path from "path";
import fs from "fs";
import { createHash } from "crypto";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import cron from "node-cron";
import ffmpegPath from "ffmpeg-static";
import { InferenceClient } from "@huggingface/inference";

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
// AI previews must never be browser-cached: each generation must play the exact MP3
// returned by the current generation, not a previous preview with a stale cache entry.
app.use("/media/music", (req,res,next)=>{
  res.setHeader("Cache-Control","no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma","no-cache");
  res.setHeader("Expires","0");
  next();
}, express.static(MUSIC_DIR, { etag:false, lastModified:false, maxAge:0 }));
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

// Fetch con timeout real para que una API externa nunca bloquee la generación.
async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

const MUSIC_ENGINE_VERSION = "v26-local-only-music-engine";

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
  // Motor musical procedural: la búsqueda controla de forma fuerte la composición.
  // No reutiliza una melodía fija: hash + variante determinan estructura, armonía,
  // instrumento principal, registro, tempo, motivo, densidad y movimiento estéreo.
  // Previa corta para que Render pueda generar las 4 opciones rápidamente.
  // La versión larga se construye después a partir de esta composición.
  const sr=24000, dur=18, n=sr*dur, samples=new Float32Array(n*2);
  const variant=((Number(track.variant||1)-1)%4+4)%4;
  const brief=String(track.userSearch||track.originalMusicPrompt||track.musicProfile||"relaxscape").toLowerCase();
  const hz=m=>440*Math.pow(2,(m-69)/12);
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const has=(...w)=>w.some(x=>brief.includes(x));
  const semantic={
    rain:has("rain","lluvia","storm","tormenta"),
    ocean:has("ocean","océano","oceano","sea","mar","waves","olas"),
    forest:has("forest","bosque","woodland","pájaros","pajaros"),
    mountain:has("mountain","montaña","montana","alpine"),
    night:has("night","noche","moon","luna","stars","estrellas"),
    sunset:has("sunset","atardecer","golden hour","ocaso"),
    sleep:has("sleep","sueño","sueno","dormir"),
    meditation:has("meditation","meditación","meditacion","zen","mindfulness","yoga","breathing","respiración"),
    piano:has("piano","teclas"),
    guitar:has("guitar","guitarra","acoustic","nylon"),
    strings:has("strings","cuerdas","violin","violín","cello","viola","orchestral","cinematic","cinemático"),
    flute:has("flute","flauta","bamboo","bambú"),
    synth:has("synth","sintetizador","electronic","electrónica","ambient"),
    dark:has("dark","oscuro","deep","profundo"),
    bright:has("bright","luminoso","sunrise","amanecer","sun"),
    cinematic:has("cinematic","cinemático","film","orchestral"),
    warm:has("warm","cálido","calido","cozy","acogedor")
  };

  // FNV-1a completo + PRNG determinista. Dos búsquedas distintas producen
  // secuencias de decisiones distintas incluso si comparten palabras "relax".
  let h=2166136261>>>0;
  const seedText=String(track.userSearch||track.originalMusicPrompt||"relaxscape")+"|v="+variant+"|"+String(track.generationSeed||"");
  for(const ch of seedText){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}
  let rngState=(h^((variant+1)*0x9e3779b9))>>>0;
  const rnd=()=>{rngState^=rngState<<13;rngState^=rngState>>>17;rngState^=rngState<<5;rngState>>>=0;return rngState/4294967296};
  const pick=a=>a[Math.floor(rnd()*a.length)];

  const scaleSets=[
    [0,2,4,7,9], [0,2,3,5,7,9,10], [0,2,3,5,7,8,10],
    [0,2,4,6,7,9,11], [0,1,3,5,7,8,10], [0,2,3,6,7,9,10]
  ];
  let scale=pick(scaleSets);
  if(semantic.dark||semantic.night) scale=[0,2,3,5,7,8,10];
  if(semantic.bright||semantic.sunset) scale=pick([[0,2,4,7,9],[0,2,4,6,7,9,11]]);
  if(semantic.ocean) scale=pick([[0,2,4,7,9],[0,2,3,5,7,9,10]]);
  let root=42+Math.floor(rnd()*24);
  if(semantic.ocean) root=50+Math.floor(rnd()*10);
  if(semantic.night||semantic.sleep) root-=5;
  if(semantic.bright||semantic.sunset) root+=5;

  let bpm=34+Math.floor(rnd()*17);
  if(semantic.sleep) bpm=32+Math.floor(rnd()*7);
  if(semantic.meditation) bpm=36+Math.floor(rnd()*8);
  if(semantic.ocean) bpm=38+Math.floor(rnd()*9);
  if(semantic.cinematic) bpm=40+Math.floor(rnd()*8);
  const beat=60/bpm, bar=beat*4;
  const degree=(d,o=0)=>root+scale[((d%scale.length)+scale.length)%scale.length]+12*o;

  const palettes=[
    "piano","strings","synth","guitar","flute","glass","pluck"
  ];
  // BLOQUEO ESTRICTO DE LA BÚSQUEDA:
  // Las variantes ya NO pueden cambiar el instrumento principal por azar.
  // Si el usuario pide un instrumento, ese instrumento manda en las 4 pistas.
  // Si pide "solo/únicamente", no añadimos otros instrumentos melódicos.
  const explicitInstrumentCount=[semantic.piano,semantic.guitar,semantic.flute,semantic.strings,semantic.synth].filter(Boolean).length;
  const soloMode=/\\b(solo|solamente|únicamente|unicamente|only|just)\\b/.test(brief);
  const requestedLead=semantic.piano?"piano":semantic.guitar?"guitar":semantic.flute?"flute":semantic.strings?"strings":semantic.synth?"synth":null;
  let lead=requestedLead;
  if(!lead){
    if(semantic.rain||semantic.ocean) lead="synth";
    else if(semantic.forest) lead="flute";
    else if(semantic.mountain) lead="strings";
    else if(semantic.night||semantic.sleep) lead="piano";
    else lead=pick(palettes);
  }
  // En modo explícito, las cuatro opciones comparten el mismo lead requerido.
  // Solo cambian melodía, registro y textura, nunca el significado de la búsqueda.
  if(soloMode && requestedLead) lead=requestedLead;

  const piano=(f,t,v=1)=>{
    if(t<0||t>7)return 0;
    const attack=Math.min(1,t/.008);
    const decay=Math.exp(-t*(1.15+Math.min(f,1200)/2200));
    const hammer=Math.exp(-t/0.055);
    const body=Math.exp(-t/3.8);
    const inharm=1+0.000015*f;
    const p=attack*(.58*hammer+.42*body);
    return v*p*(.72*Math.sin(2*Math.PI*f*inharm*t)+.18*Math.sin(2*Math.PI*2.01*f*t)+.065*Math.sin(2*Math.PI*3.02*f*t)+.025*Math.sin(2*Math.PI*4.05*f*t));
  };
  const pianoPedal=(f,t,v=1)=>{
    if(t<0||t>8)return 0;
    return v*(1-Math.exp(-t/.03))*Math.exp(-t/6.5)*(.45*Math.sin(2*Math.PI*f*t)+.12*Math.sin(2*Math.PI*2.01*f*t)+.035*Math.sin(2*Math.PI*3.02*f*t));
  };
  const guitar=(f,t,v=1)=>t<0||t>4?0:v*Math.min(1,t/.008)*Math.exp(-t/1.9)*(.68*Math.sin(2*Math.PI*f*t)+.22*Math.sin(4*Math.PI*f*t)+.07*Math.sin(6*Math.PI*f*t));
  const pluck=(f,t,v=1)=>t<0||t>3?0:v*Math.min(1,t/.006)*Math.exp(-t/1.45)*(.62*Math.sin(2*Math.PI*f*t)+.25*Math.sin(4*Math.PI*f*t)+.10*Math.sin(8*Math.PI*f*t));
  const strings=(f,t,v=1)=>t<0?0:v*(1-Math.exp(-t/1.2))*Math.exp(-t/9)*(.42*Math.sin(2*Math.PI*f*t)+.36*Math.sin(4*Math.PI*f*t)+.16*Math.sin(6*Math.PI*f*t)+.06*Math.sin(8*Math.PI*f*t));
  const synth=(f,t,v=1)=>t<0?0:v*(1-Math.exp(-t/1.0))*Math.exp(-t/13)*(.34*Math.sin(2*Math.PI*f*t)+.25*Math.sin(2*Math.PI*f*1.007*t)+.18*Math.sin(2*Math.PI*f*.993*t)+.10*Math.sin(2*Math.PI*f/2*t));
  const flute=(f,t,v=1)=>t<0||t>5?0:v*Math.min(1,t/.14)*Math.exp(-t/3.5)*(.80*Math.sin(2*Math.PI*f*(1+.004*Math.sin(2*Math.PI*5*t))*t)+.13*Math.sin(4*Math.PI*f*t)+.04*Math.sin(6*Math.PI*f*t));
  const glass=(f,t,v=1)=>t<0||t>4?0:v*Math.min(1,t/.004)*Math.exp(-t/2.8)*(.55*Math.sin(2*Math.PI*f*t)+.25*Math.sin(2*Math.PI*2.01*f*t)+.12*Math.sin(2*Math.PI*3.97*f*t));

  const events=[];
  // Tres barras son suficientes para una previa de 18 s y reducen muchísimo
  // el coste de CPU en Render.
  const progressionOptions=[
    [0,3,5,4,0,2,3,1,0],[0,5,3,4,1,0,3,5,0],[0,2,4,1,3,5,2,4,0],
    [0,4,2,5,3,1,4,2,0],[0,1,4,3,5,2,1,4,0],[0,5,1,4,2,3,5,1,0]
  ];
  const progression=pick(progressionOptions);
  const motifPool=[
    [0,1,2,4,2,1,3,2],[0,2,4,3,1,4,2,0],[0,3,2,4,5,3,1,0],
    [0,1,4,2,3,5,4,2],[0,4,3,1,2,5,3,0],[0,2,1,3,5,4,2,1]
  ];
  const motif=pick(motifPool);
  const noteStep=pick([beat/2,beat,beat*1.5]);
  const register=pick([0,0,1,1,2]);

  for(let b=0;b<3;b++){
    const chord=progression[b];
    const chordRoot=degree(chord,0);
    const chord2=degree(chord+2,0);
    const chord3=degree(chord+4,0);
    // Cama armónica estricta: no introducimos cuerdas/pads por defecto
    // cuando la búsqueda pide un instrumento concreto o modo "solo".
    if(!soloMode || !requestedLead || requestedLead==="strings" || requestedLead==="synth"){
      events.push({t:b*bar,f:hz(chordRoot-12),v:.028+rnd()*.014,role:requestedLead==="synth"?"synth":"strings"});
      events.push({t:b*bar,f:hz(chord2),v:.018+rnd()*.012,role:requestedLead==="synth"?"synth":"strings"});
      events.push({t:b*bar,f:hz(chord3),v:.016+rnd()*.010,role:requestedLead==="synth"?"synth":"strings"});
    }
    if(lead==="piano" || semantic.piano){
      events.push({t:b*bar,f:hz(chordRoot-24),v:.055+rnd()*.025,role:"pedal"});
      events.push({t:b*bar+bar*.25,f:hz(chord2-12),v:.028,role:"pedal"});
    }
    // Motif changes every bar; never just repeats one fixed four-bar phrase.
    const offset=Math.floor(rnd()*motif.length);
    const density=3+Math.floor(rnd()*5);
    for(let j=0;j<density;j++){
      const idx=(offset+j+(b%3))%motif.length;
      const d=motif[idx]+chord;
      const t=b*bar+j*noteStep+(rnd()-.5)*beat*.12;
      if(t<0||t>dur-1) continue;
      events.push({t,f:hz(degree(d,register)),v:.055+rnd()*.065,role:lead});
      if(rnd()>.68) events.push({t:t+noteStep*.42,f:hz(degree(motif[(idx+2)%motif.length]+chord,register+1)),v:.025+rnd()*.025,role:lead==="flute"?"glass":"pluck"});
    }
  }

  // Texturas ligadas directamente al paisaje/búsqueda.
  const reverbDelay=(src,delay,decay,t)=>src*Math.exp(-delay*decay);
  const texture=(t)=>{
    let x=0;
    // Textura semántica estricta: solo se activa si la búsqueda la contiene.
    // El paisaje/ambiente nunca se sustituye por una textura genérica.
    if(semantic.rain){
      const drop=(Math.sin(2*Math.PI*73*t)+.6*Math.sin(2*Math.PI*127*t)+.28*Math.sin(2*Math.PI*211*t));
      const shimmer=.5+.5*Math.sin(2*Math.PI*.73*t);
      x+=drop*(.0018+.0015*shimmer);
      x+=.0010*Math.sin(2*Math.PI*(4.5+.7*Math.sin(t*.17))*t);
    }
    if(semantic.ocean){
      const swell=.5+.5*Math.sin(2*Math.PI*.055*t+Math.sin(t*.07));
      x+=swell*(Math.sin(2*Math.PI*120*t)+.45*Math.sin(2*Math.PI*260*t))*.0065;
    }
    if(semantic.forest){
      const breeze=.5+.5*Math.sin(2*Math.PI*.11*t+Math.sin(t*.23));
      x+=breeze*(Math.sin(2*Math.PI*430*t)+.45*Math.sin(2*Math.PI*980*t))*.0028;
      // Pequeños armónicos tipo pájaro, solo si el usuario pide bosque/naturaleza.
      x+=Math.sin(2*Math.PI*(1450+90*Math.sin(t*.31))*t)*.00045;
    }
    if(semantic.mountain){
      // Espacio amplio y grave para paisajes de montaña.
      x+=.0022*Math.sin(2*Math.PI*54*t)*(0.5+.5*Math.sin(t*.09));
    }
    if(semantic.night){
      x+=.0014*Math.sin(2*Math.PI*92*t)*(.65+.35*Math.sin(t*.05));
    }
    if(semantic.sunset||semantic.bright){
      x+=.0012*Math.sin(2*Math.PI*330*t)*(0.7+.3*Math.sin(t*.08));
    }
    return x;
  };

  for(let i=0;i<n;i++){
    const t=i/sr;
    let l=0,r=0;
    const pan=.18*Math.sin(2*Math.PI*t/(9+((h%7))));
    for(const e of events){
      const nt=t-e.t;
      if(nt<0) continue;
      let x=0;
      if(e.role==="piano")x=piano(e.f,nt,e.v);
      else if(e.role==="pedal")x=pianoPedal(e.f,nt,e.v);
      else if(e.role==="guitar")x=guitar(e.f,nt,e.v);
      else if(e.role==="pluck")x=pluck(e.f,nt,e.v);
      else if(e.role==="strings")x=strings(e.f,nt,e.v);
      else if(e.role==="synth")x=synth(e.f,nt,e.v);
      else if(e.role==="flute")x=flute(e.f,nt,e.v);
      else x=glass(e.f,nt,e.v);
      l+=x*(1-pan);r+=x*(1+pan);
    }
    const tx=texture(t);l+=tx*(1+pan);r+=tx*(1-pan);
    if(semantic.night||semantic.sleep){l*=.78;r*=.78;}
    if(semantic.bright||semantic.sunset){const x=.0018*Math.sin(2*Math.PI*1450*t);l+=x;r+=x*.8;}
    const fadeIn=Math.min(1,t/2),fadeOut=Math.min(1,(dur-t)/4),m=fadeIn*fadeOut;
    // Saturación muy ligera + filtrado de graves/agudos para un acabado más natural.
    const room=1+0.035*Math.sin(2*Math.PI*.21*t);
    l*=room;r*=room;
    l=Math.tanh(l*1.55)*m;r=Math.tanh(r*1.55)*m;
    samples[i*2]=clamp(l,-.78,.78);samples[i*2+1]=clamp(r,-.78,.78);
  }
  let peak=0;for(const x of samples)peak=Math.max(peak,Math.abs(x));
  const gain=peak>.001?Math.min(1.7,.82/peak):1;
  for(let i=0;i<samples.length;i++)samples[i]*=gain;
  writeWav(wavPath,samples,sr,2);
}

function generateFreeMusicFile(track, outPath) {
  // Motor 100% local: no API key, no créditos y no proveedor de pago.
  // La búsqueda del usuario controla escala, tempo, instrumentos, textura y ambiente.
  makeCompositionWav(track, outPath);
  const stat=fs.statSync(outPath);
  if(!stat.size) throw new Error("El motor musical local generó un archivo vacío.");
  return stat.size;
}

async function ensureBuiltinMusic(tracks=[]) {
  const results=[];
  // MUY IMPORTANTE: no bloquear /api/ai-options antes de devolver las fotos.
  // El motor musical es CPU-intensivo y síncrono, así que cedemos el control
  // al event loop para que Express pueda responder primero con las 4 imágenes.
  await new Promise(resolve => setImmediate(resolve));
  for (const track of tracks) {
    try {
      // Permite que /api/ai-options-status y las peticiones del navegador
      // tengan oportunidad de entrar entre generaciones.
      await new Promise(resolve => setImmediate(resolve));
      const out=path.join(MUSIC_DIR, track.file);
      fs.rmSync(out,{force:true});
      const basePrompt=String(track.musicProfile||track.userMusicBrief||"professional deep relaxation ambient music").trim();
      if(!basePrompt) throw new Error("La búsqueda musical está vacía.");

      console.log("[Free Music Engine] Generando", track.label, "desde:", track.userMusicBrief || basePrompt);
      generateFreeMusicFile(track, out);
      track.provider="RelaxScape Free Music Engine";
      track.generated=true;
      track.fallback=false;
      track.musicPrompt=basePrompt;
      console.log("[Free Music Engine] LISTA:", track.file, fs.statSync(out).size, "bytes");
      results.push(true);
    } catch(e) {
      aiMusicErrors.push(track.label+": "+(e?.message||String(e)));
      console.error("[Free Music Engine] ERROR",track.file,e?.stack||e?.message||e);
      results.push(false);
    }
  }
  console.log("[Free Music Engine] Terminadas:",results.filter(Boolean).length,"/",tracks.length);
  return results;
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
let aiMusicErrors = [];
let aiMusicGenerationId = 0;

function getAIMusicOptions(){
  // IMPORTANTE: cuando el usuario ha pedido una nueva música, NO mostramos
  // las pistas antiguas de la biblioteca como si fueran las 4 opciones IA.
  // Ese fallback hacía que cualquier descripción pareciera generar siempre
  // el mismo piano antes de que Lyria terminara.
  if(aiMusicTracks.length){
    return aiMusicTracks.map(t => {
      if(!t || !t.file || !fs.existsSync(path.join(MUSIC_DIR,t.file))) return null;
      return {
        name:t.file,
        url:"/media/music/"+encodeURIComponent(t.file),
        ai:true,
        provider:t.provider || "RelaxScape Free Music Engine",
        search:t.userSearch || t.originalMusicPrompt || "",
        generated:true,
        fallback:Boolean(t.fallback),
        label:t.label,
        category:t.category
      };
    }).filter(Boolean);
  }

  return [];
}

async function generatePollinationsAIImage(prompt, index=0) {
  const key = process.env.POLLINATIONS_API_KEY;
  if (!key) throw new Error("Falta POLLINATIONS_API_KEY en Render para generar imágenes IA.");
  const variations = [
    "wide cinematic establishing shot, calm composition, soft natural light, photorealistic",
    "wide cinematic landscape, different camera angle and depth, atmospheric perspective, photorealistic",
    "wide cinematic landscape, foreground depth, subtle mist and realistic natural lighting, photorealistic",
    "wide cinematic landscape, alternate time-of-day feeling, rich detail and peaceful atmosphere, photorealistic"
  ];
  const finalPrompt = String(prompt || "peaceful nature landscape") + ", " + variations[index % variations.length] + ", no people, no text, no logos, premium relaxation video background";
  const url = "https://gen.pollinations.ai/image/" + encodeURIComponent(finalPrompt)
    + "?model=flux&width=1920&height=1080&nologo=true&seed=" + (Date.now() + index * 7919);
  const r = await fetch(url, { headers: { Authorization: "Bearer " + key } });
  if (!r.ok) {
    const raw = await r.text();
    throw new Error("Pollinations Image HTTP " + r.status + ": " + raw.slice(0, 300));
  }
  const contentType = r.headers.get("content-type") || "image/jpeg";
  const ext = contentType.includes("png") ? "png" : "jpg";
  const filename = "ai-landscape-" + Date.now() + "-" + index + "." + ext;
  fs.writeFileSync(path.join(IMAGE_DIR, filename), Buffer.from(await r.arrayBuffer()));
  return {
    name: filename,
    url: "/media/images/" + encodeURIComponent(filename),
    ai: true,
    provider: "Pollinations AI",
    fallback: false,
    label: "Imagen IA " + (index + 1)
  };
}

app.post("/api/ai-options", async (req, res) => {
  const theme = String(req.body?.theme || "peaceful lake, misty mountains, soft dawn light").trim().slice(0, 500);
  const musicPrompt = String(req.body?.musicPrompt || theme).trim().slice(0, 220);
  const images = [];
  const imageErrors = [];

  // 1) Primero buscamos fotos reales relacionadas con la búsqueda.
  // Esto debe ser rápido y no depender de la generación IA.
  try {
    const key = process.env.PEXELS_API_KEY;
    if (!key) throw new Error("Falta PEXELS_API_KEY en Render.");
    const r = await fetchWithTimeout(
      "https://api.pexels.com/v1/search?query=" + encodeURIComponent(theme + " peaceful nature") +
      "&per_page=40&orientation=landscape&size=large&locale=en-US",
      { headers: { Authorization: key } }, 7000
    );
    if (!r.ok) throw new Error("Pexels HTTP " + r.status);
    const data = await r.json();
    const pool = (data.photos || []).filter(p => p.src?.large2x || p.src?.large).sort(() => Math.random() - 0.5);
    for (const photo of pool) {
      if (images.length >= 4) break;
      const src = photo.src?.large2x || photo.src?.large;
      if (!src) continue;
      images.push({
        name: "pexels-" + photo.id,
        url: src,
        sourceUrl: photo.url || src,
        ai: false,
        provider: "Pexels",
        fallback: true,
        label: "Foto " + (images.length + 1)
      });
    }
  } catch (e) {
    imageErrors.push("Pexels: " + e.message);
  }

  // 2) Pollinations queda como respaldo, pero NO puede bloquear la respuesta
  // inicial durante minutos. Si Pexels no entrega las 4, usamos fallback local.
  if (images.length < 4 && process.env.POLLINATIONS_API_KEY) {
    const needed = 4 - images.length;
    const jobs = Array.from({ length: needed }, (_, j) => {
      const i = images.length + j;
      return Promise.race([
        generatePollinationsAIImage(theme, i),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout 15s")), 15000))
      ]).then(item => ({ ok: true, item, index: i }))
        .catch(error => ({ ok: false, error, index: i }));
    });
    const results = await Promise.all(jobs);
    for (const result of results) {
      if (result.ok) images.push(result.item);
      else imageErrors.push("Imagen IA " + (result.index + 1) + ": " + result.error.message);
    }
  }

  // 3) Último respaldo: imágenes SVG locales basadas en la búsqueda.
  if (images.length < 4) {
    const needed = 4 - images.length;
    for (let i = 0; i < needed; i++) {
      const filename = "relaxscape-local-landscape-" + Date.now() + "-" + i + ".svg";
      images.push(makeFallbackLandscape(filename, theme));
    }
    imageErrors.push("Se completaron las opciones restantes con un fondo local.");
  }

  // 4) Preparamos la generación musical en segundo plano.
  // No esperamos a que termine para responder con las fotos.
  const generationId = ++aiMusicGenerationId;
  aiMusicTracks = aiTracksForBackground(musicPrompt, generationId);
  aiMusicTracks.forEach(t => {
    try { fs.rmSync(path.join(MUSIC_DIR, t.file), { force: true }); } catch {}
  });
  aiMusicErrors = [];
  aiMusicPreparing = true;
  const currentTracks = aiMusicTracks;
  ensureBuiltinMusic(currentTracks)
    .catch(e => {
      if (generationId === aiMusicGenerationId) {
        aiMusicErrors.push(e.message || String(e));
        console.error("[AI Music] preparación:", e.stack || e.message);
      }
    })
    .finally(() => {
      if (generationId === aiMusicGenerationId) aiMusicPreparing = false;
    });

  const initialMusic = getAIMusicOptions();
  res.json({
    images,
    music: initialMusic,
    musicReady: initialMusic.length >= 4,
    musicPreparing: true,
    imageErrors,
    musicErrors: aiMusicErrors.slice(),
    provider: "Pexels search + Pollinations Images + RelaxScape Free Music Engine"
  });
});

function hashText(text){
  let h=2166136261;
  for(const ch of String(text)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)}
  return (h>>>0).toString(36);
}
function musicIntentProfile(prompt=""){
  const p=String(prompt||"").toLowerCase();
  const has=(...words)=>words.some(w=>p.includes(w));
  const parts=[];
  if(has("piano","piano suave","teclas","pianístico","pianistica")) parts.push("felt piano");
  if(has("guitarra","acústica","acustica","nylon","guitar")) parts.push("professional nylon acoustic guitar");
  if(has("violín","violin","cello","cuerdas","strings","orquesta","orchestral")) parts.push("warm cinematic strings");
  if(has("flauta","flute","bambú","bambu","viento","wind")) parts.push("airy bamboo flute");
  if(has("agua","water","océano","oceano","mar","olas","waves","río","rio","lluvia","rain","cascada","waterfall")) parts.push("subtle natural water ambience");
  if(has("bosque","forest","montaña","montana","naturaleza","nature","pájaros","pajaros","birds","jardín","jardin")) parts.push("organic forest nature ambience");
  if(has("spa","meditación","meditacion","zen","yoga","respiración","respiracion")) parts.push("spa meditation atmosphere");
  if(has("relajante","relajación","relajacion","relax","calma","calmado","tranquilo","tranquila","bienestar","stress","estrés","ansiedad","anxiety")) parts.push("deep relaxation genre, very slow tempo, soft sustained harmony, warm intimate ambience, spacious reverb, no drums, no percussion, no rhythmic pulse, no upbeat elements");
  if(has("sueño","sueno","dormir","sleep","noche","night","luna","moon","estrellas","stars")) parts.push("deep sleep nocturnal atmosphere");
  if(has("cinemático","cinematic","película","pelicula","film","emocional","emotional")) parts.push("cinematic evolving pads");
  if(has("lofi","lo-fi","chill","chillout")) parts.push("soft lo-fi texture");
  if(has("electrónica","electronica","synth","sintetizador","ambient")) parts.push("warm analog ambient synthesizers");
  if(has("triste","melancólico","melancolico")) parts.push("gentle melancholic harmony");
  if(has("alegre","luminoso","bright","sunrise","amanecer")) parts.push("warm luminous harmony");
  const noPerc=has("sin batería","sin bateria","sin percusión","sin percusion","no drums","no percussion");
  if(noPerc) parts.push("no drums, no percussion");
  if(!parts.length) parts.push("deep relaxation genre, very slow tempo, soft sustained harmony, warm ambient pads, spacious reverb, no drums, no percussion, no rhythmic pulse");
  if(!parts.some(x=>/relaxation genre|spa meditation|deep sleep|ambient texture/.test(x)) && has("música","musica","music")) parts.push("relaxing ambient foundation, very slow and gentle, no drums, no rhythmic pulse");
  return parts.join(", ");
}

const SONIC_PALETTES = [
  { name:"Organic acoustic", brief:"premium organic acoustic palette: felt piano or intimate keys when compatible, nylon guitar, bowed strings, airy flute, warm room ambience, subtle natural textures, rich harmonic overtones, human-like phrasing" },
  { name:"Cinematic strings", brief:"premium cinematic ambient palette: evolving string ensemble, cello warmth, soft piano only when compatible, deep harmonic pads, wide stereo image, slow orchestral swells, detailed dynamics and long-tail reverb" },
  { name:"Ethereal electronic", brief:"premium ethereal electronic palette: warm analog synths, evolving pads, glassy high textures, soft sub bass, delicate plucks, granular atmosphere and slowly changing stereo movement, never harsh or dance-oriented" },
  { name:"Dream acoustic", brief:"premium dreamlike palette: intimate guitar, felted keys when compatible, soft strings, breathy flute, harmonic shimmer, close room detail and spacious ambient tails, with a clearly developing motif" },
  { name:"Nature cinematic", brief:"premium nature-cinematic palette: organic instrumental layers, warm strings, airy woodwind, subtle water/wind ambience when requested, deep environmental space and gradual harmonic evolution" },
  { name:"Minimal piano", brief:"premium minimalist palette: expressive felt piano when compatible, soft low strings, distant pad, subtle harmonic resonance and very spacious room, with varied voicings and melodic development rather than repeated notes" },
  { name:"Meditative world", brief:"premium meditative world palette: bamboo flute, nylon guitar, warm strings, soft resonant plucked textures, organic room tone and slow modal harmony, avoiding obvious rhythmic percussion unless requested" },
  { name:"Ambient sound design", brief:"premium sound-design palette: evolving synth beds, tonal drones with harmonic movement, delicate bell-like overtones, filtered textures, deep spatial field and slow modulation, while keeping a real musical motif in the foreground" }
];

function aiTracksForBackground(prompt="", generationId=0){
  const originalSearch=String(prompt||"").trim().slice(0,220);
  const requestedDetails=musicIntentProfile(originalSearch);
  const p="professional deep-relaxation ambient music based directly on this user search: ["+originalSearch+"]. Translate the subject, place, weather, time of day, emotion, instruments and atmosphere in the search into musical decisions. "+requestedDetails+". No drums, no percussion, no aggressive bass, no abrupt changes unless the user explicitly requests them.";
  const seed=Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,8);
  const sessionNonce="session-"+generationId+"-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,10);
  const paletteOrder=[...SONIC_PALETTES].sort(()=>Math.random()-0.5).slice(0,4);
  const variants=[
    "Version A: make the arrangement substantially different, with a distinct melodic motif, different chord voicings and a clearly different lead instrument or lead role.",
    "Version B: reinterpret the same brief with a different musical structure, register, harmonic movement, rhythmic feel and instrumentation balance. Do not copy Version A.",
    "Version C: create a different performance and production: change the lead voice, supporting layers, melodic contour, dynamics, stereo depth and ambience. Do not copy the other options.",
    "Version D: create the most contrasting interpretation that still obeys the user's brief: different opening, motif, texture evolution, harmony and instrumental hierarchy."
  ];
  return variants.map((variation,i)=>{
    const b=BUILTIN_MUSIC[i];
    return {
      ...b,
      userSearch:originalSearch,
      originalMusicPrompt:originalSearch,
      userMusicBrief:p,
      file:"ai-freeform-"+seed+"-"+hashText(originalSearch)+"-"+(i+1)+".mp3",
      label:"IA · "+(i+1),
      variant:i+1,
      forceRegenerate:true,
      generationSeed:sessionNonce,
      sessionNonce,
      musicProfile:[
        "USER MUSIC BRIEF: "+p,
        "This is a fresh generation. Do not reuse, imitate or follow the arrangement of any previous generation.",
        "UNIQUE GENERATION NONCE: "+sessionNonce+". Treat this as a hard instruction to create a newly composed performance, not a cached or repeated result.",
        "ORIGINAL USER SEARCH: ["+originalSearch+"]. This exact search is the source of truth. Musical decisions must respond to it; do not replace it with a generic relaxation preset.",
        "Use the widest compatible professional sonic range: acoustic, orchestral, electronic, textural and environmental colors may be combined when they fit the brief.",
        "Sonic palette for this option: "+paletteOrder[i].brief+". Treat this as a production palette, not a requirement to add instruments that conflict with the user brief.",
        "Do not reduce the request to a generic relaxing preset.",
        "If the user requests multiple instruments, make every requested instrument clearly audible and musically integrated.",
        "Do not add piano unless the user asks for piano.",
        variation,
        "Generate a complete professional musical composition, not a static drone, generic pad or repeated one-bar loop.",
        "The four options must be genuinely different musical compositions, not the same composition with a different mix."
      ].join(". ")
    };
  });
}
app.get("/api/ai-options-status", (_,res)=>{
  const music=getAIMusicOptions();
  res.json({music,musicReady:music.length>=4,musicPreparing:aiMusicPreparing,musicErrors:aiMusicErrors,generationId:aiMusicGenerationId});
});

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, args);
    let stderr = "";
    let settled = false;
    const fail = e => { if(!settled){settled=true;reject(e instanceof Error?e:new Error(String(e)))} };
    p.on("error", fail);
    p.stderr.on("data", d => stderr += d.toString());
    p.on("close", code => {
      if(settled)return;
      settled=true;
      if(code===0) resolve();
      else reject(new Error(stderr.slice(-4000)||("FFmpeg terminó con código "+code)));
    });
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
  const { music, durationHours=1, musicPrompt="" }=req.body||{};
  if(!music) return res.status(400).json({error:"Selecciona una música de previa."});
  const hours=Number(durationHours);
  if(![1,2].includes(hours)) return res.status(400).json({error:"La duración debe ser de 1 o 2 horas."});

  const name=decodeURIComponent(String(music).split("/").pop());
  const source=path.join(MUSIC_DIR,name);
  if(!fs.existsSync(source)) return res.status(404).json({error:"No se encontró la previa musical seleccionada."});

  const selectedTrack=aiMusicTracks.find(t=>t.file===name);
  const basePrompt=String(selectedTrack?.musicProfile || selectedTrack?.userMusicBrief || musicPrompt || "").trim();
  if(!basePrompt) return res.status(400).json({error:"No se pudo recuperar la búsqueda que originó la música. Vuelve a generar las opciones IA."});

  const stamp=Date.now();
  const work=path.join(MUSIC_DIR,"long-"+stamp);
  const finalName="relaxscape-selected-"+hours+"h-"+stamp+".mp3";
  const out=path.join(MUSIC_DIR,finalName);
  fs.mkdirSync(work,{recursive:true});

  try{
    // Generamos 4 variaciones locales de la misma búsqueda y las concatenamos.
    // Así la hora final no depende de un único clip repetido.
    const segments=[];
    for(let i=0;i<4;i++){
      const track={
        ...(selectedTrack||{}),
        userSearch:String(selectedTrack?.userSearch||selectedTrack?.originalMusicPrompt||basePrompt),
        originalMusicPrompt:String(selectedTrack?.originalMusicPrompt||selectedTrack?.userSearch||basePrompt),
        userMusicBrief:basePrompt,
        musicProfile:basePrompt,
        variant:i+1,
        generationSeed: String(selectedTrack?.generationSeed||selectedTrack?.sessionNonce||basePrompt)+"-long-"+i+"-"+Date.now(),
        sessionNonce: selectedTrack?.sessionNonce || "",
        f1:selectedTrack?.f1||220,
        f2:selectedTrack?.f2||330,
        f3:selectedTrack?.f3||392
      };
      const seg=path.join(work,"segment-"+i+".wav");
      generateFreeMusicFile(track,seg);
      segments.push(seg);
    }

    const listFile=path.join(work,"concat.txt");
    fs.writeFileSync(listFile,segments.map(f=>"file '"+f.replace(/'/g,"'\\''")+"'").join("\n"));

    // Construye una base de ~72 s con las 4 variaciones y la repite hasta la duración elegida.
    const base=path.join(work,"base.wav");
    await runFfmpeg(["-y","-f","concat","-safe","0","-i",listFile,"-c:a","pcm_s16le",base]);

    await runFfmpeg([
      "-y","-stream_loop","-1","-i",base,
      "-t",String(hours*3600),
      "-c:a","libmp3lame","-b:a","192k","-ar","44100",out
    ]);

    res.json({
      name:finalName,
      url:"/media/music/"+encodeURIComponent(finalName),
      hours,
      sourcePreview:name,
      provider:"RelaxScape Free Music Engine",
      generatedFromSearch:true,
      paidApi:false
    });
  }catch(e){
    console.error("Error creando música larga gratuita:",e.stack||e.message);
    res.status(500).json({error:"No se pudo crear la música larga gratuita: "+e.message});
  }finally{
    fs.rmSync(work,{recursive:true,force:true});
  }
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