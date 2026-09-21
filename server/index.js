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

function listFiles(dir, base) {
  return fs.readdirSync(dir)
    .filter(f => !f.startsWith("."))
    .map(f => ({
      name: f,
      url: `${base}/${encodeURIComponent(f)}`
    }));
}

app.get("/api/library", (_, res) => {
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

app.post("/api/upload/music", musicUpload.single("music"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No se recibió ninguna pista." });
  res.json({ name: req.file.filename, url: `/media/music/${encodeURIComponent(req.file.filename)}` });
});

app.post("/api/generate-image", async (req, res) => {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return res.status(400).json({ error: "Añade OPENAI_API_KEY para activar la generación de paisajes con IA." });

  const prompt = req.body.prompt || "Ultra-realistic cinematic landscape for a relaxing meditation video, natural light, no people, no text, wide composition, photorealistic";
  try {
    const r = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify({ model: "gpt-image-2", prompt, size: "1536x1024", quality: "medium" })
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data.error?.message || "Error generando imagen." });

    const b64 = data.data?.[0]?.b64_json;
    if (!b64) return res.status(500).json({ error: "La API no devolvió una imagen." });

    const filename = `ai-${Date.now()}.png`;
    fs.writeFileSync(path.join(IMAGE_DIR, filename), Buffer.from(b64, "base64"));
    res.json({ name: filename, url: `/media/images/${filename}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, args);
    let stderr = "";
    p.stderr.on("data", d => stderr += d.toString());
    p.on("close", code => code === 0 ? resolve() : reject(new Error(stderr.slice(-4000))));
  });
}

app.post("/api/generate-video", async (req, res) => {
  const { image, music, durationHours = 1 } = req.body || {};
  if (!image || !music) return res.status(400).json({ error: "Selecciona una imagen y una pista de música." });

  const imageName = decodeURIComponent(image.split("/").pop());
  const musicName = decodeURIComponent(music.split("/").pop());
  const imagePath = path.join(IMAGE_DIR, imageName);
  const musicPath = path.join(MUSIC_DIR, musicName);
  if (!fs.existsSync(imagePath) || !fs.existsSync(musicPath)) return res.status(404).json({ error: "No se encontró el archivo seleccionado." });

  const hours = Number(durationHours);
  if (![1, 2].includes(hours)) return res.status(400).json({ error: "La duración debe ser de 1 o 2 horas." });

  const filename = `relaxscape-${Date.now()}-${hours}h.mp4`;
  const out = path.join(VIDEO_DIR, filename);
  const seconds = hours * 3600;

  try {
    await runFfmpeg([
      "-y",
      "-loop", "1", "-i", imagePath,
      "-stream_loop", "-1", "-i", musicPath,
      "-t", String(seconds),
      "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
      "-c:a", "aac", "-b:a", "160k", "-shortest",
      out
    ]);
    res.json({ url: `/media/videos/${filename}`, name: filename });
  } catch (e) {
    res.status(500).json({ error: "No se pudo generar el vídeo: " + e.message });
  }
});

async function generateDaily() {
  const images = listFiles(IMAGE_DIR, "/media/images");
  const music = listFiles(MUSIC_DIR, "/media/music");
  if (!images.length || !music.length) return console.log("Daily render omitido: faltan imagen o música.");

  const imagePath = path.join(IMAGE_DIR, images[0].name);
  const musicPath = path.join(MUSIC_DIR, music[0].name);
  const filename = `daily-${new Date().toISOString().slice(0,10)}.mp4`;
  const out = path.join(VIDEO_DIR, filename);

  try {
    await runFfmpeg([
      "-y", "-loop", "1", "-i", imagePath,
      "-stream_loop", "-1", "-i", musicPath,
      "-t", "3600",
      "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
      "-c:a", "aac", "-b:a", "160k", "-shortest", out
    ]);
    console.log("Daily video creado:", filename);
  } catch (e) {
    console.error("Daily render error:", e.message);
  }
}

const hour = Number(process.env.DAILY_VIDEO_HOUR || 7);
cron.schedule(`0 ${hour} * * *`, generateDaily);

app.get("*splat", (_, res) => res.sendFile(path.join(PUBLIC, "index.html")));

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`RelaxScape activo en http://localhost:${port}`));