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
  // Motor local V28: interpreta la búsqueda del usuario antes de elegir timbre,
  // escala, tempo, registro y textura. Las 4 variantes siguen siendo diferentes,
  // pero ahora pertenecen al mismo universo sonoro pedido.
  const sr=12000, dur=18, n=sr*dur, samples=new Float32Array(n*2);
  const variant=((Number(track.variant||1)-1)%4+4)%4;
  const brief=String(track.musicProfile||track.userMusicBrief||"professional deep-relaxation ambient music").toLowerCase();
  const hz=m=>440*Math.pow(2,(m-69)/12);
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const has=(...words)=>words.some(w=>brief.includes(w));

  const semantic={
    sleep:has("sleep","sueño","dormir","deep sleep","night","noche"),
    meditation:has("meditation","meditación","meditacion","zen","mindfulness","yoga","breathing","respiración"),
    nature:has("nature","naturaleza","forest","bosque","mountain","montaña","lake","lago","river","río","waterfall","cascada","beach","playa","ocean","océano","sea","mar"),
    rain:has("rain","lluvia","storm","tormenta","rainy"),
    ocean:has("ocean","océano","sea","mar","waves","olas"),
    forest:has("forest","bosque","woodland","misty"),
    mountain:has("mountain","montaña","alpine","mountains"),
    piano:has("piano","felt piano"),
    guitar:has("guitar","guitarra","acoustic","nylon"),
    strings:has("strings","cello","violin","viola","orchestral","cinematic","cuerdas"),
    flute:has("flute","flauta","bamboo","bambú","woodwind"),
    synth:has("synth","synthesizer","electronic","electrónico","analog","ambient electronic"),
    warm:has("warm","cálido","calido","cozy","acogedor"),
    dark:has("dark","deep","oscuro","profundo"),
    bright:has("bright","luminoso","sunrise","amanecer"),
    cinematic:has("cinematic","cinemático","cinematica","film","orchestral"),
    focus:has("focus","study","estudio","concentration","concentración"),
    spa:has("spa","wellness","bienestar","relax"),
    world:has("world","oriental","oriental","indian","japanese","zen")
  };

  let root=semantic.dark?45:semantic.bright?62:semantic.ocean?57:semantic.forest?52:semantic.mountain?50:semantic.piano?57:57;
  if(semantic.sleep||semantic.meditation) root-=5;
  const scale=semantic.dark?[0,2,3,5,7,8,10]
    :semantic.world||semantic.flute?[0,2,3,7,9]
    :semantic.cinematic||semantic.strings?[0,2,3,5,7,9,10]
    :semantic.bright?[0,2,4,6,7,9,11]
    :[0,2,4,7,9];
  let bpm=semantic.sleep?34:semantic.meditation?38:semantic.focus?48:semantic.cinematic?42:semantic.ocean?40:44;
  if(semantic.synth) bpm+=4;
  const beat=60/bpm, bar=beat*4;
  const seed=Math.abs(Math.floor((Number(track.f1)||220)*7+(Number(track.f2)||330)*3+(Number(track.f3)||392)+variant*997))%997;
  const scaleNote=(m,d,oct=0)=>m+scale[((d%scale.length)+scale.length)%scale.length]+12*oct;

  // Cuatro arreglos diferentes dentro del mismo briefing:
  // 0 piano/acústico, 1 cuerdas/cinemático, 2 electrónico/ambient, 3 orgánico/world.
  const preferred=[
    semantic.piano||semantic.guitar ? "acoustic" : semantic.strings||semantic.cinematic ? "strings" : semantic.synth ? "synth" : "acoustic",
    semantic.strings||semantic.cinematic ? "strings" : semantic.piano ? "piano" : semantic.synth ? "synth" : "strings",
    semantic.synth||semantic.ocean||semantic.rain ? "synth" : semantic.piano ? "piano" : "synth",
    semantic.flute||semantic.world||semantic.nature ? "organic" : semantic.guitar ? "acoustic" : "organic"
  ];
  const primary=preferred[variant];

  const piano=(f,t,v=1)=>{
    if(t<0||t>4)return 0;
    const e=Math.min(1,t/.018)*Math.exp(-1.35*t)*Math.exp(-Math.max(0,t-2.6)*3);
    return v*e*(.70*Math.sin(2*Math.PI*f*t)+.19*Math.sin(4*Math.PI*f*t)+.075*Math.sin(6*Math.PI*f*t)+.025*Math.sin(8*Math.PI*f*t));
  };
  const pluck=(f,t,v=1)=>{
    if(t<0||t>3)return 0;
    const e=Math.min(1,t/.006)*Math.exp(-2.1*t);
    return v*e*(.62*Math.sin(2*Math.PI*f*t)+.23*Math.sin(4*Math.PI*f*t)+.10*Math.sin(6*Math.PI*f*t)+.035*Math.sin(10*Math.PI*f*t));
  };
  const cello=(f,t,v=1)=>{
    if(t<0)return 0;
    const e=(1-Math.exp(-t/.75))*Math.exp(-t/8);
    const vib=1+.004*Math.sin(2*Math.PI*5.1*t);
    return v*e*(.58*Math.sin(2*Math.PI*f*vib*t)+.27*Math.sin(4*Math.PI*f*t)+.10*Math.sin(6*Math.PI*f*t));
  };
  const strings=(f,t,v=1)=>{
    if(t<0)return 0;
    const e=(1-Math.exp(-t/1.8))*Math.exp(-t/12);
    const vib=1+.006*Math.sin(2*Math.PI*(4.5+f/1000)*t);
    return v*e*(.34*Math.sin(2*Math.PI*f*vib*t)+.42*Math.sin(4*Math.PI*f*t)+.18*Math.sin(6*Math.PI*f*t)+.06*Math.sin(8*Math.PI*f*t));
  };
  const synth=(f,t,v=1)=>{
    if(t<0)return 0;
    const e=(1-Math.exp(-t/1.3))*Math.exp(-t/15);
    const lfo=.5+.5*Math.sin(2*Math.PI*.09*t);
    const det=.005*lfo;
    const saw=x=>2*(x%1)-1;
    return v*e*(.38*saw(f*t)+.23*saw(f*(1-det)*t)+.18*saw(f*(1+det)*t)+.15*Math.sin(2*Math.PI*f/2*t)+.06*Math.sin(4*Math.PI*f*t));
  };
  const glass=(f,t,v=1)=>{
    if(t<0)return 0;
    const e=Math.min(1,t/.005)*Math.exp(-t/3.4);
    return v*e*(.55*Math.sin(2*Math.PI*f*t)+.25*Math.sin(2*Math.PI*2.01*f*t)+.12*Math.sin(2*Math.PI*3.97*f*t));
  };
  const flute=(f,t,v=1)=>{
    if(t<0||t>5)return 0;
    const e=Math.min(1,t/.15)*Math.exp(-t/3.8);
    const breath=(Math.sin(2*Math.PI*19*t)+.5*Math.sin(2*Math.PI*31*t))*.018;
    return v*e*(.78*Math.sin(2*Math.PI*f*(1+.004*Math.sin(2*Math.PI*5*t))*t)+.13*Math.sin(4*Math.PI*f*t)+.045*Math.sin(6*Math.PI*f*t)+breath);
  };
  const rainNoise=(t,v=1)=>{
    const a=Math.sin(2*Math.PI*91*t)+.5*Math.sin(2*Math.PI*137*t)+.25*Math.sin(2*Math.PI*211*t);
    return v*.003*a;
  };
  const oceanTexture=(t,v=1)=>{
    const swell=.5+.5*Math.sin(2*Math.PI*.075*t);
    return v*.006*swell*(Math.sin(2*Math.PI*180*t)+.35*Math.sin(2*Math.PI*320*t));
  };
  const forestTexture=(t,v=1)=>{
    const breeze=.5+.5*Math.sin(2*Math.PI*.13*t+Math.sin(t*.31));
    return v*.0025*breeze*(Math.sin(2*Math.PI*650*t)+.4*Math.sin(2*Math.PI*1200*t));
  };

  const events=[];
  const rootMidi=root;
  for(let b=0;b<4;b++){
    const r=rootMidi + [0,5,3,4][b%4];
    if(primary==="strings"){
      for(let k=0;k<4;k++) events.push({t:b*bar,f:hz(scaleNote(r,k)),v:k===0?.075:.050,role:"strings"});
      events.push({t:b*bar+bar*.52,f:hz(scaleNote(r,2,1)),v:.045,role:"strings"});
    } else if(primary==="synth"){
      events.push({t:b*bar,f:hz(scaleNote(r,0,-1)),v:.045,role:"sub"});
      events.push({t:b*bar,f:hz(scaleNote(r,1)),v:.055,role:"synth"});
      events.push({t:b*bar+bar*.5,f:hz(scaleNote(r,3,1)),v:.045,role:"synth"});
      events.push({t:b*bar+bar*.78,f:hz(scaleNote(r,4,1)),v:.038,role:"glass"});
    } else if(primary==="organic"){
      const degrees=[0,1,2,4,3,2,1,0];
      for(let j=0;j<8;j++){
        if(j===6) continue;
        events.push({t:b*bar+j*(beat/2)+.08,f:hz(scaleNote(r,degrees[(j+b+seed)%degrees.length],1)),v:j===0?.09:.065,role:semantic.flute||semantic.world?"flute":"pluck"});
      }
      events.push({t:b*bar+bar*.38,f:hz(scaleNote(r,2,1)),v:.045,role:"pluck"});
    } else {
      for(let j=0;j<5;j++){
        events.push({t:b*bar+j*(bar/5)+.10,f:hz(scaleNote(r,(j+b+seed)%5,1)),v:j===0?.18:.12,role:"piano"});
      }
      events.push({t:b*bar+bar*.62,f:hz(scaleNote(r,2,2)),v:.065,role:"pluck"});
      events.push({t:b*bar,f:hz(scaleNote(r,0,-1)),v:.065,role:"cello"});
    }
  }

  for(let i=0;i<n;i++){
    const t=i/sr, b=Math.min(3,Math.floor(t/bar)), pan=.24*Math.sin(2*Math.PI*t/(primary==="synth"?10:17));
    let l=0,r=0;
    for(const e of events){
      const nt=t-e.t; if(nt<0) continue;
      let x=0;
      if(e.role==="piano") x=piano(e.f,nt,e.v);
      else if(e.role==="pluck") x=pluck(e.f,nt,e.v);
      else if(e.role==="cello") x=cello(e.f,nt,e.v);
      else if(e.role==="strings") x=strings(e.f,nt,e.v);
      else if(e.role==="synth") x=synth(e.f,nt,e.v);
      else if(e.role==="glass") x=glass(e.f,nt,e.v);
      else if(e.role==="flute") x=flute(e.f,nt,e.v);
      else x=.30*Math.sin(2*Math.PI*e.f*nt)*Math.exp(-nt/4)*e.v;
      l+=x*(1-pan); r+=x*(1+pan);
    }

    // El entorno también responde a la búsqueda.
    if(semantic.rain) { const x=rainNoise(t,.9); l+=x*(1+pan); r+=x*(1-pan); }
    if(semantic.ocean) { const x=oceanTexture(t,.8); l+=x*(1+pan*.4); r+=x*(1-pan*.4); }
    if(semantic.forest||semantic.nature) { const x=forestTexture(t,.65); l+=x*(1-pan*.3); r+=x*(1+pan*.3); }

    // Variaciones de mezcla según el briefing.
    if(semantic.sleep||semantic.meditation){ l*=.82; r*=.82; }
    if(semantic.warm) { const warmth=.003*Math.sin(2*Math.PI*110*t); l+=warmth; r+=warmth*.9; }
    if(semantic.dark) { const low=.008*Math.sin(2*Math.PI*55*t); l+=low; r+=low; }
    if(semantic.bright) { const hi=.0025*Math.sin(2*Math.PI*1800*t); l+=hi; r+=hi*.8; }

    const fadeIn=Math.min(1,t/1.8), fadeOut=Math.min(1,(dur-t)/2.5), master=fadeIn*fadeOut;
    l=Math.tanh(l*1.42)*master; r=Math.tanh(r*1.42)*master;
    samples[i*2]=clamp(l,-.78,.78); samples[i*2+1]=clamp(r,-.78,.78);
  }
  let peak=0;
  for(const x of samples) peak=Math.max(peak,Math.abs(x));
  const gain=peak>.001?Math.min(1.55,.82/peak):1;
  for(let i=0;i<samples.length;i++) samples[i]*=gain;
  writeWav(wavPath,samples,sr,2);
}

