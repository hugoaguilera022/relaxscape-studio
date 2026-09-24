# AutoTube Studio — puesta en marcha

## 1. Crear el servicio nuevo en Render

Crea un **Web Service** nuevo conectado a este repositorio y selecciona la rama:

`youtube-automation`

Usa:
- Build: `npm install`
- Start: `npm start`

No uses un Cron Job de Render: la programación diaria está hecha con GitHub Actions para evitar el coste del cron.

## 2. Variables de Render

Añade estas variables secretas:

`GEMINI_API_KEY`
`HF_TOKEN`
`YOUTUBE_CLIENT_ID`
`YOUTUBE_CLIENT_SECRET`
`YOUTUBE_REDIRECT_URI`
`YOUTUBE_REFRESH_TOKEN`
`AUTOMATION_SECRET`

Y estas normales:

`GEMINI_TEXT_MODEL=gemini-3.6-flash`
`HF_TTS_MODEL=facebook/mms-tts-spa`
`AUTOMATION_NICHE=historias sorprendentes, curiosidades y explicaciones visuales de cosas que la mayoría de personas no conoce`
`AUTOMATION_MINUTES=7`

El valor de `YOUTUBE_REDIRECT_URI` debe ser exactamente:

`https://TU-DOMINIO-RENDER/api/youtube/callback`

## 3. Google / YouTube

En Google Cloud:
1. Activa YouTube Data API v3.
2. Crea credenciales OAuth 2.0.
3. Añade la URL anterior como URI de redirección autorizada.
4. Usa el Client ID y Client Secret en Render.

Abre la web y pulsa **Conectar YouTube**.

La primera autorización devuelve el refresh token. Guárdalo como secreto `YOUTUBE_REFRESH_TOKEN` en Render y redeploya.

## 4. Programación gratuita

El workflow `.github/workflows/autotube-daily.yml` se ejecuta diariamente a las **19:05 hora de Madrid** y llama a `POST /api/automation/daily`.

El proceso diario ahora reproduce el flujo de producción: tema → investigación → estructura → guion → narración → recursos visuales 16:9 → subtítulos → miniatura → montaje → YouTube.

Cada proyecto se organiza temporalmente en `data/projects/<id>` con investigación, estructura, guion, voz, subtítulos, recursos, miniatura y metadatos.

## 5. Importante

Render Free tiene filesystem efímero. Por eso el proceso diario genera y publica el vídeo dentro de la misma ejecución y no depende de conservar el MP4 después de terminar.

El repositorio original de RelaxScape queda separado en `main`; esta automatización vive en `youtube-automation`.
