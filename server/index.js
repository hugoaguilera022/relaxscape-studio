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

const BUILTIN_MUSIC = [
  { file: "relax-piano.mp3", label: "Piano nocturno", category: "Sueño", f1: 261.63, f2: 329.63, f3: 392 },
  { file: "relax-ocean.mp3", label: "Ondas del océano", category: "Naturaleza", f1: 220, f2: 277.18, f3: 329.63 },
  { file: "relax-meditation.mp3", label: "Meditación profunda", category: "Meditación", f1: 174.61, f2: 261.63, f3: 349.23 },
  { file: "relax-dream.mp3", label: "Sueño tranquilo", category: "Sueño", f1: 196, f2: 246.94, f3: 293.66 },
  { file: "relax-rain.mp3", label: "Lluvia suave", category: "Naturaleza", f1: 146.83, f2: 220, f3: 293.66 },
  { file: "relax-forest.mp3", label: "Bosque sereno", category: "Naturaleza", f1: 164.81, f2: 246.94, f3: 329.63 },
  { file: "relax-mountains.mp3", label: "Montañas al amanecer", category: "Naturaleza", f1: 196, f2: 293.66, f3: 392 },
  { file: "relax-sunset.mp3", label: "Atardecer cálido", category: "Relax", f1: 174.61, f2: 220, f3: 329.63 },
  { file: "relax-night.mp3", label: "Noche estrellada", category: "Sueño", f1: 130.81, f2: 196, f3: 261.63 },
  { file: "relax-deep-sleep.mp3", label: "Sueño profundo", category: "Sueño", f1: 110, f2: 164.81, f3: 220 },
  { file: "relax-spa.mp3", label: "Spa y bienestar", category: "Relax", f1: 220, f2: 329.63, f3: 440 },
  { file: "relax-yoga.mp3", label: "Yoga tranquilo", category: "Meditación", f1: 146.83, f2: 220, f3: 369.99 },
  { file: "relax-focus.mp3", label: "Concentración", category: "Concentración", f1: 261.63, f2: 392, f3: 523.25 },
  { file: "relax-calm.mp3", label: "Calma absoluta", category: "Relax", f1: 196, f2: 246.94, f3: 349.23 },
  { file: "relax-fireplace.mp3", label: "Chimenea acogedora", category: "Relax", f1: 130.81, f2: 196, f3: 293.66 },
  { file: "relax-river.mp3", label: "Río tranquilo", category: "Naturaleza", f1: 164.81, f2: 220, f3: 329.63 },
  { file: "relax-piano-rain.mp3", label: "Piano y lluvia", category: "Sueño", f1: 196, f2: 246.94, f3: 392 },
  { file: "relax-ocean-night.mp3", label: "Océano nocturno", category: "Sueño", f1: 164.81, f2: 220, f3: 329.63 },
  { file: "relax-zen.mp3", label: "Zen oriental", category: "Meditación", f1: 146.83, f2: 220, f3: 293.66 },
  { file: "relax-breathing.mp3", label: "Respiración y calma", category: "Meditación", f1: 130.81, f2: 174.61, f3: 261.63 },
  { file: "relax-clouds.mp3", label: "Nubes suaves", category: "Relax", f1: 196, f2: 293.66, f3: 440 },
  { file: "relax-waterfall.mp3", label: "Cascada relajante", category: "Naturaleza", f1: 174.61, f2: 261.63, f3: 349.23 },
  { file: "relax-cafe.mp3", label: "Café tranquilo", category: "Relax", f1: 220, f2: 329.63, f3: 392 },
  { file: "relax-study.mp3", label: "Estudio profundo", category: "Concentración", f1: 196, f2: 293.66, f3: 392 }
];async function refreshDailyLandscape() {
  const key = process.env.PEXELS_API_KEY;
  if (!key) throw new Error("Falta PEXELS_API_KEY para renovar el paisaje diario.");
  const queries = [
    "peaceful mountain lake sunrise",
    "calm ocean sunset",
    "misty forest nature",
    "rainy window nature",
    "waterfall peaceful nature",
    "snowy mountains landscape",
    "starry night landscape",
    "peaceful river valley",
    "clouds over mountains",
    "tropical beach calm ocean"
  ];
  const query = queries[Math.floor(Math.random() * queries.length)];
  const page = 1 + Math.floor(Math.random() * 10);
  const r = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=40&page=${page}&orientation=landscape&size=large&locale=en-US`, {headers:{Authorization:key}});
  const data = await r.json();
  if (!r.ok) throw new Error("Pexels: " + (data.error || data.message || ("HTTP " + r.status)));
  const photos=(data.photos||[]).filter(p=>p.width>=1920&&p.height>=1080&&(p.src?.large2x||p.src?.large));
  if(!photos.length) throw new Error("Pexels no encontró un paisaje diario en Full HD.");
  const photo=photos[Math.floor(Math.random()*photos.length)];
  const url=photo.src?.large2x||photo.src?.large;
  const img=await fetch(url);
  if(!img.ok) throw new Error("No se pudo descargar el paisaje diario.");
  const filename=`daily-landscape-${new Date().toISOString().slice(0,10)}-${photo.id}.jpg`;
  fs.writeFileSync(path.join(IMAGE_DIR,filename),Buffer.from(await img.arrayBuffer()));
  return {name:filename,url:`/media/images/${encodeURIComponent(filename)}`,photographer:photo.photographer||"Pexels",sourceUrl:photo.url};
}

async function generateDaily() {
  const music = listFiles(MUSIC_DIR, "/media/music");
  if (!music.length) return console.log("Daily render omitido: falta música.");
  try {
    const dailyImage = await refreshDailyLandscape();

    // Cada día elegimos una pista diferente de forma determinista según la fecha.
    // Así evitamos repetir la misma música en días consecutivos mientras haya pistas disponibles.
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
  } catch (e) { console.error("Daily render error:", e.message); }
};