async function ensureBuiltinMusic(tracks=BUILTIN_MUSIC){
  const valid=t=>{
    const p=path.join(MUSIC_DIR,t.file);
    try{return fs.existsSync(p)&&fs.statSync(p).size>4096}catch{return false}
  };
  const pending=tracks.filter(t=>!valid(t) || t.forceRegenerate);
  console.log("[Music v13] Pendientes:",pending.length);
  if(!pending.length) return;

  const generateOne=async track=>{
    const out=path.join(MUSIC_DIR,track.file);
    const wav=path.join(MUSIC_DIR,"."+track.file+".wav");
    try{
      fs.rmSync(out,{force:true});
      console.log("[Music v14] Generando:",track.label,track.file);
      // Motor musical 100% local y gratuito.
      // No intentamos Pollinations/ElevenLabs ni Lyria: Crear IA no depende
      // de saldo, cuotas ni APIs de pago.
      try {
          // Fallback gratuito local: nunca dejamos Crear IA sin música.
          // Cada opción recibe una identidad instrumental y armónica diferente.
          const userBrief = String(track.userMusicBrief || "professional deep-relaxation ambient music for peace and calm");
          const fallbackProfiles = [
            "USER BRIEF: "+userBrief+". Preserve its genre, mood, instruments, environment and tempo. Local timbral engine: felt piano with nylon guitar and cello colors. Do not turn the request into a generic relaxation preset.",
            "USER BRIEF: "+userBrief+". Preserve its genre, mood, instruments, environment and tempo. Local timbral engine: bowed strings and cello dominate, with sustained orchestral phrasing. Do not turn the request into a generic relaxation preset.",
            "USER BRIEF: "+userBrief+". Preserve its genre, mood, instruments, environment and tempo. Local timbral engine: warm analog synthesizer, evolving electronic layers and soft sub movement. Do not turn the request into a generic relaxation preset.",
            "USER BRIEF: "+userBrief+". Preserve its genre, mood, instruments, environment and tempo. Local timbral engine: airy bamboo/woodwind, nylon guitar and organic environmental texture. Do not turn the request into a generic relaxation preset."
          ];
          const fallbackProfile = fallbackProfiles[(Number(track.variant || 1) - 1) % fallbackProfiles.length];
          const fallbackTrack = { ...track, userMusicBrief: userBrief, musicProfile: fallbackProfile };
          await new Promise(resolve => setImmediate(resolve));
          makeCompositionWav(fallbackTrack, wav);
          await runFfmpeg([
            "-y","-i",wav,
            "-af","highpass=f=28,lowpass=f=18500,acompressor=threshold=-30dB:ratio=1.25:attack=35:release=400:makeup=1,alimiter=limit=0.94",
            "-ar","44100","-ac","2","-c:a","libmp3lame","-b:a","320k",out
          ]);
          track.provider = "RelaxScape Free Music Engine";
          track.generated = true;
          track.fallback = true;
          console.log("[RelaxScape Free Music Engine] LISTA:",track.file,"variante",track.variant);
      }
      if(!valid(track)) throw new Error("FFmpeg no creó un MP3 válido");
      const audioBytes=fs.readFileSync(out);
      const audioHash=createHash("sha256").update(audioBytes).digest("hex").slice(0,16);
      console.log("[Music fingerprint]",track.label,track.file,fs.statSync(out).size,"bytes",audioHash);
      return true;
    }catch(e){
      const msg=(e&&e.message)||String(e);
      aiMusicErrors.push(track.label+": "+msg);
      console.error("[Music v11] ERROR",track.file,e.stack||e.message);
      return false;
    }finally{
      try{fs.rmSync(wav,{force:true})}catch{}
    }
  };

  // Generamos dos en paralelo: Lyria puede tardar, pero así las 4 previas
  // aparecen mucho antes que con una cola estrictamente secuencial.
  const results=[];
  for(let i=0;i<pending.length;i+=2){
    const batch=pending.slice(i,i+2);
    results.push(...await Promise.all(batch.map(generateOne)));
  }
  console.log("[Music v19] Terminadas:",results.filter(Boolean).length,"/",pending.length);
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
        generated:true,
        fallback:Boolean(t.fallback),
        label:t.label,
        category:t.category
      };
    }).filter(Boolean);
  }

  return [];
}

