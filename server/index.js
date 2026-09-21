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
    .map(f => ({ name: f, url: `${base}/${encodeURIComponent(f)}` }));
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
  } catch (e) { res.status(500).json({ error: e.message }); }
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

function geminiHeaders(key) {
  return { "Content-Type": "application/json", "x-goog-api-key": key };
}

async function waitForVeo(operationName, key) {
  const deadline = Date.now() + 8 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 7000));
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/${operationName}`, { headers: { "x-goog-api-key": key } });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.message || "Error consultando Veo.");
    if (data.done) {
      if (data.error) throw new Error(data.error.message || "Veo no pudo generar el vídeo.");
      const uri = data.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
      if (!uri) throw new Error("Veo terminó pero no devolvió el vídeo.");
      return uri;
    }
  }
  throw new Error("La generación de vídeo está tardando demasiado. Inténtalo de nuevo.");
}

app.post("/api/generate-ai-video", async (req, res) => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(400).json({ error: "Añade GEMINI_API_KEY en Render para activar Veo y Lyria." });
  const prompt = req.body.prompt || "A peaceful cinematic landscape, slow camera movement, relaxing atmosphere, no people, no text.";
  const aspectRatio = req.body.aspectRatio === "9:16" ? "9:16" : "16:9";
  try {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-generate-preview:predictLongRunning", {
      method: "POST",
      headers: geminiHeaders(key),
      body: JSON.stringify({ instances: [{ prompt }], parameters: { aspectRatio, numberOfVideos: 1, resolution: "720p" } })
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data.error?.message || "No se pudo iniciar Veo." });
    if (!data.name) return res.status(500).json({ error: "Veo no devolvió una operación." });
    const videoUri = await waitForVeo(data.name, key);
    const videoResponse = await fetch(videoUri, { headers: { "x-goog-api-key": key } });
    if (!videoResponse.ok) throw new Error("No se pudo descargar el vídeo generado.");
    const filename = `ai-video-${Date.now()}.mp4`;
    fs.writeFileSync(path.join(VIDEO_DIR, filename), Buffer.from(await videoResponse.arrayBuffer()));
    res.json({ name: filename, url: `/media/videos/${filename}` });
  } catch (e) { res.status(500).json({ error: e.message }); }
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
      headers: geminiHeaders(key),
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
      "-y","-loop","1","-i",imagePath,"-stream_loop","-1","-i",musicPath,"-t","3600",
      "-vf","scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
      "-c:v","libx264","-preset","veryfast","-crf","23","-c:a","aac","-b:a","160k","-shortest",out
    ]);
    console.log("Daily video creado:", filename);
  } catch (e) { console.error("Daily render error:", e.message); }
}

const hour = Number(process.env.DAILY_VIDEO_HOUR || 7);
cron.schedule(`0 ${hour} * * *`, generateDaily);

app.get("*splat", (_, res) => res.sendFile(path.join(PUBLIC, "index.html")));

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`RelaxScape activo en http://localhost:${port}`));