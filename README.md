# RelaxScape — generador diario de vídeos relajantes

Web responsive para crear vídeos largos de paisajes + música relajante, con vista previa y descarga.

## Qué incluye
- Acceso desde móvil, tablet y ordenador una vez desplegada.
- Biblioteca de imágenes y música con subida de archivos.
- Generación de imágenes de paisajes realistas mediante OpenAI Images si añades `OPENAI_API_KEY`.
- Generación de vídeos de 1 o 2 horas con FFmpeg en el servidor.
- Vista previa en navegador.
- Descarga MP4.
- Generación diaria automática con `node-cron`.
- Interfaz oscura y responsive.

## Requisitos
- Node.js 20+
- FFmpeg se incluye mediante `ffmpeg-static`, por lo que no hace falta instalar FFmpeg manualmente.
- Para generación de imágenes: una API key de OpenAI.

## Ejecutar en local
```bash
npm install
cp .env.example .env
npm start
```
Abre `http://localhost:3000`.

## Despliegue
Para que sea accesible desde cualquier dispositivo, despliega el proyecto en un servidor Node persistente (por ejemplo Render, Railway, Fly.io o una VPS). Un hosting serverless puro no es recomendable para renders de 1–2 horas porque los procesos largos suelen tener límites.

Añade estas variables:
- `PORT`
- `PUBLIC_BASE_URL`
- `OPENAI_API_KEY` (opcional, solo si quieres generar paisajes con IA)
- `DAILY_VIDEO_HOUR` (hora del servidor para el render diario)

## Importante sobre música
La app permite subir y seleccionar pistas de música. No incluye música comercial con copyright. Usa pistas propias o con licencia adecuada.

## Producción
Para un despliegue real con varios usuarios, sustituye las carpetas `data/` por almacenamiento persistente (S3, Cloudflare R2 o Supabase Storage) y una base de datos. Esta versión está pensada como MVP funcional y fácil de desplegar.


## RelaxScape Studio 2.0
La interfaz incluye navegación por Inicio, Paisajes, Música, Programación y Biblioteca, selección rápida de recursos, creación de paisajes con IA, historial y configuración de vídeo diario.

La programación visual se guarda en el navegador; el proceso automático real del servidor sigue usando `DAILY_VIDEO_HOUR`. Para una aplicación multiusuario en producción, conecta la programación a una base de datos y una cola de trabajos.