app.post("/api/ai-options", async (req, res) => {
  const theme = String(req.body?.theme || "peaceful lake, misty mountains, soft dawn light").trim().slice(0, 120);
  const musicPrompt = String(req.body?.musicPrompt || "very slow deep relaxation piano, soft felt piano as the main instrument, sparse emotional notes, long sustained chords, warm intimate tone, subtle deep ambient pad, very spacious reverb, extremely gentle dynamics, no drums, no percussion, no beat, no rhythmic pulse, no vocals").trim().slice(0, 220);
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
    for (let i=0;i<pool.length;i++) {
      const photo=pool[i];
      const src=photo.src?.large2x || photo.src?.large;
      try {
        const img=await fetchWithTimeout(src,{},12000);
        if(!img.ok) continue;
        const filename="pexels-ai-"+photo.id+"-"+Date.now()+"-"+i+".jpg";
        fs.writeFileSync(path.join(IMAGE_DIR,filename),Buffer.from(await img.arrayBuffer()));
        images.push({name:filename,url:"/media/images/"+encodeURIComponent(filename),sourceUrl:photo.url||src,ai:false,provider:"Pexels",fallback:false,label:"Paisaje gratuito "+(images.length+1)});
      } catch(e) {
        imageErrors.push("Foto Pexels "+photo.id+": "+e.message);
      }
      if(images.length>=4) break;
    }
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

  // Las imágenes se devuelven inmediatamente. La música se prepara en segundo plano
  // para que Crear IA no quede bloqueado mientras se renderizan las 4 previas.
  // Cada pulsación de búsqueda debe crear 4 archivos NUEVOS.
  // Nunca reutilizamos una generación anterior aunque la descripción sea igual.
  const generationId = ++aiMusicGenerationId;
  aiMusicTracks = aiTracksForBackground(musicPrompt, generationId);
  aiMusicTracks.forEach(t => { try { fs.rmSync(path.join(MUSIC_DIR,t.file), {force:true}); } catch {} });
  aiMusicErrors = [];
  aiMusicPreparing = true;
  const currentTracks = aiMusicTracks;
  ensureBuiltinMusic(currentTracks)
    .catch(e=>{
      if (generationId === aiMusicGenerationId) {
        aiMusicErrors.push(e.message||String(e));
        console.error("[AI Music] preparación:",e.stack||e.message);
      }
    })
    .finally(()=>{
      if (generationId === aiMusicGenerationId) aiMusicPreparing=false;
    });
  const initialMusic=getAIMusicOptions();
  res.json({
    images,
    music:initialMusic,
    musicReady:initialMusic.length>=4,
    musicPreparing:aiMusicPreparing,
    imageErrors,
    musicErrors:aiMusicErrors.slice(),
    provider:"RelaxScape Free"
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
  const requestedDetails=musicIntentProfile(prompt);\n  const p="professional deep-relaxation ambient music for peace, calm and stress relief. Keep the overall genre peaceful, slow and non-aggressive, but adapt the composition to the user search: "+requestedDetails+". Use the requested instruments, environment, mood and atmosphere when compatible. No drums, no percussion, no aggressive bass, no abrupt changes unless the user explicitly requests them.";
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
      userMusicBrief:p,
      file:"ai-freeform-"+seed+"-"+(i+1)+".mp3",
      label:"IA · "+(i+1),
      variant:i+1,
      forceRegenerate:true,
      musicProfile:[
        "USER MUSIC BRIEF: "+p,
        "This is a fresh generation. Do not reuse, imitate or follow the arrangement of any previous generation.",
        "UNIQUE GENERATION NONCE: "+sessionNonce+". Treat this as a hard instruction to create a newly composed performance, not a cached or repeated result.",
        "The user's description is the source of truth. Follow its genre, instruments, melody, harmony, rhythm, structure, production and atmosphere.",
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