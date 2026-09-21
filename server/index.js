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
];

async function ensureBuiltinMusic() {
  for (const track of BUILTIN_MUSIC) {
    const out = path.join(MUSIC_DIR, track.file);
    if (fs.existsSync(out)) continue;
    try {
      await runFfmpeg([
        "-y",
        "-f","lavfi","-i",
        `sine=frequency=${track.f1}:sample_rate=44100:duration=90`,
        "-f","lavfi","-i",
        `sine=frequency=${track.f2}:sample_rate=44100:duration=90`,
        "-f","lavfi","-i",
        `sine=frequency=${track.f3}:sample_rate=44100:duration=90`,
        "-filter_complex",
        "[0:a]volume=0.10[a0];[1:a]volume=0.07[a1];[2:a]volume=0.05[a2];[a0][a1][a2]amix=inputs=3:duration=longest,lowpass=f=1800,aecho=0.8:0.7:900:0.18,afade=t=in:st=0:d=8,afade=t=out:st=82:d=8,volume=0.8[out]",
        "-map","[out]","-c:a","libmp3lame","-b:a","128k",out
      ]);
    } catch (e) {
      console.error("No se pudo crear música integrada:", track.file, e.message);
    }
  }
}

function listFiles(dir, base) {
  return fs.readdirSync(dir)
    .filter(f => !f.startsWith("."))
    .map(f => ({ name: f, url: `${base}/${encodeURIComponent(f)}` }));
}

app.get("/api/library", async (_, res) => {
  try {
    // La biblioteca debe estar lista antes de pintar la interfaz.
    // Esto evita que la web aparezca vacía justo después de un reinicio de Render.
    await ensureBuiltinMusic();
    res.json({
      images: listFiles(IMAGE_DIR, "/media/images"),
      music: listFiles(MUSIC_DIR, "/media/music"),
      videos: listFiles(VIDEO_DIR, "/media/videos").reverse()
    });
  } catch (e) {
    res.status(500).json({ error: "No se pudo preparar la biblioteca: " + e.message });
  }
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
  const url = "https://gen.pollinations.ai/image/" + encodeURIComponent(prompt) +
    "?width=1920&height=1080&nologo=true&model=flux";
  const r = await fetchWithTimeout(url, { headers: pollinationsHeaders() }, 30000);
  if (!r.ok) throw new Error("Pollinations imagen HTTP " + r.status);
  const type = r.headers.get("content-type") || "";
  if (!type.includes("image")) throw new Error("Pollinations no devolvió una imagen.");
  const filename = "ai-free-option-" + Date.now() + "-" + index + ".jpg";
  fs.writeFileSync(path.join(IMAGE_DIR, filename), Buffer.from(await r.arrayBuffer()));
  return { name: filename, url: "/media/images/" + encodeURIComponent(filename), ai: true, provider: "Pollinations" };
}

async function generatePollinationsMusicFile(prompt, index) {
  const url = "https://gen.pollinations.ai/audio/" + encodeURIComponent(prompt);
  const r = await fetchWithTimeout(url, { headers: pollinationsHeaders() }, 45000);
  if (!r.ok) throw new Error("Pollinations música HTTP " + r.status);
  const type = r.headers.get("content-type") || "";
  if (!type.includes("audio") && !type.includes("mpeg") && !type.includes("octet-stream")) {
    throw new Error("Pollinations no devolvió audio.");
  }
  const filename = "ai-free-music-" + Date.now() + "-" + index + ".mp3";
  fs.writeFileSync(path.join(MUSIC_DIR, filename), Buffer.from(await r.arrayBuffer()));
  return { name: filename, url: "/media/music/" + encodeURIComponent(filename), ai: true, provider: "Pollinations" };
}


app.post("/api/ai-options", async (req, res) => {
  const requestedTheme = String(req.body?.theme || "").trim().slice(0, 160);
  const theme = requestedTheme || "relaxing nature";

  // Proveedor principal: Pollinations, pensado para cubrir imágenes y audio con muchos modelos.
  // Gemini/Lyria ya NO son necesarios para esta sección.
  const imagePrompts = [
    `Ultra-realistic cinematic 16:9 relaxing landscape about ${theme}: majestic mountains, calm lake, soft sunrise, natural light, no people, no buildings, no text, premium photography.`,
    `Ultra-realistic cinematic 16:9 relaxing landscape about ${theme}: peaceful tropical coast, calm turquoise ocean, golden sunset, gentle waves, no people, no buildings, no text, premium photography.`,
    `Ultra-realistic cinematic 16:9 relaxing landscape about ${theme}: misty forest, lush green trees, subtle volumetric light, peaceful atmosphere, no people, no buildings, no text, premium photography.`,
    `Ultra-realistic cinematic 16:9 relaxing landscape about ${theme}: moonlit valley, still water, stars, deep blue tones, tranquil atmosphere, no people, no buildings, no text, premium photography.`
  ];
  const musicPrompts = [
    `Instrumental ambient relaxation music inspired by ${theme}, soft piano and warm pads, slow, peaceful, spacious, no vocals, no aggressive drums.`,
    `Deep sleep ambient music inspired by ${theme}, very soft pads, sparse piano, slow evolving texture, no vocals, no beat, calming.`,
    `Meditation music inspired by ${theme}, gentle bells, warm drones, soft piano, spacious, slow, no vocals, unobtrusive.`,
    `Nature relaxation soundtrack inspired by ${theme}, airy pads, delicate piano, subtle organic textures, slow, peaceful, no vocals.`
  ];

  const images = [], music = [], imageErrors = [], musicErrors = [];
  const runBatch = async (items, worker, output, errors) => {
    await Promise.all(items.map(async (prompt, i) => {
      try { output.push(await worker(prompt, i + 1)); }
      catch (e) { errors.push(e.message); }
    }));
  };

  await Promise.all([
    runBatch(imagePrompts, generatePollinationsImageFile, images, imageErrors),
    runBatch(musicPrompts, generatePollinationsMusicFile, music, musicErrors)
  ]);

  if (!images.length && !music.length) {
    const details = [...imageErrors.map(e => "Imagen: " + e), ...musicErrors.map(e => "Música: " + e)];
    return res.status(502).json({
      error: "El proveedor IA gratuito no ha devuelto recursos. " + (details[0] || "Sin detalle."),
      imageErrors,
      musicErrors
    });
  }

  res.json({ images, music, imageErrors, musicErrors, provider: "Pollinations" });
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


const hour = Number(process.env.DAILY_VIDEO_HOUR || 7);
cron.schedule(`0 ${hour} * * *`, generateDaily);

app.get("*splat", (_, res) => res.sendFile(path.join(PUBLIC, "index.html")));

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`RelaxScape activo en http://localhost:${port}`);
  ensureBuiltinMusic()
    .then(() => console.log("Biblioteca musical integrada lista."))
    .catch(e => console.error("Error preparando la música integrada:", e.message));
});