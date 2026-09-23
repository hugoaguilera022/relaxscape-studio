# Almacenamiento gratuito del OAuth de YouTube

RelaxScape usa Supabase Free para conservar el token OAuth aunque Render reinicie el servicio.

1. Crea un proyecto en Supabase con el plan Free.
2. Abre SQL Editor y ejecuta `youtube_tokens.sql`.
3. En Project Settings > API copia:
   - Project URL -> `SUPABASE_URL`
   - service_role key -> `SUPABASE_SERVICE_ROLE_KEY`
4. Genera una clave aleatoria larga para `YOUTUBE_TOKEN_ENCRYPTION_KEY`.
5. Añade esas tres variables a Render.
6. Mantén también `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` y `YOUTUBE_REDIRECT_URI`.

El token de Google se cifra con AES-256-GCM antes de guardarse en Supabase. Nunca se guarda el Client Secret ni el token OAuth en GitHub.
