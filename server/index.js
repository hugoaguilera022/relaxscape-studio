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

function makeCompositionWav(track, wavPath, durationMs=18000){
  // SECUENCIADOR MUSICAL LOCAL
  // Convierte la petición del usuario en una pequeña "sesión" musical:
  // 1) interpreta estilo/tempo/ambiente,
  // 2) crea tonalidad + progresión,
  // 3) asigna un rol a CADA instrumento solicitado,
  // 4) escribe eventos MIDI-like (nota, tiempo, duración, velocidad, instrumento),
  // 5) renderiza esos eventos con el timbre solicitado.
  // IMPORTANTE: este bloque es exclusivamente de MÚSICA. La generación de imágenes
  // no se toca.
  const sr=24000, dur=Math.max(18,Math.min(600,Number(durationMs||18000)/1000)), n=Math.round(sr*dur), samples=new Float32Array(n*2);
  const variant=((Number(track.variant||1)-1)%4+4)%4;
  const rawBrief=String(track.userSearch||track.originalMusicPrompt||"relaxscape");
  const brief=rawBrief.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  const hz=m=>440*Math.pow(2,(m-69)/12);
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const has=(...w)=>w.some(x=>brief.includes(x));

  // -------------------- 1. INTERPRETACIÓN --------------------
  // INSTRUMENTOS: solo alias que realmente nombran un instrumento.
  // Los géneros ("electronic", "orchestral", etc.) NO crean instrumentos.
  const semantic={
    piano:has("piano","teclas","pianistico"),
    guitar:has("guitarra","guitar","guitarra acustica","guitarra clasica","guitarra de nylon","nylon guitar"),
    strings:has("cuerdas","strings","violin","cello","viola"),
    flute:has("flauta","flute","bambu"),
    synth:has("sintetizador","synth","synthesizer"),
    harp:has("arpa","harp"),
    kalimba:has("kalimba","mbira"),

    rain:has("lluvia","rain","tormenta","storm"),
    ocean:has("oceano","ocean","mar","olas","waves","sea","costa","beach"),
    river:has("rio","river","corriente","stream","arroyo","agua corriendo","agua corriente","corriente de agua","agua fluyendo","agua que corre","flowing water","running water","creek"),
    waterfall:has("cascada","waterfall"),
    forest:has("bosque","forest","woodland","pajaros","birds"),
    mountain:has("montana","mountain","alpine"),
    fireplace:has("chimenea","fireplace","fuego","fire","hogar"),

    night:has("noche","night","luna","moon","estrellas","stars"),
    sunset:has("atardecer","sunset","ocaso","golden hour"),
    sunrise:has("amanecer","sunrise","dawn"),

    sleep:has("sueno","sleep","dormir","sleeping"),
    meditation:has("meditacion","meditation","zen","mindfulness","yoga","respiracion"),
    spa:has("spa","wellness","bienestar"),

    cinematic:has("cinematico","cinematic","pelicula","film","banda sonora","soundtrack"),
    flamenco:has("flamenco","palmas","rumba"),
    lofi:has("lofi","lo-fi","chillhop"),
    jazz:has("jazz","swing","blues"),
    trap:has("trap","808","hip hop","hip-hop"),
    classical:has("clasico","classica","classical","sonata"),
    ambient:has("ambient","ambiente","ambiental"),
    warm:has("calido","warm","acogedor","cozy","intimo","intimate"),
    bright:has("luminoso","bright","alegre","sunny"),
    sad:has("triste","sad","melancolico","melancholic"),
    dreamy:has("sonador","dreamy","etereo","ethereal"),
    slow:has("lento","slow","muy tranquilo","very calm"),
    energetic:has("energetico","energetica","upbeat","rapido","fast","intenso")
  };

  // INSTRUMENTOS = solo los solicitados explícitamente. El estilo nunca añade uno.
  const requestedRoles=[];
  if(semantic.piano) requestedRoles.push("piano");
  if(semantic.guitar) requestedRoles.push("guitar");
  if(semantic.strings) requestedRoles.push("strings");
  if(semantic.flute) requestedRoles.push("flute");
  if(semantic.synth) requestedRoles.push("synth");
  if(semantic.harp) requestedRoles.push("harp");
  if(semantic.kalimba) requestedRoles.push("kalimba");

  // Si no se pide instrumento, NO se inventa ninguno.
  const lead=requestedRoles[0]||null;
  const companions=requestedRoles.slice(1);

  // -------------------- 2. SEMILLA + PARAMETROS --------------------
  let h=2166136261>>>0;
  const seedText=rawBrief+"|v="+variant+"|"+String(track.generationSeed||"");
  for(const ch of seedText){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}
  let rngState=(h^((variant+1)*0x9e3779b9))>>>0;
  const rnd=()=>{rngState^=rngState<<13;rngState^=rngState>>>17;rngState>>>=0;return rngState/4294967296;};
  const pick=a=>a[Math.floor(rnd()*a.length)];
  const hash01=(shift=0)=>(((h>>>shift)%997)/996);

  let root=pick([36,38,40,41,43,45,47,48,50,52,53,55]);
  if(semantic.night||semantic.sleep) root=Math.max(33,root-5);
  if(semantic.sunrise||semantic.sunset||semantic.bright) root=Math.min(55,root+4);
  if(semantic.ocean) root=45+Math.floor(hash01(7)*10);
  if(semantic.flamenco) root=40+Math.floor(hash01(5)*12);

  let scale;
  if(semantic.flamenco) scale=[0,1,4,5,7,8,10];
  else if(semantic.sad||semantic.night||semantic.sleep) scale=[0,2,3,5,7,8,10];
  else if(semantic.jazz) scale=[0,2,4,5,7,9,10];
  else if(semantic.classical) scale=variant%2?[0,2,3,5,7,9,11]:[0,2,4,5,7,9,11];
  else if(semantic.bright||semantic.sunrise) scale=[0,2,4,5,7,9,11];
  else scale=pick([[0,2,4,7,9],[0,2,3,5,7,9,10],[0,2,4,5,7,9,11]]);

  let bpm=42+Math.floor(hash01(11)*12);
  if(semantic.sleep) bpm=32+Math.floor(hash01(13)*6);
  if(semantic.meditation||semantic.spa||semantic.ambient) bpm=36+Math.floor(hash01(13)*8);
  if(semantic.river||semantic.ocean) bpm=40+Math.floor(hash01(13)*10);
  if(semantic.cinematic) bpm=42+Math.floor(hash01(13)*14);
  if(semantic.flamenco) bpm=84+Math.floor(hash01(13)*16);
  if(semantic.jazz) bpm=58+Math.floor(hash01(13)*20);
  if(semantic.trap) bpm=68+Math.floor(hash01(13)*18);
  if(semantic.energetic) bpm=82+Math.floor(hash01(13)*24);
  if(semantic.slow) bpm=Math.min(bpm,48);

  const beat=60/bpm, bar=beat*4;
  const degree=(d,o=0)=>root+scale[((d%scale.length)+scale.length)%scale.length]+12*o;

  // -------------------- 3. TIMBRES INSTRUMENTALES --------------------
  // Cada instrumento usa un modelo físico simplificado diferente.
  // No son ondas genéricas: ataque, parciales, envolvente y ruido mecánico
  // cambian según el instrumento solicitado.
  const sat=(x)=>Math.tanh(x);
  const hammerNoise=(t,seed)=>{
    const q=Math.sin((t*173.17+seed*19.37)*12.9898)*43758.5453;
    return (q-Math.floor(q))*2-1;
  };

  const piano=(f,t,v=1)=>{
    if(t<0||t>8)return 0;
    const attack=1-Math.exp(-t/.0028);
    const hammer=Math.exp(-t/.030)*(.030*hammerNoise(t,7));
    const body=Math.exp(-t/3.8);
    const modes=
      .72*Math.sin(2*Math.PI*f*t)+
      .18*Math.sin(2*Math.PI*f*2.003*t)+
      .060*Math.sin(2*Math.PI*f*3.009*t)+
      .025*Math.sin(2*Math.PI*f*4.018*t)+
      .010*Math.sin(2*Math.PI*f*5.03*t);
    return v*attack*(body*modes+hammer);
  };
  const pianoPedal=(f,t,v=1)=>{
    if(t<0||t>8)return 0;
    const body=Math.exp(-t/7.5);
    return v*body*(.42*Math.sin(2*Math.PI*f*t)+.12*Math.sin(2*Math.PI*f*2.003*t)+.035*Math.sin(2*Math.PI*f*3.009*t));
  };

  const guitar=(f,t,v=1)=>{
    if(t<0||t>5)return 0;
    const pluck=1-Math.exp(-t/.0018);
    const decay=Math.exp(-t/(1.05+1.8/(1+f/220)));
    const pick=Math.exp(-t/.018)*(.11*hammerNoise(t,13));
    const modes=.62*Math.sin(2*Math.PI*f*t)+.27*Math.sin(2*Math.PI*f*2.01*t)+.09*Math.sin(2*Math.PI*f*3.03*t);
    const body=.82+.18*Math.sin(2*Math.PI*.7*t);
    return v*pluck*decay*(body*modes+pick);
  };

  const strings=(f,t,v=1)=>{
    if(t<0||t>9)return 0;
    const attack=1-Math.exp(-t/.42);
    const bow=1+.035*hammerNoise(t*2.2,23);
    const body=Math.exp(-t/9.5);
    return v*attack*body*bow*(
      .50*Math.sin(2*Math.PI*f*t)+
      .25*Math.sin(2*Math.PI*f*2*t)+
      .13*Math.sin(2*Math.PI*f*3*t)+
      .06*Math.sin(2*Math.PI*f*4*t)+
      .025*Math.sin(2*Math.PI*f*5*t)
    );
  };

  const flute=(f,t,v=1)=>{
    if(t<0||t>8)return 0;
    const attack=1-Math.exp(-t/.14);
    const body=Math.exp(-t/5.2);
    const vib=1+.0048*Math.sin(2*Math.PI*5.2*t);
    const breath=(.75*hammerNoise(t*1.7,31)+.20*Math.sin(2*Math.PI*43*t)+.10*Math.sin(2*Math.PI*71*t));
    const air=Math.exp(-t/1.4)*.025;
    return v*attack*body*(.90*Math.sin(2*Math.PI*f*vib*t)+.075*Math.sin(2*Math.PI*2*f*vib*t)+.018*Math.sin(2*Math.PI*3*f*vib*t)+breath*air);
  };

  const synth=(f,t,v=1)=>{
    if(t<0||t>12)return 0;
    const a=1-Math.exp(-t/.65);
    return v*a*Math.exp(-t/10.5)*(
      .34*Math.sin(2*Math.PI*f*t)+
      .24*Math.sin(2*Math.PI*f*1.006*t)+
      .18*Math.sin(2*Math.PI*f*.994*t)+
      .12*Math.sin(2*Math.PI*f*2*t)
    );
  };

  const harp=(f,t,v=1)=>{
    if(t<0||t>5)return 0;
    const pluck=1-Math.exp(-t/.0012);
    const decay=Math.exp(-t/2.35);
    const transient=Math.exp(-t/.012)*.055*hammerNoise(t,47);
    return v*pluck*decay*(
      .66*Math.sin(2*Math.PI*f*t)+
      .22*Math.sin(2*Math.PI*f*2.98*t)+
      .075*Math.sin(2*Math.PI*f*5.01*t)+
      transient
    );
  };

  const kalimba=(f,t,v=1)=>{
    if(t<0||t>3.5)return 0;
    const pluck=1-Math.exp(-t/.0009);
    const decay=Math.exp(-t/1.55);
    return v*pluck*decay*(
      .45*Math.sin(2*Math.PI*f*t)+
      .30*Math.sin(2*Math.PI*f*2.71*t)+
      .16*Math.sin(2*Math.PI*f*5.17*t)+
      .06*Math.sin(2*Math.PI*f*7.83*t)
    );
  };
  const renderers={piano,guitar,strings,flute,synth,harp,kalimba};

  // -------------------- 4. SECUENCIA MUSICAL --------------------
  // Primero se construye una partitura interna. El audio se renderiza DESPUÉS.
  // La búsqueda determina forma, densidad, registro, fraseo y función de cada rol.
  const events=[];
  const add=(role,t,durBeats,degreeIndex,octave,velocity,kind="note")=>{
    if(!role||t>=dur)return;
    events.push({
      role,
      t,
      end:Math.min(dur,t+durBeats*beat),
      f:hz(degree(degreeIndex,octave)),
      v:velocity,
      kind
    });
  };

  // Armonía: progresión por compases. La progresión cambia según estilo, pero
  // siempre se mantiene dentro de la escala elegida.
  const progressionPool = semantic.flamenco
    ? [[0,5,4,3],[0,3,2,1],[0,5,3,4]]
    : semantic.jazz
      ? [[0,3,6,2],[0,2,5,1],[0,3,5,4]]
      : semantic.sad
        ? [[0,5,3,4],[0,3,6,4],[0,5,1,4]]
        : [[0,5,3,4],[0,3,5,4],[0,4,2,5],[0,2,5,3]];
  const progression=progressionPool[(Math.floor(hash01(19)*progressionPool.length)+variant-1+progressionPool.length)%progressionPool.length];
  const phraseShape=variant%2 ? [0,1,2,3,2,1,0,1] : [0,1,3,4,3,2,1,0];
  const phraseBars=semantic.slow||semantic.meditation||semantic.sleep||semantic.ambient ? 8 : 4;
  const totalBars=Math.min(8,Math.max(4,phraseBars));
  const sectionChange=(b)=>b===0?"A":b<totalBars/2?"A2":b===Math.floor(totalBars/2)?"B":"B2";

  // La armonía base se reparte entre los instrumentos pedidos.
  // Con un solo instrumento, ese instrumento lleva la armonía y la melodía.
  // Con varios, el primero lidera y los demás reciben un papel definido.
  const chordVoicing=(c,oct=0)=>{
    const third=scale.length>=7?c+2:c+2;
    const fifth=c+4;
    const seventh=scale.length>=7?c+6:null;
    const tones=[degree(c,oct),degree(third,oct),degree(fifth,oct)];
    if(seventh!==null) tones.push(degree(seventh,oct));
    return tones;
  };

  const roles=requestedRoles;
  const leadRole=lead;
  const roleVelocity={
    piano:.19,guitar:.18,strings:.145,flute:.17,synth:.14,harp:.16,kalimba:.16
  };

  // Registro y comportamiento de cada rol.
  const roleSpec={
    piano:{oct:-1,pattern:"chords"},
    guitar:{oct:-1,pattern:"arpeggio"},
    strings:{oct:-1,pattern:"sustain"},
    flute:{oct:1,pattern:"melody"},
    synth:{oct:-1,pattern:"pad"},
    harp:{oct:1,pattern:"arpeggio"},
    kalimba:{oct:1,pattern:"ostinato"}
  };

  // 8 compases máximos: A -> A2 -> B -> B2.
  // Así cada versión tiene desarrollo real en vez de repetir el mismo compás.
  for(let b=0;b<totalBars;b++){
    const c=progression[b%progression.length];
    const baseT=b*bar;
    const tones=chordVoicing(c,0);

    for(let r=0;r<roles.length;r++){
      const role=roles[r], spec=roleSpec[role], baseVel=roleVelocity[role]*(r===0?1.08:0.72);
      if(!spec)continue;

      if(spec.pattern==="chords"){
        // Piano: voicing completo, entradas espaciadas, sin convertirse en pad.
        add(role,baseT,.90,c,spec.oct,baseVel,"chord");
        add(role,baseT+bar*.33,.72,c+2,spec.oct,baseVel*.72,"chord");
        add(role,baseT+bar*.66,.72,c+4,spec.oct,baseVel*.64,"chord");
        add(role,baseT+bar*.82,.55,c+2,spec.oct,baseVel*.48,"chord");
      } else if(spec.pattern==="arpeggio"){
        // Guitarra/arpa: arpegio lento derivado del acorde, no notas aleatorias.
        const seq=[0,1,2,1,3,2,1,0];
        for(let j=0;j<8;j++){
          const t=baseT+j*bar/8;
          const d=tones[seq[(j+r+variant)%seq.length]]===undefined?c:(
            seq[(j+r+variant)%seq.length]===3?c+6: c+[0,2,4][seq[(j+r+variant)%seq.length]]
          );
          add(role,t,.46,d,spec.oct,baseVel*(j%4===0?1:.76),"arpeggio");
        }
      } else if(spec.pattern==="sustain"){
        // Cuerdas: dos voces largas, moviéndose con el acorde.
        add(role,baseT,3.6,c,spec.oct,baseVel,"sustain");
        add(role,baseT+.15,3.35,c+2,spec.oct,baseVel*.72,"sustain");
        if(scale.length>=7) add(role,baseT+.28,3.1,c+4,spec.oct,baseVel*.58,"sustain");
      } else if(spec.pattern==="pad"){
        // Synth: acordes lentos; SOLO existe si el usuario pidió synth.
        add(role,baseT,3.7,c,spec.oct,baseVel*.82,"pad");
        add(role,baseT+.18,3.5,c+2,spec.oct,baseVel*.56,"pad");
        add(role,baseT+.34,3.3,c+4,spec.oct,baseVel*.46,"pad");
      } else if(spec.pattern==="ostinato"){
        const seq=[0,2,4,2,1,3,4,2];
        for(let j=0;j<8;j++){
          const t=baseT+j*bar/8;
          add(role,t,.32, c+seq[(j+variant+b)%seq.length],spec.oct,baseVel*(j%2?.72:1),"ostinato");
        }
      } else if(spec.pattern==="melody"){
        // Flauta: frase cantabile con silencios, notas objetivo y aproximaciones.
        const motifs=[
          [0,1,2,4,5,4,2,1],[0,2,4,5,4,3,1,0],
          [0,3,2,4,6,5,3,2],[0,2,1,4,3,5,4,1]
        ];
        const motif=motifs[(Math.floor(hash01(23)*motifs.length)+variant+b)%motifs.length];
        for(let j=0;j<8;j++){
          if(j===1&&b%2===1)continue;
          if(j===5&&variant%2===0)continue;
          const t=baseT+j*bar/8;
          add(role,t,(j===3||j===7)?.78:.50,c+motif[j],spec.oct,baseVel*(j%4===0?1.08:.88),"melody");
          if(j===2||j===6) add(role,t+bar/16,.22,c+motif[(j+1)%8]+(variant%2?0:1),spec.oct,baseVel*.34,"passing");
        }
      }
    }

    // Si el primer instrumento NO es flauta, sigue habiendo una melodía real,
    // pero la interpreta el instrumento líder. Esto evita que el secuenciador
    // "invente" una flauta/synth/pad.
    if(leadRole && !["flute"].includes(leadRole)){
      const motifs=[
        [0,1,2,4,5,4,2,1],[0,2,4,5,4,3,1,0],
        [0,3,2,4,6,5,3,2],[0,2,1,4,3,5,4,1],
        [0,4,3,2,5,4,2,0]
      ];
      const motif=motifs[(Math.floor(hash01(29)*motifs.length)+variant+b)%motifs.length];
      const oct=(semantic.night||semantic.sleep)?-1:(semantic.energetic?1:0);
      for(let j=0;j<8;j++){
        if(j===1&&b%2===1)continue;
        if(j===5&&variant%2===0)continue;
        const t=baseT+j*bar/8;
        add(leadRole,t,(j===3||j===7)?.78:.50,c+motif[j],oct,roleVelocity[leadRole]*(j%4===0?1.1:.88),"melody");
        if(j===2||j===6) add(leadRole,t+bar/16,.22,c+motif[(j+1)%8]+(variant%2?0:1),oct,roleVelocity[leadRole]*.34,"passing");
      }
    }

    // Segundo/tercer instrumento: respuesta musical, nunca un timbre nuevo.
    companions.forEach((role,index)=>{
      const spec=roleSpec[role];
      if(!spec)return;
      const responseDegree=c+(index%2?4:2);
      const responseOct=spec.oct;
      add(role,baseT+bar*.62,1.15,responseDegree,responseOct,roleVelocity[role]*.42,"response");
    });
  }

  // Cadencia final: la pieza termina musicalmente, no con un corte arbitrario.
  if(leadRole){
    const finalC=progression[(totalBars-1)%progression.length];
    const finalT=(totalBars-1)*bar+bar*.72;
    add(leadRole,finalT,.95,finalC,-1,roleVelocity[leadRole]*.55,"cadence");
  }

  // -------------------- 5. AMBIENTES --------------------
  // Los ambientes son buses separados y SOLO se activan si se pidieron.
  const noiseAt=(t,seed=0)=>{
    let x=0;
    const freqs=[37.1,61.7,89.3,127.9,173.6,241.4,337.7,479.2,691.8];
    for(let k=0;k<freqs.length;k++){
      const f=freqs[k]+seed*(k%3+1)*.73;
      x+=Math.sin(2*Math.PI*f*t+Math.sin(t*(.31+k*.047)+seed)*1.7)*((k<3)?.9:1);
    }
    return x/8.2;
  };
  const grain=(t,seed=0)=>{
    const a=Math.sin((t*173.17+seed*19.37)*12.9898)*43758.5453;
    return (a-Math.floor(a))*2-1;
  };
  const texture=(t)=>{
    let x=0;
    if(semantic.river){
      const flow=.78+.22*Math.sin(2*Math.PI*.047*t+Math.sin(t*.11)*.8);
      const current=.018*flow*(Math.sin(2*Math.PI*31.7*t)+.55*Math.sin(2*Math.PI*47.3*t+1.1)+.32*Math.sin(2*Math.PI*73.9*t+2.4));
      const turbulence=.009*(.55+.45*Math.sin(2*Math.PI*.083*t+1.7))*(Math.sin(2*Math.PI*137*t)+.35*Math.sin(2*Math.PI*211*t+.8));
      const ripple=Math.pow(Math.max(0,Math.sin(2*Math.PI*(.63+.08*Math.sin(t*.13))*t+1.1)),18);
      const ripple2=Math.pow(Math.max(0,Math.sin(2*Math.PI*(1.17+.13*Math.sin(t*.21))*t+2.8)),22);
      const bubble=Math.pow(Math.max(0,Math.sin(2*Math.PI*(.29+.07*Math.sin(t*.17))*t+2.1)),30);
      x+=current+turbulence+ripple*.030+ripple2*.018+bubble*.022;
      x+=.006*Math.sin(2*Math.PI*(820+150*Math.sin(t*.19))*t)+.0015*grain(t*19.1,71);
    }
    if(semantic.ocean){
      const swell=.5+.5*Math.sin(2*Math.PI*.055*t+Math.sin(t*.07));
      const foam=Math.max(0,Math.sin(2*Math.PI*.23*t+Math.sin(t*.11)));
      x+=swell*(noiseAt(t*.8,11)*.048+grain(t*.45,17)*.012)+Math.pow(foam,7)*.035;
    }
    if(semantic.rain){
      const rainDensity=.78+.22*Math.sin(2*Math.PI*.17*t);
      x+=grain(t*7.3,19)*.034*rainDensity+noiseAt(t*1.9,23)*.026*rainDensity;
      const d1=Math.pow(Math.max(0,Math.sin(2*Math.PI*3.17*t+1.2)),32);
      const d2=Math.pow(Math.max(0,Math.sin(2*Math.PI*5.73*t+2.7)),38);
      const d3=Math.pow(Math.max(0,Math.sin(2*Math.PI*8.41*t+.4)),44);
      x+=d1*.045*Math.sin(2*Math.PI*(1850+260*Math.sin(t*.31))*t);
      x+=d2*.034*Math.sin(2*Math.PI*(2650+340*Math.sin(t*.23))*t);
      x+=d3*.022*Math.sin(2*Math.PI*(3400+420*Math.sin(t*.17))*t);
    }
    if(semantic.waterfall){
      const roar=.5+.5*Math.sin(2*Math.PI*.11*t);
      x+=roar*(grain(t*1.7,29)*.052+noiseAt(t*.9,29)*.042)+.012*Math.sin(2*Math.PI*(105+18*Math.sin(t*.17))*t);
    }
    if(semantic.forest){
      x+=grain(t*2.1,37)*.010+noiseAt(t,37)*.010;
      const bird=Math.pow(Math.max(0,Math.sin(2*Math.PI*.17*t)),18);
      x+=bird*.014*Math.sin(2*Math.PI*(1500+180*Math.sin(t*.27))*t);
    }
    if(semantic.fireplace){
      const crack=Math.pow(Math.max(0,Math.sin(2*Math.PI*.31*t+Math.sin(t*.7))),22);
      x+=grain(t*3.1,43)*.012+crack*.055*Math.sin(2*Math.PI*700*t);
    }
    return x;
  };

  // -------------------- 6. RENDER + MEZCLA --------------------
  // Renderizamos cada evento dentro de su propia ventana temporal. La versión
  // anterior recorría TODOS los eventos para CADA muestra, lo que hacía que
  // previews de 60 s pudieran tardar demasiado en Render. Esta ruta mantiene
  // exactamente la misma síntesis, pero reduce drásticamente el trabajo.
  for(const e of events){
    const renderer=renderers[e.role];
    if(!renderer)continue;
    const start=Math.max(0,Math.floor(e.t*sr));
    const end=Math.min(n,Math.ceil(e.end*sr));
    for(let i=start;i<end;i++){
      const nt=i/sr-e.t;
      if(nt<0)continue;
      const x=renderer(e.f,nt,e.v);
      const t=i/sr;
      const pan=.13*Math.sin(2*Math.PI*t/(8+(h%5)));
      samples[i*2]+=x*(1-pan);
      samples[i*2+1]+=x*(1+pan);
    }
  }

  for(let i=0;i<n;i++){
    const t=i/sr;
    let l=samples[i*2],r=samples[i*2+1];

    if(leadRole==="piano"){
      const barIndex=Math.min(totalBars-1,Math.max(0,Math.floor(t/bar)));
      const bt=barIndex*bar;
      const nt=t-bt;
      const c=progression[barIndex%progression.length];
      l+=pianoPedal(hz(degree(c)-12),nt,.045);
      r+=pianoPedal(hz(degree(c)-12),nt,.041);
    }

    const tx=texture(t);
    const envPan=.08*Math.sin(t*.37);
    l+=tx*(1.35-envPan);
    r+=tx*(1.35+envPan);

    if(semantic.sleep||semantic.night){l*=.82;r*=.82;}
    if(semantic.warm){l*=1.02;r*=1.02;}

    const fadeIn=Math.min(1,t/1.5), fadeOut=Math.min(1,(dur-t)/3), m=fadeIn*fadeOut;
    l=Math.tanh(l*1.35)*m;
    r=Math.tanh(r*1.35)*m;
    samples[i*2]=clamp(l,-.82,.82);
    samples[i*2+1]=clamp(r,-.82,.82);
  }

  let peak=0;
  for(const x of samples)peak=Math.max(peak,Math.abs(x));
  const gain=peak>.001?Math.min(1.25,.78/peak):1;
  for(let i=0;i<samples.length;i++)samples[i]*=gain;
  writeWav(wavPath,samples,sr,2);
}
async function generateAIMusicFile(track, outPath, durationMs=18000){
  // Motor local gratuito: la búsqueda del usuario controla directamente la composición.
  // Generamos WAV temporal y lo convertimos a MP3 real para que el navegador lo reproduzca.
  const wavPath=outPath.replace(/\.mp3$/i,".wav");
  makeCompositionWav(track, wavPath, durationMs);
  await runFfmpeg(["-y","-i",wavPath,"-c:a","libmp3lame","-b:a","192k","-ar","48000",outPath]);
  fs.rmSync(wavPath,{force:true});
  const stat=fs.statSync(outPath);
  if(!stat.size) throw new Error("El motor musical local no generó audio.");
  return stat.size;
}

