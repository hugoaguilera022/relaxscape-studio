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

const BUILTIN_MUSIC = [\n  { file: "relax-piano.mp3", label: "Piano nocturno", f1: 261.63, f2: 329.63, f3: 392 },
  { file: "relax-ocean.mp3", label: "Ondas del océano", f1: 220, f2: 277.18, f3: 329.63 },
  { file: "relax-meditation.mp3", label: "Meditación profunda", f1: 174.61, f2: 261.63, f3: 349.23 },
  { file: "relax-dream.mp3", label: "Sueño tranquilo", f1: 196, f2: 246.94, f3: 293.66 },
  { file: "relax-rain.mp3", label: "Lluvia suave", f1: 146.83, f2: 220, f3: 293.66 },
  { file: "relax-forest.mp3", label: "Bosque sereno", f1: 164.81, f2: 246.94, f3: 329.63 },
  { file: "relax-mountains.mp3", label: "Montañas al amanecer", f1: 196, f2: 293.66, f3: 392 },
  { file: "relax-sunset.mp3", label: "Atardecer cálido", f1: 174.61, f2: 220, f3: 329.63 },
  { file: "relax-night.mp3", label: "Noche estrellada", f1: 130.81, f2: 196, f3: 261.63 },
  { file: "relax-deep-sleep.mp3", label: "Sueño profundo", f1: 110, f2: 164.81, f3: 220 },
  { file: "relax-spa.mp3", label: "Spa y bienestar", f1: 220, f2: 329.63, f3: 440 },
  { file: "relax-yoga.mp3", label: "Yoga tranquilo", f1: 146.83, f2: 220, f3: 369.99 },
  { file: "relax-focus.mp3", label: "Concentración", f1: 261.63, f2: 392, f3: 523.25 },
  { file: "relax-calm.mp3", label: "Calma absoluta", f1: 196, f2: 246.94, f3: 349.23 },
  { file: "relax-fireplace.mp3", label: "Chimenea acogedora", f1: 130.81, f2: 196, f3: 293.66 },
  { file: "relax-river.mp3", label: "Río tranquilo", f1: 164.81, f2: 220, f3: 329.63 }\n];;