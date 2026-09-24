const express=require('express');
const fs=require('fs'),path=require('path'),{spawn}=require('child_process');
const {google}=require('googleapis');
const {InferenceClient}=require('@huggingface/inference');
const ffmpegPath=require('ffmpeg-static');
const app=express(),PORT=process.env.PORT||10000,ROOT=process.cwd(),DATA=path.join(ROOT,'data'),PROJECTS=path.join(DATA,'projects'),VIDEOS=path.join(DATA,'videos');
for(const d of [PROJECTS,VIDEOS])fs.mkdirSync(d,{recursive:true});
app.use(express.json({limit:'5mb'}));app.use(express.static(path.join(ROOT,'public')));app.use('/media',express.static(DATA));
const jobs=new Map();
function run(args){return new Promise((resolve,reject)=>{const p=spawn(ffmpegPath,args);let e='';p.stderr.on('data',d=>e+=d);p.on('error',reject);p.on('close',c=>c?reject(new Error(e.slice(-5000))):resolve())})}
async function gemini(prompt){
 const key=process.env.GEMINI_API_KEY;if(!key)throw Error('Configura GEMINI_API_KEY en Render');
 const model=process.env.GEMINI_TEXT_MODEL||'gemini-2.5-flash';
 const r=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+model+':generateContent',{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:.7}})});
 const d=await r.json();if(!r.ok)throw Error(d.error?.message||'Gemini '+r.status);
 return d.candidates?.[0]?.content?.parts?.map(x=>x.text||'').join('')||'';
}
function asJSON(s){const a=String(s).match(/\{[\s\S]*\}/);if(!a)throw Error('La IA no devolvió JSON');return JSON.parse(a[0])}
async function research(topic){
 let ref='';try{const u='https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch='+encodeURIComponent(topic)+'&srlimit=6&format=json&origin=*';const d=await(await fetch(u)).json();ref=(d.query?.search||[]).map(x=>x.title+': '+x.snippet.replace(/<[^>]+>/g,'')).join('\n')}catch{}
 return asJSON(await gemini('Investiga para un vídeo de YouTube en español el tema: '+topic+'. Usa también estas referencias si son útiles:\n'+ref+'\nNo inventes datos. Devuelve SOLO JSON con summary, facts, chronology, surprising, sources.'));
}
async function tts(text,out){
 if(!process.env.HF_TOKEN)throw Error('Configura HF_TOKEN en Render');
 const c=new InferenceClient(process.env.HF_TOKEN),chunks=String(text).match(/.{1,280}(?:\s|$)/g)||[text],dir=path.dirname(out),files=[];
 for(let i=0;i<chunks.length;i++){const b=await c.textToSpeech({model:process.env.HF_TTS_MODEL||'facebook/mms-tts-spa',inputs:chunks[i].trim()});const f=path.join(dir,'voice-'+i+'.wav');fs.writeFileSync(f,Buffer.from(await b.arrayBuffer()));files.push(f)}
 const list=path.join(dir,'voices.txt');fs.writeFileSync(list,files.map(f=>"file '"+f.replace(/'/g,"'\\''")+"'").join('\n'));await run(['-y','-f','concat','-safe','0','-i',list,'-c:a','pcm_s16le',out]);
}
async function image(prompt,out){
 const u='https://image.pollinations.ai/prompt/'+encodeURIComponent(prompt+', cinematic documentary visual, widescreen 16:9, detailed, realistic, no text, no logo, no watermark')+'?width=1280&height=720&nologo=true';
 const r=await fetch(u,{signal:AbortSignal.timeout(120000)});if(!r.ok)throw Error('Error generando imagen '+r.status);fs.writeFileSync(out,Buffer.from(await r.arrayBuffer()));
}
async function generate(topic,minutes,job){
 const dir=path.join(PROJECTS,job.id);fs.mkdirSync(dir,{recursive:true});job.stage='Investigando';job.progress=8;
 const dossier=await research(topic);fs.writeFileSync(path.join(dir,'research.json'),JSON.stringify(dossier,null,2));
 job.stage='Creando estructura';job.progress=18;
 const outline=asJSON(await gemini('Crea la estructura de un vídeo de '+minutes+' minutos sobre '+topic+'. Debe tener gancho, desarrollo progresivo, ejemplos y cierre. Dossier:'+JSON.stringify(dossier)+'. SOLO JSON: {title,hook,sections:[{heading,points,visual}],ending}'));
 fs.writeFileSync(path.join(dir,'outline.json'),JSON.stringify(outline,null,2));
 job.stage='Escribiendo guion';job.progress=28;
 const plan=asJSON(await gemini('Escribe el guion completo en español para '+minutes+' minutos sobre '+topic+'. Narración natural, informativa y entretenida. Además divide el vídeo en 12-20 escenas con narración e image_prompt. Dossier:'+JSON.stringify(dossier)+' Estructura:'+JSON.stringify(outline)+'. SOLO JSON: {title,description,tags,script,scenes:[{narration,image_prompt}]}'));
 fs.writeFileSync(path.join(dir,'script.json'),JSON.stringify(plan,null,2));
 job.stage='Generando voz';job.progress=38;const audio=path.join(dir,'voice.wav');await tts(plan.script,audio);
 job.stage='Generando visuales';const imgs=[];for(let i=0;i<plan.scenes.length;i++){job.progress=40+Math.round(i/plan.scenes.length*30);job.stage='Visual '+(i+1)+'/'+plan.scenes.length;const f=path.join(dir,'scene-'+i+'.jpg');await image(plan.scenes[i].image_prompt,f);imgs.push(f)}
 job.stage='Montando vídeo';job.progress=76;
 const list=path.join(dir,'images.txt'); const duration=Math.max(2,Math.min(8,Math.ceil((minutes*60)/imgs.length))); const imageList=imgs.map(file=>"file '"+file+"'\nduration "+duration).join("\n")+"\nfile '"+imgs[imgs.length-1]+"'"; fs.writeFileSync(list,imageList);
duration "+duration).join('\n')+'\nfile \''+imgs[imgs.length-1].replace(/'/g,"'\\''")+'\'');
 const visual=path.join(dir,'visual.mp4');await run(['-y','-f','concat','-safe','0','-i',list,'-vf','scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,format=yuv420p','-r','30','-c:v','libx264','-preset','veryfast','-crf','23','-movflags','+faststart',visual]);
 const name='autotube-'+Date.now()+'.mp4',out=path.join(VIDEOS,name);await run(['-y','-i',visual,'-i',audio,'-map','0:v','-map','1:a','-c:v','copy','-c:a','aac','-b:a','160k','-shortest','-movflags','+faststart',out]);
 const meta={title:plan.title,description:plan.description,tags:plan.tags||[],video:'/media/videos/'+name,project:'/media/projects/'+job.id};fs.writeFileSync(path.join(dir,'metadata.json'),JSON.stringify(meta,null,2));
 job.status='done';job.progress=100;job.stage='Listo';job.result=meta;
}
function start(topic,minutes){const id='p-'+Date.now();const job={id,status:'running',progress:0,stage:'Preparando',topic};jobs.set(id,job);generate(topic,minutes,job).catch(e=>{job.status='error';job.error=e.message});return job}
app.get('/health',(q,r)=>r.json({ok:true,service:'autotube-studio',gemini:!!process.env.GEMINI_API_KEY,tts:!!process.env.HF_TOKEN}));
app.get('/api/status',(q,r)=>r.json(jobs.get(q.query.id)||{status:'missing'}));
app.post('/api/generate',(q,r)=>{const topic=String(q.body.topic||'').trim();if(!topic)return r.status(400).json({error:'Indica un tema'});r.json(start(topic,q.body.minutes||7))});
app.post('/api/topic',async(q,r)=>{try{r.json(asJSON(await gemini('Propón 5 temas originales para un canal de YouTube sobre '+(process.env.AUTOMATION_NICHE||'curiosidades, ciencia, historia y misterios')+'. Evita temas demasiado genéricos. SOLO JSON: {topics:[{title,reason}]}')))}catch(e){r.status(500).json({error:e.message})}});
app.get('/api/youtube/auth',(q,r)=>{const o=new google.auth.OAuth2(process.env.YOUTUBE_CLIENT_ID,process.env.YOUTUBE_CLIENT_SECRET,process.env.YOUTUBE_REDIRECT_URI);r.json({url:o.generateAuthUrl({access_type:'offline',prompt:'consent',scope:['https://www.googleapis.com/auth/youtube.upload','https://www.googleapis.com/auth/youtube.readonly']})})});
app.get('/api/youtube/callback',async(q,r)=>{try{const o=new google.auth.OAuth2(process.env.YOUTUBE_CLIENT_ID,process.env.YOUTUBE_CLIENT_SECRET,process.env.YOUTUBE_REDIRECT_URI);const {tokens}=await o.getToken(q.query.code);fs.writeFileSync(path.join(DATA,'youtube-token.json'),JSON.stringify(tokens));r.send('YouTube conectado. Ya puedes volver a AutoTube Studio.')}catch(e){r.status(500).send(e.message)}});
app.post('/api/youtube/upload',async(q,r)=>{try{const meta=q.body.meta,o=new google.auth.OAuth2(process.env.YOUTUBE_CLIENT_ID,process.env.YOUTUBE_CLIENT_SECRET,process.env.YOUTUBE_REDIRECT_URI);const token=process.env.YOUTUBE_REFRESH_TOKEN?{refresh_token:process.env.YOUTUBE_REFRESH_TOKEN}:JSON.parse(fs.readFileSync(path.join(DATA,'youtube-token.json')));o.setCredentials(token);const yt=google.youtube({version:'v3',auth:o});const file=path.join(ROOT,meta.video.replace('/media/',''));const x=await yt.videos.insert({part:'snippet,status',requestBody:{snippet:{title:meta.title,description:meta.description,tags:meta.tags||[],categoryId:'27'},status:{privacyStatus:'private'}},media:{body:fs.createReadStream(file)}});r.json({id:x.data.id,url:'https://www.youtube.com/watch?v='+x.data.id})}catch(e){r.status(500).json({error:e.message})}});
app.post('/api/daily',async(q,r)=>{if(q.headers['x-automation-secret']!==process.env.AUTOMATION_SECRET)return r.status(401).json({error:'No autorizado'});try{const t=asJSON(await gemini('Elige un tema único para un vídeo de YouTube de '+(process.env.AUTOMATION_NICHE||'curiosidades y ciencia')+'. SOLO JSON: {topic}'));r.json(start(t.topic,process.env.AUTOMATION_MINUTES||7))}catch(e){r.status(500).json({error:e.message})}});
app.listen(PORT,()=>console.log('AutoTube Studio activo en '+PORT));