async function ensureBuiltinMusic(tracks=[]){
  const results=[];
  for(const track of tracks){
    try{
      const out=path.join(MUSIC_DIR,track.file);
      fs.rmSync(out,{force:true});
      await generateAIMusicFile(track,out);
      track.provider="RelaxScape Free AI Music Engine";
      track.generated=true;
      track.fallback=false;
      track.musicPrompt=track.originalMusicPrompt;
      console.log("[AI Music] LISTA:",track.file,fs.statSync(out).size,"bytes");
      results.push(true);
    }catch(e){
      aiMusicErrors.push(track.label+": "+(e?.message||String(e)));
      console.error("[AI Music] ERROR",track.file,e?.stack||e?.message||e);
      results.push(false);
    }
  }
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

app.get("/api/youtube-info", async (req,res)=>{
  const raw=String(req.query.url||"").trim();
  if(!/^https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\//i.test(raw)){
    return res.status(400).json({error:"Introduce un enlace válido de YouTube."});
  }
  try{
    const url=new URL(raw);
    if(url.hostname==="youtu.be"){
      if(!url.pathname.slice(1)) throw new Error("Falta el identificador del vídeo.");
    }else if(!url.searchParams.get("v") && !/^\/shorts\//i.test(url.pathname) && !/^\/embed\//i.test(url.pathname)){
      throw new Error("No se encontró el identificador del vídeo.");
    }
    const oembed="https://www.youtube.com/oembed?url="+encodeURIComponent(raw)+"&format=json";
    const r=await fetchWithTimeout(oembed,{headers:{Accept:"application/json"}},10000);
    const data=await r.json().catch(()=>({}));
    if(!r.ok) return res.status(400).json({error:"YouTube no pudo reconocer ese vídeo."});
    res.json({
      title:data.title||"Vídeo de YouTube",
      author:data.author_name||"",
      thumbnail:data.thumbnail_url||"",
      sourceUrl:raw,
      promptSuggestion:String(data.title||"paisaje relajante").slice(0,180)
    });
  }catch(e){
    res.status(400).json({error:"No se pudo analizar el enlace de YouTube: "+(e.message||e)});
  }
});

app.post("/api/upload/image", imageUpload.single("image"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No se recibió ninguna imagen." });
  res.json({ name: req.file.filename, url: `/media/images/${encodeURIComponent(req.file.filename)}` });
});

app.get("/api/pexels-landscapes", async (req, res) => {
  const key = String(process.env.PEXELS_API_KEY || "").trim();
  if (!key) return res.status(400).json({ error: "Falta PEXELS_API_KEY en Render." });
  const query = String(req.query.query || "peaceful nature landscape").slice(0, 120);
  try {
    const search = await fetchWithTimeout(
      "https://api.pexels.com/v1/search?query=" + encodeURIComponent(query) +
      "&per_page=24&page=" + (1 + Math.floor(Math.random() * 5)) +
      "&orientation=landscape&size=large&locale=es-ES",
      { headers: { Authorization: key } }, 8000
    );
    const data = await search.json().catch(() => ({}));
    if (!search.ok) return res.status(search.status).json({ error: "Pexels HTTP " + search.status + ": " + (data.error || data.message || "error") });
    const photos = (data.photos || [])
      .filter(p => p.src?.large2x || p.src?.large)
      .sort(() => Math.random() - 0.5)
      .slice(0, 8);
    if (!photos.length) return res.status(404).json({ error: "Pexels no encontró paisajes para esta búsqueda." });
    res.json({
      images: photos.map((photo, i) => ({
        name: "pexels-" + photo.id + ".jpg",
        url: photo.src?.large2x || photo.src?.large || photo.src?.original,
        photographer: photo.photographer || "Pexels",
        sourceUrl: photo.url,
        provider: "Pexels",
        width: photo.width || 0,
        height: photo.height || 0,
        label: "Paisaje " + (i + 1)
      })),
      provider: "Pexels",
      query
    });
  } catch (e) { res.status(502).json({ error: "Error buscando paisajes: " + (e.message || e) }); }
});

app.post("/api/upload/music", musicUpload.single("music"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No se recibió ninguna pista." });
  res.json({ name: req.file.filename, url: `/media/music/${encodeURIComponent(req.file.filename)}` });
});

async function generateHuggingFaceLandscape(prompt, index=0) {
  const token = String(process.env.HF_TOKEN || "").trim();
  if (!token) throw new Error("HF_TOKEN no está configurado en Render.");

  const client = new InferenceClient(token);
  const variations = [
    "wide cinematic establishing shot, peaceful composition, realistic natural light, strong foreground depth",
    "wide cinematic landscape, atmospheric perspective, natural color, realistic professional photography, different camera angle",
    "wide cinematic landscape, subtle mist, detailed foreground, soft realistic lighting, photorealistic",
    "wide cinematic landscape, tranquil premium travel photography, realistic textures, natural depth and light"
  ];

  const userPrompt = String(prompt || "peaceful lake, misty mountains, soft dawn light").trim().slice(0, 700);
  const finalPrompt = [
    userPrompt,
    variations[index % variations.length],
    "photorealistic landscape photography",
    "cinematic natural lighting",
    "wide 16:9 composition",
    "no people, no buildings, no text, no logo"
  ].join(", ");

  // Hugging Face recomienda Inference Providers con selección automática.
  // No enviamos parámetros específicos de tamaño/pasos para evitar incompatibilidades
  // entre proveedores; el proveedor se encarga de los parámetros soportados.
  const imageBlob = await client.textToImage({
    model: "black-forest-labs/FLUX.1-schnell",
    inputs: finalPrompt,
    provider: "auto"
  });

  if (!imageBlob || typeof imageBlob.arrayBuffer !== "function") {
    throw new Error("Hugging Face no devolvió una imagen válida.");
  }

  const filename = "ai-landscape-" + Date.now() + "-" + index + ".png";
  const buffer = Buffer.from(await imageBlob.arrayBuffer());
  if (!buffer.length) throw new Error("Hugging Face devolvió una imagen vacía.");

  fs.writeFileSync(path.join(IMAGE_DIR, filename), buffer);

  return {
    name: filename,
    url: "/media/images/" + encodeURIComponent(filename),
    ai: true,
    provider: "Hugging Face Inference Providers · FLUX.1-schnell",
    fallback: false,
    label: "Paisaje IA " + (index + 1)
  };
}

async function generatePollinationsLandscape(prompt, index=0) {
  const userPrompt = String(prompt || "peaceful nature landscape").trim().slice(0, 700);
  const variations = [
    "wide cinematic establishing shot, peaceful composition, realistic natural light, strong foreground depth",
    "wide cinematic landscape, atmospheric perspective, natural color, realistic professional photography, different camera angle",
    "wide cinematic landscape, subtle mist, detailed foreground, soft realistic lighting, photorealistic",
    "wide cinematic landscape, tranquil premium travel photography, realistic textures, natural depth and light"
  ];
  const finalPrompt = [
    userPrompt,
    variations[index % variations.length],
    "photorealistic landscape photography",
    "cinematic natural lighting",
    "wide 16:9 composition",
    "no people, no buildings, no text, no logo"
  ].join(", ");

  const filename = "ai-landscape-pollinations-" + Date.now() + "-" + index + ".svg";
  const key = String(process.env.POLLINATIONS_API_KEY || "").trim();

  // Pollinations cambió su gateway: usamos el endpoint unificado actual primero.
  // Si no hay saldo o el proveedor falla, NO rompemos Crear IA/YouTube:
  // devolvemos un paisaje local válido como último recurso.
  const seed = Date.now() + index * 7919;
  const attempts = [
    "https://gen.pollinations.ai/image/" + encodeURIComponent(finalPrompt) +
      "?model=black-forest-labs/flux.1-schnell&seed=" + seed,
    "https://gen.pollinations.ai/image/" + encodeURIComponent(finalPrompt) +
      "?model=flux&seed=" + seed
  ];

  let lastError = null;
  for (const url of attempts) {
    try {
      const headers = { Accept: "image/*" };
      if (key && url.startsWith("https://gen.pollinations.ai/")) {
        headers.Authorization = "Bearer " + key;
      }
      const r = await fetchWithTimeout(url, { headers }, 120000);
      if (!r.ok) {
        const body = await r.text().catch(() => "");
        throw new Error("Pollinations HTTP " + r.status + (body ? " · " + body.slice(0, 180) : ""));
      }
      const buffer = Buffer.from(await r.arrayBuffer());
      if (!buffer.length) throw new Error("Pollinations devolvió una imagen vacía.");
      const contentType=String(r.headers.get("content-type")||"").toLowerCase();
      const ext=contentType.includes("png")?".png":contentType.includes("webp")?".webp":contentType.includes("svg")?".svg":".jpg";
      const actualFilename=filename.replace(/\.svg$/i,ext);
      fs.writeFileSync(path.join(IMAGE_DIR,actualFilename), buffer);
      return {
        name: actualFilename,
        url: "/media/images/" + encodeURIComponent(actualFilename),
        ai: true,
        provider: "Pollinations AI · FLUX",
        fallback: true,
        label: "Paisaje IA " + (index + 1)
      };
    } catch (error) {
      lastError = error;
      console.warn("[Pollinations Image] intento fallido:", error.message);
    }
  }

  // Último recurso gratuito y local: nunca dejamos la generación sin imagen.
  const fallback = makeFallbackLandscape(filename, userPrompt);
  // Último recurso gratuito y local: el SVG conserva su extensión correcta.
  return {
    ...fallback,
    ai: false,
    fallback: true,
    provider: "RelaxScape local fallback (Pollinations no disponible)",
    label: "Paisaje generado"
  };
}

app.post("/api/generate-image", async (req, res) => {
  const prompt = String(req.body.prompt || "Ultra-realistic cinematic peaceful landscape, natural light, no people, no text, photorealistic");
  try {
    // Mantiene intacta la configuración actual de Hugging Face.
    // Solo si HF rechaza la petición por créditos/cuota usamos el motor externo gratuito.
    try {
      return res.json(await generateHuggingFaceLandscape(prompt, 0));
    } catch (hfError) {
      const msg = String(hfError?.message || hfError);
      const quota = /credit|quota|deplet|included|balance|rate.?limit/i.test(msg);
      if (!quota) throw hfError;
      console.warn("[AI Image] Hugging Face sin créditos; usando Pollinations:", msg);
      return res.json(await generatePollinationsLandscape(prompt, 0));
    }
  } catch (e) {
    res.status(502).json({ error: "Error de generación IA: " + e.message });
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

async function generateAIImage(prompt, index=0) {
  return generateHuggingFaceLandscape(prompt, index);
}

app.post("/api/ai-images", async (req, res) => {
  const theme = String(req.body?.theme || "peaceful nature landscape").trim().slice(0, 700);
  const token = String(process.env.HF_TOKEN || "").trim();

  try {
    // El flujo HF/FLUX existente permanece intacto cuando tiene cuota.
    // Si la cuota mensual está agotada, cada una de las 4 opciones pasa
    // automáticamente al generador externo gratuito Pollinations.
    if (token) {
      const jobs = Array.from({ length: 4 }, (_, index) =>
        Promise.race([
          generateHuggingFaceLandscape(theme, index),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("La generación IA superó los 120 segundos.")), 120000)
          )
        ])
        .then(image => ({ ok: true, image }))
        .catch(error => ({ ok: false, error }))
      );
      const results = await Promise.all(jobs);
      const images = results.filter(x => x.ok).map(x => x.image);
      const errors = results.filter(x => !x.ok).map(x => x.error?.message || "Error desconocido");

      if (images.length) {
        return res.json({
          images,
          provider: "Hugging Face Inference Providers · FLUX.1-schnell",
          fallbackUsed: false,
          errors
        });
      }

      const quotaOnly = errors.length > 0 && errors.every(msg => /credit|quota|deplet|included|balance|rate.?limit/i.test(String(msg)));
      if (!quotaOnly) {
        return res.status(502).json({
          error: "No se pudo generar ningún paisaje IA.",
          imageErrors: errors
        });
      }
      console.warn("[AI Images] Hugging Face sin créditos; usando Pollinations.");
    }

    const jobs = Array.from({ length: 4 }, (_, index) =>
      generatePollinationsLandscape(theme, index)
        .then(image => ({ ok: true, image }))
        .catch(error => ({ ok: false, error }))
    );
    const results = await Promise.all(jobs);
    const images = results.filter(x => x.ok).map(x => x.image);
    const errors = results.filter(x => !x.ok).map(x => x.error?.message || "Error desconocido");
    if (!images.length) {
      return res.status(502).json({
        error: "No se pudo generar ningún paisaje IA con el motor gratuito externo.",
        imageErrors: errors
      });
    }
    return res.json({
      images,
      provider: "Pollinations AI · FLUX",
      fallbackUsed: true,
      errors
    });

    if (!images.length) {
      throw new Error(errors.join(" | ") || "Hugging Face no generó ninguna imagen.");
    }

    res.json({
      images,
      provider: "Hugging Face Inference Providers · FLUX.1-schnell",
      query: theme,
      errors
    });
  } catch (e) {
    console.error("[AI Landscape] ERROR", e);
    res.status(502).json({ error: "Error generando paisajes IA: " + (e.message || e) });
  }
});

const videoPreviewJobs=new Map();

// Previews de YouTube: MP4 ligero y estable para Render.
// El objetivo aquí es validar música + paisaje + duración, no renderizar el máster final.
const YOUTUBE_PREVIEW_SECONDS = 60;


async function generatePollinationsVideoPreview({prompt,imageUrl,outputPath,variant=1}){
  const cleanPrompt=String(prompt||"").trim().slice(0,700);
  const image=String(imageUrl||"").trim();
  if(!cleanPrompt) throw new Error("Falta el prompt para el vídeo externo.");
  if(!/^https?:\/\//i.test(image)) throw new Error("El paisaje debe tener una URL pública para el vídeo externo.");

  // Pollinations genera el movimiento; después solo sustituimos su audio por
  // nuestra música IA. Así evitamos codificar 60 s de vídeo desde cero en Render.
  const qs=new URLSearchParams({
    model:String(process.env.POLLINATIONS_VIDEO_MODEL||"bytedance/seedance-2.0-fast"),
    duration:"5",
    audio:"false",
    aspectRatio:"16:9",
    image,
    seed:String(Math.abs(hashString(cleanPrompt+"|"+variant))%2147483647)
  });
  const url="https://gen.pollinations.ai/video/"+encodeURIComponent(
    cleanPrompt+"; cinematic relaxing landscape, slow subtle camera movement, seamless calm motion, no people, no text"
  )+"?"+qs.toString();
  const headers={Accept:"video/mp4"};
  const key=String(process.env.POLLINATIONS_API_KEY||"").trim();
  if(key) headers.Authorization="Bearer "+key;

  const r=await fetchWithTimeout(url,{headers},120000);
  if(!r.ok) {
    const body=await r.text().catch(()=> "");
    throw new Error("Pollinations Video HTTP "+r.status+(body?" · "+body.slice(0,180):""));
  }
  const data=Buffer.from(await r.arrayBuffer());
  if(!data.length) throw new Error("Pollinations Video devolvió un MP4 vacío.");
  fs.writeFileSync(outputPath,data);
  return outputPath;
}

function hashString(value=""){
  let h=2166136261>>>0;
  for(const ch of String(value)){
    h^=ch.charCodeAt(0);
    h=Math.imul(h,16777619)>>>0;
  }
  return h>>>0;
}

async function muxExternalVideoWithMusic(videoPath,musicPath,outPath){
  // El vídeo externo dura unos segundos. Se repite por stream-copy hasta 60 s:
  // no se vuelve a comprimir la imagen, solo se codifica el audio AAC.
  await runFfmpeg([
    "-y",
    "-stream_loop","-1","-i",videoPath,
    "-stream_loop","-1","-i",musicPath,
    "-t",String(YOUTUBE_PREVIEW_SECONDS),
    "-map","0:v:0","-map","1:a:0",
    "-c:v","copy",
    "-c:a","aac","-b:a","64k",
    "-movflags","+faststart",
    outPath
  ]);
}

app.post("/api/video-preview-options",(req,res)=>{
  const prompt=String(req.body?.musicPrompt||"").trim().slice(0,700);
  const image=String(req.body?.image||"").trim();
  if(!prompt)return res.status(400).json({error:"Escribe primero qué música quieres crear."});
  if(!image)return res.status(400).json({error:"Selecciona primero un paisaje IA."});
  const jobId="vp-"+Date.now()+"-"+Math.random().toString(36).slice(2,8);
  const variants=[1,2,3].map((variant)=>({
    userSearch:prompt,originalMusicPrompt:prompt,
    musicProfile:buildAIMusicPrompt(prompt,variant),
    userMusicBrief:buildAIMusicPrompt(prompt,variant),
    variant,generationSeed:jobId+"-"+variant,
    file:"video-preview-"+jobId+"-"+variant+".mp3"
  }));
  videoPreviewJobs.set(jobId,{status:"running",progress:0,stage:"starting",results:[],error:null});
  (async()=>{
    const job=videoPreviewJobs.get(jobId);
    const work=path.join(VIDEO_DIR,jobId);
    fs.mkdirSync(work,{recursive:true});
    try{
      const imageName=decodeURIComponent(image.split("/").pop());
      let imagePath=path.join(IMAGE_DIR,imageName);
      if(!fs.existsSync(imagePath) && (image.startsWith("http://") || image.startsWith("https://"))){
        const downloaded=await fetchWithTimeout(image,{},10000);
        if(!downloaded.ok)throw new Error("No se pudo descargar el paisaje seleccionado.");
        imagePath=path.join(IMAGE_DIR,"preview-image-"+jobId+".jpg");
        fs.writeFileSync(imagePath,Buffer.from(await downloaded.arrayBuffer()));
      }
      if(!fs.existsSync(imagePath))throw new Error("No se encontró el paisaje seleccionado.");

      // Render's FFmpeg build has no SVG decoder. Rasterize fallback SVGs
      // into a small PPM image, which FFmpeg can decode natively.
      try {
        const probe=fs.readFileSync(imagePath);
        const head=probe.subarray(0,200).toString("utf8").trimStart();
        if(head.startsWith("<svg") || head.startsWith("<?xml")){
          const w=480,h=270,rows=[];
          for(let y=0;y<h;y++){
            const t=y/(h-1);
            for(let x=0;x<w;x++){
              let rr=Math.round(18+74*t),gg=Math.round(42+64*t),bb=Math.round(70+48*t);
              if(y>h*0.62){rr=22;gg=49;bb=58;}
              const ridge=h*(0.42+0.10*Math.sin(x/52)+0.06*Math.sin(x/19));
              if(Math.abs(y-ridge)<3 && y>h*0.28){rr=25;gg=53;bb=62;}
              rows.push(rr+" "+gg+" "+bb);
            }
          }
          const ppmPath=path.join(work,"video-image-"+jobId+".ppm");
          fs.writeFileSync(ppmPath,"P3\\n"+w+" "+h+"\\n255\\n"+rows.join("\\n"));
          imagePath=ppmPath;
        }
      }catch(e){
        console.warn("[Video previews] No se pudo preparar el paisaje:",e.message);
      }
      const results=[];
      const publicImageUrl=image.startsWith("http://")||image.startsWith("https://")
        ? image
        : "https://relaxscape-studio.onrender.com/media/images/"+encodeURIComponent(imageName);

      for(let i=0;i<variants.length;i++){
        const track=variants[i];
        const musicPath=path.join(work,track.file);
        await generateAIMusicFile(track,musicPath,18000);
        const videoName="video-preview-"+jobId+"-"+track.variant+".mp4";
        const out=path.join(VIDEO_DIR,videoName);
        const externalVideo=path.join(work,"external-"+track.variant+".mp4");

        job.stage="ai-video-"+track.variant;
        try{
          await generatePollinationsVideoPreview({
            prompt:track.originalMusicPrompt,
            imageUrl:publicImageUrl,
            outputPath:externalVideo,
            variant:track.variant
          });
          job.stage="mix-"+track.variant;
          await muxExternalVideoWithMusic(externalVideo,musicPath,out);
          console.log("[Video previews] Pollinations OK:",track.variant);
        }catch(externalErr){
          // Fallback local: si el proveedor externo está sin cuota/modelo,
          // mantenemos el flujo funcional sin tocar la generación de imágenes.
          console.warn("[Video previews] Pollinations fallback:",externalErr.message);
          job.stage="local-video-"+track.variant;
          await runFfmpeg([
            "-y","-loop","1","-i",imagePath,"-stream_loop","-1","-i",musicPath,
            "-t",String(YOUTUBE_PREVIEW_SECONDS),
            "-r","1",
            "-vf","scale=480:270:force_original_aspect_ratio=decrease,pad=480:270:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
            "-map","0:v:0","-map","1:a:0",
            "-c:v","libx264","-preset","ultrafast","-tune","stillimage","-crf","35","-threads","1",
            "-c:a","aac","-b:a","48k","-movflags","+faststart",out
          ]);
        }
        results.push({
          name:videoName,
          url:"/media/videos/"+encodeURIComponent(videoName),
          label:"Vídeo propuesta "+track.variant,
          variant:track.variant,
          durationSeconds:YOUTUBE_PREVIEW_SECONDS,
          musicUrl:"/media/music/"+encodeURIComponent(track.file),
          originalMusicPrompt:prompt,
          imageUrl:image
        });
        job.results=results.slice();
        job.progress=Math.round(((i+1)/variants.length)*100);
      }
      job.status="succeeded";
    }catch(e){
      console.error("[Video previews] ERROR",e.stack||e.message||e);
      console.error("[Video previews] job=",jobId,"progress=",job.progress,"results=",job.results.length);
      job.status="failed";
      job.error=e?.message||String(e);
    }finally{
      fs.rmSync(work,{recursive:true,force:true});
      setTimeout(()=>videoPreviewJobs.delete(jobId),30*60*1000);
    }
  })();
  res.status(202).json({jobId});
});

app.get("/api/video-preview-options-status",(req,res)=>{
  const job=videoPreviewJobs.get(String(req.query.jobId||""));
  if(!job)return res.status(404).json({error:"No se encontró la generación de vídeos."});
  res.json({status:job.status,progress:job.progress||0,stage:job.stage||"running",results:job.results||[],error:job.error||null});
});

app.post("/api/video-preview-final",async(req,res)=>{
  const prompt=String(req.body?.musicPrompt||"").trim().slice(0,700);
  const image=String(req.body?.image||"").trim();
  const variant=Math.min(3,Math.max(1,Number(req.body?.variant||1)));
  const hours=Number(req.body?.durationHours||1);
  if(!prompt||!image)return res.status(400).json({error:"Faltan el paisaje o la búsqueda musical."});
  if(!Number.isInteger(hours)||hours<1||hours>24)return res.status(400).json({error:"La duración debe ser entre 1 y 24 horas."});
  const imageName=decodeURIComponent(image.split("/").pop());
  const imagePath=path.join(IMAGE_DIR,imageName);
  if(!fs.existsSync(imagePath))return res.status(404).json({error:"No se encontró el paisaje seleccionado."});
  const work=path.join(VIDEO_DIR,"final-"+Date.now()+"-"+Math.random().toString(36).slice(2,7));
  const finalName="relaxscape-final-"+hours+"h-"+Date.now()+".mp4";
  const out=path.join(VIDEO_DIR,finalName);
  fs.mkdirSync(work,{recursive:true});
  try{
    const trackBase={
      userSearch:prompt,originalMusicPrompt:prompt,
      musicProfile:buildAIMusicPrompt(prompt,variant),
      userMusicBrief:buildAIMusicPrompt(prompt,variant),
      variant,forceRegenerate:true
    };
    const segments=[];
    for(let i=0;i<4;i++){
      const seg=path.join(work,"segment-"+i+".mp3");
      await generateAIMusicFile({...trackBase,generationSeed:"final-"+Date.now()+"-"+i},seg,180000);
      segments.push(seg);
    }
    const list=path.join(work,"concat.txt");
    fs.writeFileSync(list,segments.map(x=>"file '"+x.replace(/'/g,"'\\''")+"'").join("\n"));
    const base=path.join(work,"base.mp3");
    await runFfmpeg(["-y","-f","concat","-safe","0","-i",list,"-c:a","libmp3lame","-b:a","192k","-ar","48000",base]);
    await runFfmpeg([
      "-y","-loop","1","-i",imagePath,"-stream_loop","-1","-i",base,
      "-t",String(hours*3600),
      "-vf","scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
      "-c:v","libx264","-preset","veryfast","-crf","23","-c:a","aac","-b:a","160k","-shortest",out
    ]);
    res.json({name:finalName,url:"/media/videos/"+encodeURIComponent(finalName),hours,variant,generatedFromSearch:true,originalMusicPrompt:prompt});
  }catch(e){
    console.error("[Video final] ERROR",e.stack||e.message||e);
    res.status(500).json({error:"No se pudo crear el vídeo final: "+e.message});
  }finally{
    fs.rmSync(work,{recursive:true,force:true});
  }
});

app.post("/api/ai-music", async (req,res)=>{
  const musicPrompt=String(req.body?.musicPrompt||"deep relaxation ambient music").trim().slice(0,700);
  const generationId=++aiMusicGenerationId;
  aiMusicTracks=aiTracksForBackground(musicPrompt,generationId);
  aiMusicTracks.forEach(t=>{try{fs.rmSync(path.join(MUSIC_DIR,t.file),{force:true});}catch{}});
  aiMusicErrors=[];
  aiMusicPreparing=true;
  Promise.all(aiMusicTracks.map(track=>ensureBuiltinMusic([track])))
    .catch(e=>{if(generationId===aiMusicGenerationId)aiMusicErrors.push(e?.message||String(e));})
    .finally(()=>{if(generationId===aiMusicGenerationId)aiMusicPreparing=false;});
  res.json({music:[],musicReady:false,musicPreparing:true,generationId,provider:"RelaxScape Free AI Music Engine"});
});

app.post("/api/ai-options", async (req, res) => {
  const theme = String(req.body?.theme || "peaceful lake, misty mountains, soft dawn light").trim().slice(0, 500);
  const musicPrompt = String(req.body?.musicPrompt || theme).trim().slice(0, 220);
  const images = [];
  const imageErrors = [];

  // Generación IA real: las cuatro imágenes salen directamente de la búsqueda
  // del usuario mediante FLUX.1-schnell en Hugging Face.
  const jobs = Array.from({ length: 4 }, (_, i) =>
    Promise.race([
      generateAIImage(theme, i),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout 90s")), 90000))
    ]).then(item => ({ ok: true, item, index: i }))
      .catch(error => ({ ok: false, error, index: i }))
  );
  const results = await Promise.all(jobs);
  for (const result of results) {
    if (result.ok) images.push(result.item);
    else imageErrors.push("Imagen IA " + (result.index + 1) + ": " + result.error.message);
  }

  if (!images.length) {
    return res.status(502).json({
      error: "No se pudo generar ningún paisaje IA. Revisa HF_TOKEN en Render.",
      imageErrors
    });
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

function musicIntentProfile(prompt=""){
  const p=String(prompt||"").toLowerCase();
  const has=(...words)=>words.some(w=>p.includes(w));
  const parts=[];
  if(has("piano","teclas","pianístico","pianistica")) parts.push("warm acoustic felt piano, intimate close-mic piano tone");
  if(has("guitarra","acústica","acustica","nylon","guitar")) parts.push("professional nylon-string acoustic guitar");
  if(has("violín","violin","cello","cuerdas","strings","orquesta","orchestral")) parts.push("warm expressive bowed strings");
  if(has("flauta","flute","bambú","bambu","viento","wind")) parts.push("airy bamboo flute");
  if(has("agua","water","océano","oceano","mar","olas","waves","río","rio","lluvia","rain","cascada","waterfall")) parts.push("subtle realistic flowing-water ambience, integrated naturally behind the music");
  if(has("bosque","forest","montaña","montana","naturaleza","nature","pájaros","pajaros","birds","jardín","jardin")) parts.push("subtle organic nature ambience");
  if(has("spa","meditación","meditacion","zen","yoga","respiración","respiracion")) parts.push("deep spa and meditation atmosphere");
  if(has("sueño","sueno","dormir","sleep","noche","night","luna","moon","estrellas","stars")) parts.push("deep nocturnal sleep atmosphere");
  if(has("cinemático","cinematic","película","pelicula","film","emocional","emotional")) parts.push("cinematic evolving harmonic texture");
  if(has("lofi","lo-fi","chill","chillout")) parts.push("soft organic lo-fi texture");
  if(has("electrónica","electronica","synth","sintetizador","ambient")) parts.push("warm analog ambient synthesis");
  if(has("triste","melancólico","melancolico")) parts.push("gentle melancholic harmonic color");
  if(has("alegre","luminoso","bright","sunrise","amanecer")) parts.push("warm luminous harmonic color");
  if(has("relajante","relajación","relajacion","relax","calma","calmado","tranquilo","tranquila","bienestar","stress","estrés","ansiedad","anxiety")) parts.push("deep relaxation, very slow and gentle, soft sustained harmony, no aggressive rhythm, no abrupt changes");
  if(has("sin batería","sin bateria","sin percusión","sin percusion","no drums","no percussion")) parts.push("absolutely no drums or percussion");
  return parts.join(", ") || "deep relaxation ambient music, slow gentle pacing, warm sustained harmony";
}

function buildAIMusicPrompt(originalSearch="", variant=1){
  const search=String(originalSearch||"deep relaxation ambient music").trim().slice(0,700);
  const details=musicIntentProfile(search);
  const variants=[
    "Use a lyrical, memorable but very gentle main motif with spacious phrasing. Let the harmony evolve slowly through varied chord voicings.",
    "Use a different melodic contour and register from the other versions. Favor subtle call-and-response phrases and slower harmonic movement.",
    "Use a more textural arrangement with gradual layering, countermelody and delicate dynamic swells while keeping the requested subject and instruments clearly audible.",
    "Use the most contrasting musical interpretation that still obeys the search: different opening, motif, voicings, register and texture evolution, without becoming energetic."
  ];
  const relaxationGuard=/relax|relaj|calma|tranquil|sueñ|sleep|medit|zen|spa/i.test(search)
    ? "This is relaxation music: keep the energy low, dynamics smooth, attacks soft, and avoid drops, builds, tension or sudden transitions."
    : "Keep the arrangement controlled and suitable for a relaxing visual landscape unless the user explicitly requests otherwise.";
  return [
    "Create an original professional instrumental ambient composition for RelaxScape.",
    "USER SEARCH IS THE SOURCE OF TRUTH: ["+search+"].",
    "Translate the exact subject, environment, weather, time of day, emotion and requested instruments into the music; do not replace the search with a generic relaxation preset.",
    details+".",
    relaxationGuard,
    "Musical coherence is mandatory: establish a clear tonal center and compatible mode, a stable slow tempo and meter, intentional chord progression, consonant voice-leading, a recurring melodic idea with tasteful variation, and natural rhythmic phrasing.",
    "Use professional acoustic/ambient production: realistic instrument timbres, controlled dynamics, warm low mids, clean high frequencies, depth, stereo space and tasteful reverb.",
    "No vocals, no lyrics, no spoken word, no harsh distortion, no EDM drops, no aggressive drums or bass unless explicitly requested by the search.",
    variants[(Math.max(1,Number(variant))-1)%4],
    "The result must feel like a finished piece of music, not a static drone or a one-bar loop."
  ].join(" ");
}

function aiTracksForBackground(prompt="", generationId=0){
  const originalSearch=String(prompt||"").trim().slice(0,700);
  const sessionNonce="music-"+generationId+"-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,10);
  return [1,2,3,4].map((variant)=>{
    const file="ai-music-"+sessionNonce+"-"+variant+".mp3";
    return {
      ...BUILTIN_MUSIC[(variant-1)%BUILTIN_MUSIC.length],
      userSearch:originalSearch,
      originalMusicPrompt:originalSearch,
      userMusicBrief:buildAIMusicPrompt(originalSearch,variant),
      musicProfile:buildAIMusicPrompt(originalSearch,variant),
      file,
      label:"IA · "+variant,
      variant,
      forceRegenerate:true,
      generationSeed:sessionNonce,
      sessionNonce
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
  const {music,durationHours=1,musicPrompt=""}=req.body||{};
  if(!music) return res.status(400).json({error:"Selecciona una música de previa."});
  const hours=Number(durationHours);
  if(![1,2].includes(hours)) return res.status(400).json({error:"La duración debe ser de 1 o 2 horas."});
  const name=decodeURIComponent(String(music).split("/").pop());
  const source=path.join(MUSIC_DIR,name);
  if(!fs.existsSync(source)) return res.status(404).json({error:"No se encontró la música seleccionada."});
  const selectedTrack=aiMusicTracks.find(t=>t.file===name);
  const basePrompt=String(selectedTrack?.originalMusicPrompt||musicPrompt||"").trim();
  if(!basePrompt) return res.status(400).json({error:"No se pudo recuperar la búsqueda que originó la música. Vuelve a generar las opciones IA."});
  const stamp=Date.now(),work=path.join(MUSIC_DIR,"long-music-"+stamp);
  const finalName="relaxscape-selected-"+hours+"h-"+stamp+".mp3",out=path.join(MUSIC_DIR,finalName);
  fs.mkdirSync(work,{recursive:true});
  try{
    const directions=[
      "fresh second movement, new melody and compatible chord voicings, same calm identity",
      "fresh third movement, different motif and register, gradual texture development",
      "fresh fourth movement, different melodic contour and harmony, same exact environment and instruments",
      "gentle closing movement, spacious variation and resolved harmony, no energetic climax"
    ];
    const segments=[];
    for(let i=0;i<4;i++){
      const track={originalMusicPrompt:basePrompt,musicProfile:buildAIMusicPrompt(basePrompt,(i%4)+1)+" "+directions[i],label:"Long "+(i+1),file:"segment-"+i+".mp3"};
      const seg=path.join(work,track.file);
      await generateAIMusicFile(track,seg,180000);
      segments.push(seg);
    }
    const listFile=path.join(work,"concat.txt");
    fs.writeFileSync(listFile,segments.map(f=>"file '"+f.replace(/'/g,"'\\''")+"'").join("\n"));
    const base=path.join(work,"base.mp3");
    await runFfmpeg(["-y","-f","concat","-safe","0","-i",listFile,"-c:a","libmp3lame","-b:a","192k","-ar","48000",base]);
    await runFfmpeg(["-y","-stream_loop","-1","-i",base,"-t",String(hours*3600),"-c:a","copy",out]);
    res.json({name:finalName,url:"/media/music/"+encodeURIComponent(finalName),hours,sourcePreview:name,provider:"RelaxScape Free AI Music Engine",generatedFromSearch:true});
  }catch(e){
    console.error("[AI Music Long] ERROR",e.stack||e.message);
    res.status(500).json({error:"No se pudo crear la música larga: "+e.message});
  }finally{fs.rmSync(work,{recursive:true,force:true});}
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


// -------------------- FREESOUND EXTERNAL MUSIC SEARCH --------------------
// The external search is preview-only by default. We never alter the image
// generation pipeline. Previews are fetched from Freesound and can optionally
// be imported locally so they can be used in RelaxScape videos.
function buildFreesoundQueries(input=""){
  const q=String(input||"").trim().slice(0,500);
  const n=q.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  const aliases=[
    ["piano","piano acoustic","piano solo relaxing"],
    ["flauta","flute","bamboo flute"],
    ["guitarra","acoustic guitar","classical guitar"],
    ["violin","violin","solo violin"],
    ["cuerdas","strings","string ensemble"],
    ["arpa","harp","harp relaxing"],
    ["kalimba","kalimba","mbira"],
    ["lluvia","rain","rain ambience"],
    ["rio","river","flowing water"],
    ["corriente de agua","flowing water","stream water"],
    ["agua fluyendo","flowing water","stream water"],
    ["cascada","waterfall","waterfall ambience"],
    ["oceano","ocean waves","sea ambience"],
    ["mar","ocean waves","sea ambience"],
    ["bosque","forest ambience","forest birds"],
    ["pajaros","forest birds","birds nature"],
    ["chimenea","fireplace","fire crackling"],
    ["fuego","fireplace","fire crackling"]
  ];
  const expanded=[q];
  for(const [needle,...terms] of aliases){
    if(n.includes(needle)) expanded.push(...terms);
  }
  return [...new Set(expanded)].filter(Boolean).slice(0,4);
}

const freesoundSearchJobs=new Map();

async function runFreesoundSearchJob(jobId,input){
  const job=freesoundSearchJobs.get(jobId);
  if(!job)return;
  try{
    const key=process.env.FREESOUND_API_KEY;
    if(!key)throw new Error("Falta FREESOUND_API_KEY en Render.");
    const queries=buildFreesoundQueries(input).slice(0,2);
    const all=[];
    const results=await Promise.allSettled(queries.map(async query=>{
      const url=new URL("https://freesound.org/apiv2/search/");
      url.searchParams.set("query",query);
      url.searchParams.set("page_size","12");
      url.searchParams.set("sort","score");
      url.searchParams.set("fields","id,name,tags,username,license,url,duration,previews,description,avg_rating,num_downloads");
      const r=await fetchWithTimeout(url.toString(),{
        headers:{Authorization:"Token "+key,Accept:"application/json"}
      },7000);
      const data=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(data.detail||data.error||("HTTP "+r.status));
      return Array.isArray(data.results)?data.results:[];
    }));
    for(let i=0;i<results.length;i++){
      const result=results[i];
      if(result.status==="rejected"){
        console.warn("[Freesound Search] Query skipped:",queries[i],result.reason?.message||result.reason);
        continue;
      }
      for(const x of result.value){
        const preview=x.previews?.["preview-hq-mp3"]||x.previews?.["preview-lq-mp3"];
        if(!preview)continue;
        all.push({
          id:x.id,
          name:x.name||"Freesound audio",
          username:x.username||"Unknown",
          license:x.license||"Unknown",
          duration:Number(x.duration||0),
          rating:x.avg_rating==null?null:Number(x.avg_rating),
          downloads:Number(x.num_downloads||0),
          tags:Array.isArray(x.tags)?x.tags.slice(0,12):[],
          preview,
          sourceUrl:x.url||("https://freesound.org/s/"+x.id),
          provider:"Freesound"
        });
      }
    }
    const unique=[];
    const seen=new Set();
    for(const x of all){
      if(seen.has(x.id))continue;
      seen.add(x.id);
      unique.push(x);
    }
    unique.sort((a,b)=>(b.rating||0)-(a.rating||0)||b.downloads-a.downloads);
    job.status="succeeded";
    job.result={provider:"Freesound",query:input,results:unique.slice(0,12)};
  }catch(e){
    console.error("[Freesound Search] ERROR",e.stack||e.message||e);
    job.status="failed";
    job.error=e?.message||String(e);
  }finally{
    setTimeout(()=>freesoundSearchJobs.delete(jobId),10*60*1000);
  }
}

app.post("/api/external-music-search", async (req,res)=>{
  const input=String(req.body?.q||"").trim().slice(0,500);
  if(!input)return res.status(400).json({error:"Escribe qué música o sonido quieres buscar."});
  const jobId="fssearch-"+Date.now()+"-"+Math.random().toString(36).slice(2,8);
  freesoundSearchJobs.set(jobId,{status:"running",result:null,error:null});
  runFreesoundSearchJob(jobId,input);
  res.status(202).json({jobId});
});

app.get("/api/external-music-search-status",(req,res)=>{
  const job=freesoundSearchJobs.get(String(req.query.jobId||""));
  if(!job)return res.status(404).json({error:"No se encontró la búsqueda de Freesound."});
  if(job.status==="succeeded")return res.json({status:"succeeded",...job.result});
  if(job.status==="failed")return res.status(200).json({status:"failed",results:[],error:job.error||"Freesound no respondió correctamente."});
  res.json({status:"running"});
});

app.post("/api/import-external-music", async (req,res)=>{
  const {preview,name="Freesound preview",soundId,sourceUrl,username,license}=req.body||{};
  if(!preview || !/^https?:\/\//i.test(preview)) return res.status(400).json({error:"Previa externa no válida."});
  try{
    const r=await fetchWithTimeout(preview,{headers:{Accept:"audio/mpeg,audio/*"}},20000);
    if(!r.ok) throw new Error("Freesound preview HTTP "+r.status);
    const safeName=safe(String(name).slice(0,90)).replace(/\.(mp3|ogg|wav)$/i,"");
    const filename="freesound-"+String(soundId||Date.now())+"-"+safeName+".mp3";
    const out=path.join(MUSIC_DIR,filename);
    fs.writeFileSync(out,Buffer.from(await r.arrayBuffer()));
    const stat=fs.statSync(out);
    if(!stat.size) throw new Error("La previa externa llegó vacía.");
    res.json({
      name:filename,
      url:"/media/music/"+encodeURIComponent(filename),
      label:name,
      provider:"Freesound",
      sourceUrl,
      username,
      license,
      externalId:soundId
    });
  }catch(e){
    console.error("[Freesound Import] ERROR",e.stack||e.message);
    res.status(502).json({error:"No se pudo importar la previa de Freesound: "+e.message});
  }
});


// -------------------- FREESOUND AI MIX --------------------
// This endpoint is intentionally built on the already-stable local music engine.
// It keeps Freesound search/import intact and does NOT touch the image pipeline.
// The frontend uses a small async job because composition/rendering can take time.
const freesoundAiJobs = new Map();

function createFreesoundAiJob(query){
  const jobId="fsai-"+Date.now()+"-"+Math.random().toString(36).slice(2,8);
  freesoundAiJobs.set(jobId,{status:"running",progress:0,result:null,error:null});
  (async()=>{
    const job=freesoundAiJobs.get(jobId);
    try{
      const input=String(query||"").trim().slice(0,500);
      if(!input) throw new Error("Escribe primero el género, estilo o descripción musical.");

      // Use Freesound as the musical reference layer: names/tags from the current
      // search are fed into the composition brief, while the actual rendering
      // remains local and free so no paid API is required.
      let referenceText="";
      try{
        const key=process.env.FREESOUND_API_KEY;
        if(key){
          const queries=buildFreesoundQueries(input);
          const refs=[];
          for(const q of queries.slice(0,2)){
            const u=new URL("https://freesound.org/apiv2/search/");
            u.searchParams.set("query",q);
            u.searchParams.set("page_size","4");
            u.searchParams.set("sort","score");
            u.searchParams.set("fields","id,name,tags,description");
            const rr=await fetchWithTimeout(u.toString(),{headers:{Authorization:"Token "+key,Accept:"application/json"}},10000);
            const dd=await rr.json().catch(()=>({}));
            if(rr.ok){
              for(const x of (dd.results||[])){
                refs.push((x.name||"")+(Array.isArray(x.tags)&&x.tags.length?" ["+x.tags.slice(0,6).join(", ")+"]":""));
              }
            }
          }
          referenceText=[...new Set(refs)].slice(0,8).join("; ");
        }
      }catch(refErr){
        console.warn("[Freesound AI Mix] reference search skipped:",refErr.message);
      }

      const brief=referenceText
        ? input+" | Freesound references: "+referenceText
        : input;

      const work=path.join(MUSIC_DIR,"fs-ai-"+jobId);
      fs.mkdirSync(work,{recursive:true});
      try{
        const segments=[];
        // Eight independent sections give the result development instead of a
        // single short loop. Each section keeps the same search identity but
        // changes the musical seed/variation.
        for(let i=0;i<8;i++){
          job.progress=Math.round((i/8)*85);
          const file="segment-"+i+".mp3";
          const out=path.join(work,file);
          await generateAIMusicFile({
            originalMusicPrompt:brief,
            userSearch:input,
            musicProfile:buildAIMusicPrompt(input,(i%4)+1),
            label:"Freesound AI Mix "+(i+1),
            file,
            variant:(i%4)+1,
            generationSeed:Date.now()+i*7919,
            forceRegenerate:true
          },out,180000);
          segments.push(out);
          job.progress=Math.round(((i+1)/8)*85);
        }

        const listFile=path.join(work,"concat.txt");
        fs.writeFileSync(listFile,segments.map(f=>"file '"+f.replace(/'/g,"'\\''")+"'").join("\n"));
        const base=path.join(work,"base.mp3");
        await runFfmpeg(["-y","-f","concat","-safe","0","-i",listFile,"-c:a","libmp3lame","-b:a","192k","-ar","48000",base]);

        const stamp=Date.now();
        const finalName="freesound-ai-mix-"+stamp+".mp3";
        const finalPath=path.join(MUSIC_DIR,finalName);
        await runFfmpeg(["-y","-stream_loop","-1","-i",base,"-t","3600","-c:a","copy",finalPath]);

        job.progress=100;
        job.status="succeeded";
        job.result={
          name:finalName,
          url:"/media/music/"+encodeURIComponent(finalName),
          label:"Música IA · "+input,
          provider:"RelaxScape Free AI Music Engine + Freesound references",
          generatedFromSearch:true,
          source:"Freesound",
          query:input,
          durationHours:1
        };
      }finally{
        fs.rmSync(work,{recursive:true,force:true});
      }
    }catch(e){
      job.status="failed";
      job.error=e?.message||String(e);
      console.error("[Freesound AI Mix] ERROR",e?.stack||e?.message||e);
    }
    // Keep completed jobs around briefly so the polling request can retrieve them.
    setTimeout(()=>freesoundAiJobs.delete(jobId),10*60*1000);
  })();
  return jobId;
}


// -------------------- FREESOUND SELECTED MIX --------------------
const selectedMixJobs=new Map();

async function buildSelectedFreesoundMixJob(jobId,tracks,durationHours){
  const job=selectedMixJobs.get(jobId);
  if(!job)return;
  const work=path.join(MUSIC_DIR,"selected-mix-"+jobId);
  fs.mkdirSync(work,{recursive:true});
  try{
    const local=[];
    for(let i=0;i<tracks.length;i++){
      const t=tracks[i]||{};
      if(!t.preview || !/^https?:\/\//i.test(t.preview)) throw new Error("Una de las previas seleccionadas no es válida.");
      const rr=await fetchWithTimeout(t.preview,{headers:{Accept:"audio/mpeg,audio/*"}},20000);
      if(!rr.ok) throw new Error("Freesound preview HTTP "+rr.status);
      const file=path.join(work,"source-"+i+".mp3");
      fs.writeFileSync(file,Buffer.from(await rr.arrayBuffer()));
      if(!fs.statSync(file).size) throw new Error("Una de las previas seleccionadas llegó vacía.");
      local.push(file);
      job.progress=Math.round(((i+1)/tracks.length)*30);
    }

    const inputs=[],filters=[];
    const layerVolume=(0.78/local.length).toFixed(5);
    for(let i=0;i<local.length;i++){
      inputs.push("-stream_loop","-1","-i",local[i]);
      filters.push("["+i+":a]aresample=48000,volume="+layerVolume+"[a"+i+"]");
    }
    const joined=local.map((_,i)=>"[a"+i+"]").join("");
    filters.push(joined+"amix=inputs="+local.length+":duration=longest:dropout_transition=5:normalize=0[mix]");
    filters.push("[mix]alimiter=limit=0.96:attack=5:release=50[out]");

    // Short preview first: this is the actual selected mix, not a generic sample.
    const previewName="selected-freesound-preview-"+durationHours+"h-"+Date.now()+".mp3";
    const previewPath=path.join(MUSIC_DIR,previewName);
    await runFfmpeg(["-y",...inputs,"-filter_complex",filters.join(";"),"-map","[out]","-t","90","-c:a","libmp3lame","-b:a","192k","-ar","48000",previewPath]);
    job.preview={
      name:previewName,
      url:"/media/music/"+encodeURIComponent(previewName),
      durationSeconds:90
    };
    job.progress=40;
    job.status="preview-ready";

    // Build the requested 1 or 2 hour file in the background.
    const finalName="selected-freesound-mix-"+durationHours+"h-"+Date.now()+".mp3";
    const finalPath=path.join(MUSIC_DIR,finalName);
    await runFfmpeg(["-y",...inputs,"-filter_complex",filters.join(";"),"-map","[out]","-t",String(durationHours*3600),"-c:a","libmp3lame","-b:a","192k","-ar","48000",finalPath]);
    job.progress=100;
    job.status="succeeded";
    job.result={
      name:finalName,
      url:"/media/music/"+encodeURIComponent(finalName),
      label:"Mezcla · "+local.length+" sonidos Freesound · "+durationHours+" h",
      provider:"Freesound selected mix",
      source:"Freesound",
      isFreesoundMix:true,
      generatedFromSearch:false,
      durationHours,
      tracks:tracks.map(t=>({id:t.id,name:t.name,sourceUrl:t.sourceUrl,username:t.username,license:t.license}))
    };
  }catch(e){
    job.status="failed";
    job.error=e?.message||String(e);
    console.error("[Selected Freesound Mix] ERROR",e?.stack||e?.message||e);
  }finally{
    fs.rmSync(work,{recursive:true,force:true});
    setTimeout(()=>selectedMixJobs.delete(jobId),10*60*1000);
  }
}

app.post("/api/mix-selected-freesound", async (req,res)=>{
  const tracks=Array.isArray(req.body?.tracks)?req.body.tracks.slice(0,6):[];
  if(tracks.length<2) return res.status(400).json({error:"Selecciona al menos 2 sonidos para crear la mezcla."});
  const durationHours=Number(req.body?.durationHours||1);
  if(![1,2].includes(durationHours)) return res.status(400).json({error:"La duración de la mezcla debe ser de 1 o 2 horas."});
  const jobId="selected-"+Date.now()+"-"+Math.random().toString(36).slice(2,8);
  selectedMixJobs.set(jobId,{status:"running",progress:0,preview:null,result:null,error:null});
  buildSelectedFreesoundMixJob(jobId,tracks,durationHours);
  res.json({jobId,durationHours});
});

app.get("/api/mix-selected-freesound-status", (req,res)=>{
  const job=selectedMixJobs.get(String(req.query.jobId||""));
  if(!job)return res.status(404).json({error:"No se encontró la mezcla solicitada."});
  res.json({
    status:job.status,
    progress:job.progress||0,
    preview:job.preview||null,
    result:job.result||null,
    error:job.error||null
  });
});

app.post("/api/generate-freesound-ai-mix", (req,res)=>{
  try{
    const query=String(req.body?.query||"").trim();
    if(!query) return res.status(400).json({error:"Escribe primero el género, estilo o descripción musical."});
    const jobId=createFreesoundAiJob(query);
    res.json({jobId});
  }catch(e){
    res.status(500).json({error:"No se pudo iniciar la generación musical: "+e.message});
  }
});

app.get("/api/generate-freesound-ai-mix-status", (req,res)=>{
  const jobId=String(req.query.jobId||"");
  const job=freesoundAiJobs.get(jobId);
  if(!job) return res.status(404).json({error:"No se encontró la generación musical solicitada."});
  if(job.status==="succeeded") return res.json({status:"succeeded",progress:100,result:job.result});
  if(job.status==="failed") return res.status(500).json({status:"failed",error:job.error});
  res.json({status:"running",progress:job.progress||0});
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
const server = app.listen(port, "0.0.0.0", () => {
  console.log(`RelaxScape activo en http://0.0.0.0:${port}`);
});
// Render uses a reverse proxy in front of Node. Keep the connection open long
// enough for the proxy and avoid intermittent 502s on long-running operations.
server.keepAliveTimeout = 120000;
server.headersTimeout = 125000;