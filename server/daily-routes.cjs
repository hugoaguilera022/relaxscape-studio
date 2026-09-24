const path=require('path');
const fs=require('fs');
const {spawn}=require('child_process');
const sharp=require('sharp');

module.exports=function registerDailyRoutes(app){
 const ROOT=path.resolve(process.cwd());
 const VIDEO_DIR=path.join(ROOT,'data/videos');
 const TEMP_DIR=path.join(ROOT,'data/daily-temp');
 fs.mkdirSync(VIDEO_DIR,{recursive:true});
 fs.mkdirSync(TEMP_DIR,{recursive:true});
 const jobs=new Map();
 const trendCache={at:0,profiles:null,topVideos:[]};

 function classifyMusicoterapiaTitle(title='') {
  const t=String(title).toLowerCase();
  if (/sleep|sueño|dormir|insomnia|insomnio|deep sleep/.test(t)) return 'sleep';
  if (/study|estudiar|focus|concentr|concentration|work|trabajar/.test(t)) return 'focus';
  if (/meditation|meditacion|meditación|mindfulness|zen|relax|relaj/.test(t)) return 'meditation';
  if (/piano|pian/.test(t)) return 'piano';
  if (/rain|lluvia|rain sounds|white noise/.test(t)) return 'rain';
  if (/spa|massage|masaje|healing|sanación|sanacion/.test(t)) return 'spa';
  return 'relax';
}

async function refreshMusicoterapiaTrends(){
  const key=process.env.YOUTUBE_API_KEY;
  if(!key || Date.now()-trendCache.at<6*60*60*1000)return trendCache.profiles;
  try{
   const channelRes=await fetch('https://www.googleapis.com/youtube/v3/channels?part=contentDetails&forHandle=%40musicoterapiateam&key='+encodeURIComponent(key),{signal:AbortSignal.timeout(15000)});
   if(!channelRes.ok)throw Error('YouTube channels HTTP '+channelRes.status);
   const channel=await channelRes.json();
   const uploads=channel?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
   if(!uploads)throw Error('No se encontró la playlist de vídeos de Musicoterapia.');
   const listRes=await fetch('https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=50&playlistId='+encodeURIComponent(uploads)+'&key='+encodeURIComponent(key),{signal:AbortSignal.timeout(15000)});
   if(!listRes.ok)throw Error('YouTube playlistItems HTTP '+listRes.status);
   const list=await listRes.json();
   const ids=(list.items||[]).map(x=>x.contentDetails?.videoId).filter(Boolean);
   if(!ids.length)throw Error('No se encontraron vídeos de Musicoterapia.');
   const videoRes=await fetch('https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id='+ids.join(',')+'&key='+encodeURIComponent(key),{signal:AbortSignal.timeout(15000)});
   if(!videoRes.ok)throw Error('YouTube videos HTTP '+videoRes.status);
   const data=await videoRes.json();
   const top=(data.items||[]).map(v=>({
    id:v.id,title:v.snippet?.title||'',views:Number(v.statistics?.viewCount||0),
    duration:v.contentDetails?.duration||'',profile:classifyMusicoterapiaTitle(v.snippet?.title||'')
   })).sort((a,b)=>b.views-a.views).slice(0,12);
   const totals=new Map();
   for(const v of top)totals.set(v.profile,(totals.get(v.profile)||0)+Math.max(1,v.views));
   const profiles=[];
   for(const [keyName,weight] of totals.entries())profiles.push({key:keyName,weight});
   profiles.sort((a,b)=>b.weight-a.weight);
   trendCache.at=Date.now();trendCache.profiles=profiles;trendCache.topVideos=top;
   console.log('[Musicoterapia trends]',top.map(v=>v.views+' · '+v.profile+' · '+v.title).join(' | '));
   return profiles;
  }catch(e){
   console.warn('[Musicoterapia trends] fallback:',e.message||e);
   trendCache.at=Date.now();
   trendCache.profiles=null;
   return null;
  }
 }

 function pickWeightedProfile(seed,profiles){
  if(!Array.isArray(profiles)||!profiles.length)return null;
  const total=profiles.reduce((n,p)=>n+Math.max(1,p.weight),0);
  let x=hashSeed(seed)%total;
  for(const p of profiles){x-=Math.max(1,p.weight);if(x<0)return p.key;}
  return profiles[0].key;
 }

 async function ff(args){
  const p=(await import('ffmpeg-static')).default;
  return new Promise((resolve,reject)=>{
   const x=spawn(p,args,{stdio:['ignore','ignore','pipe']});let e='';
   x.stderr.on('data',d=>e+=d);x.on('error',reject);
   x.on('close',c=>c?reject(Error(e.slice(-8000)||`FFmpeg ${c}`)):resolve());
  });
 }
 const clean=f=>{try{if(f&&fs.existsSync(f))fs.unlinkSync(f)}catch{}};

 function hashSeed(seed){let n=0;for(const c of String(seed))n=(n*31+c.charCodeAt(0))>>>0;return n;}

 /*
  * Generador IA gratuito mediante el Space público de FLUX.1-schnell.
  * No usa Gemini, Pexels ni una API de pago. HF Spaces expone una API Gradio
  * pública y el Space oficial de FLUX.1-schnell ejecuta el modelo en ZeroGPU.
  * Si el Space está ocupado o sin cuota, hacemos fallback a Unsplash.
  */
 async function generateFreeAIImage(out,prompt,seed){
  const base='https://black-forest-labs-flux-1-schnell.hf.space';
  const payload={data:[prompt,hashSeed(seed),true,1024,576,4]};
  let submit;
  try{
   submit=await fetch(base+'/gradio_api/call/infer',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(payload),signal:AbortSignal.timeout(12000)
   });
  }catch(e){return null;}
  if(!submit.ok)return null;
  const submitted=await submit.json().catch(()=>null);
  const eventId=submitted?.event_id;
  if(!eventId)return null;

  try{
   const stream=await fetch(base+'/gradio_api/call/infer/'+eventId,{signal:AbortSignal.timeout(30000)});
   if(!stream.ok)return null;
   const text=await stream.text();
    const m=text.match(/data:\s*(\[[\s\S]*?\])\s*(?:\r?\n|$)/);
   if(!m)return null;
   const data=JSON.parse(m[1]);
   const file=data?.[0];
   const url=file?.url || (file?.path ? base+'/file='+file.path : null);
   if(!url)return null;
   const img=await fetch(url,{signal:AbortSignal.timeout(60000)});
   if(!img.ok)return null;
   const b=Buffer.from(await img.arrayBuffer());
   if(b.length<10000)return null;
   fs.writeFileSync(out,b);
   return {provider:'Hugging Face Spaces · FLUX.1-schnell',sourceUrl:url};
  }catch(e){return null;}
 }

 async function generateAceStep(out,seed,seconds,onProgress){ return generateBlueprintMusic(out,{music:'original premium relaxing ambient music, soft piano, warm pads, slow evolving harmony, spacious reverb, no vocals, no nature sounds',subject:'deep relaxation'},seed,seconds,onProgress); }

 async function getMusicoterapiaReference(seed){
  await refreshMusicoterapiaTrends();
  const top=trendCache.topVideos||[];
  if(!top.length)return null;
  const idx=hashSeed(seed)%Math.min(top.length,8);
  const v=top[idx];
  return {...v,url:"https://www.youtube.com/watch?v="+v.id};
 }

 async function analyzeReferenceForDaily(ref){
  if(!ref?.url)return null;
  try{
   const baseUrl='http://127.0.0.1:'+String(process.env.PORT||3000);
   const rr=await fetch(baseUrl+'/api/youtube-ai-analyze',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({url:ref.url}),signal:AbortSignal.timeout(180000)
   });
   if(!rr.ok)return null;
   return await rr.json();
  }catch(e){
   console.warn('[Daily reference analysis]',e.message||e);
   return null;
  }
 }


 function referenceBlueprintFromText(title='',analysis='',profileKey='relax'){
  const t=(String(title)+' '+String(analysis)).toLowerCase();
  const profiles={
   sleep:{key:'sleep',subject:'deep sleep and nighttime calm',music:'original deep sleep ambient music, very soft piano, warm sustained pads, slow harmonic movement, spacious reverb, no vocals, no nature sounds'},
   focus:{key:'focus',subject:'deep focus and concentration',music:'original focus ambient music, soft piano motifs, warm pads, subtle pulse, steady slow evolution, no vocals, no nature sounds'},
   meditation:{key:'meditation',subject:'meditation and inner calm',music:'original meditation ambient music, delicate piano, warm pads, long sustained tones, very slow evolution, no vocals, no nature sounds'},
   piano:{key:'piano',subject:'intimate piano relaxation',music:'original relaxing piano ambient music, felt piano, warm pads, spacious reverb, slow expressive phrasing, no vocals, no nature sounds'},
   rain:{key:'rain',subject:'cozy rain-inspired relaxation atmosphere',music:'original calm ambient music, soft piano, warm pads, gentle repetitive rhythm, no vocals, no recorded nature sounds'},
   spa:{key:'spa',subject:'premium spa and wellness atmosphere',music:'original spa ambient music, soft piano, warm pads, airy textures, slow evolution, no vocals, no nature sounds'},
   relax:{key:'relax',subject:'deep relaxation and emotional calm',music:'original premium relaxing ambient music, soft piano, warm pads, slow evolving harmony, spacious reverb, no vocals, no nature sounds'}
  };
  const base=profiles[profileKey]||profiles.relax;
  const scenes=[
   'Opening composition that establishes the main subject, setting and emotional tone described by the reference analysis.',
   'A second composition focused on the most recognizable visual element, activity or object from the reference, with slow cinematic movement.',
   'A closer, more immersive variation of the reference subject, emphasizing texture, light, depth and atmosphere.',
   'A wider or alternative composition of the same subject and mood, changing framing and visual rhythm without becoming generic.',
   'A calm transitional composition that preserves the reference identity while introducing subtle new visual details.',
   'A final serene composition that gradually simplifies the visual movement and sustains the relaxing mood.'
  ];
  const context=String(analysis||'').trim();
  return {
   ...base,
   title:String(title||''),
   analysis:context,
   scenes:scenes.map(s=>s+' Reference title: '+String(title||'').slice(0,220)+'. Reference analysis: '+context.slice(0,1200))
  };
 }

 async function generateSceneSet(work,blueprint,seed,onProgress){ const files=[]; const scenes=blueprint.scenes||[]; for(let i=0;i<scenes.length;i++){ const prompt='Create completely original cinematic AI artwork for a long-form relaxation music video. '+scenes[i]+'. Theme: '+blueprint.subject+'. Follow the reference subject, setting and visual identity instead of forcing a landscape. Premium wellness aesthetic, cinematic depth, soft blue teal and violet light where appropriate, elegant gradients, subtle luminous particles and dreamy atmosphere. The visual subject may be an interior, person-free activity, object, abstract space, architecture, night scene, underwater-inspired scene or landscape depending on the reference. Never use logos, copied frames, recognizable copyrighted imagery or text. 16:9 premium streaming quality.'; const out=path.join(work,'scene-'+i+'.jpg'); const ok=await generateFreeAIImage(out,prompt,String(seed)+'-scene-'+i); if(ok&&fs.existsSync(out)&&fs.statSync(out).size>10000)files.push(out); if(typeof onProgress==='function')onProgress(22+Math.round((i+1)/scenes.length*18),'Creando arte IA '+(i+1)+'/'+scenes.length+' · '+blueprint.subject+'…'); } return files; }

 function musicPromptForBlueprint(blueprint) {
  return blueprint?.music || 'original premium relaxing ambient music, soft piano and warm pads, slow evolution, no vocals, no nature sounds';
}

async function generateBlueprintMusic(out,blueprint,seed,seconds,onProgress){
  const duration=Math.min(600,Math.max(120,seconds));
  const base='https://ace-step-v1-5.hf.space';
  const caption=musicPromptForBlueprint(blueprint,hashSeed(seed)%1000);
  let submit;
  try{
   submit=await fetch(base+'/v1/music/generate',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({caption,lyrics:'[Instrumental]',thinking:true,instrumental:true,audio_duration:duration,audio_format:'mp3',model:'acestep-v15-turbo',inference_steps:8,batch_size:1,use_random_seed:true}),
    signal:AbortSignal.timeout(30000)
   });
  }catch{return null}
  if(!submit.ok)return null;
  const job=await submit.json().catch(()=>null),jobId=job?.job_id;if(!jobId)return null;
  const deadline=Date.now()+Math.max(360000,duration*1800);
  while(Date.now()<deadline){
   try{
    const rr=await fetch(base+'/v1/jobs/'+encodeURIComponent(jobId),{signal:AbortSignal.timeout(30000)});
    if(!rr.ok)return null;
    const j=await rr.json().catch(()=>null);
    if(j?.status==='failed')return null;
    if(j?.status==='succeeded'){
     const rp=j.result||{},ap=rp.first_audio_path||(Array.isArray(rp.audio_paths)?rp.audio_paths[0]:null);
     if(!ap)return null;
     const u=ap.startsWith('http')?ap:(base+'/v1/audio?path='+encodeURIComponent(ap));
     const src=await fetch(u,{signal:AbortSignal.timeout(120000)});if(!src.ok)return null;
     const tmp=path.join(TEMP_DIR,'blue-music-'+Date.now()+'.mp3');fs.writeFileSync(tmp,Buffer.from(await src.arrayBuffer()));
     try{await ff(['-y','-i',tmp,'-vn','-ac','2','-ar','44100','-c:a','pcm_s16le',out]);}finally{clean(tmp)}
     return {provider:'ACE-Step 1.5 · original composition',prompt:caption};
    }
    if(typeof onProgress==='function'){
     const elapsed=Math.max(0,Date.now()-(deadline-Math.max(360000,duration*1800)));
     const total=Math.max(1,Math.max(360000,duration*1800));
     onProgress(40+Math.min(35,Math.round(elapsed/total*35)),'Creando música original IA…');
    }
    await new Promise(r=>setTimeout(r,5000));
   }catch{return null}
  }
  return null;
 }


 async function makeVideo({durationMinutes=60,seed='daily',youtubeMode=false,onProgress,referenceUrl=null}){
  const minutes=Math.max(1,Math.min(1440,Number(durationMinutes)||60)),seconds=Math.max(60,minutes*60);
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const work=path.join(TEMP_DIR,'daily-work-'+stamp);
  const out=path.join(VIDEO_DIR,'daily-'+stamp+'.mp4');
  fs.mkdirSync(work,{recursive:true});
  try{
   const progress=(p,m)=>{if(typeof onProgress==='function')onProgress(p,m)};
   let ref=null,analysis=null;
   if(youtubeMode){
    progress(5,'Buscando una referencia real de Musicoterapia…');
    ref=referenceUrl?{url:referenceUrl,id:(String(referenceUrl).match(/[?&]v=([^&]+)/)||[])[1]||'',title:''}:await getMusicoterapiaReference(seed);
    if(ref)progress(10,'Referencia seleccionada: '+(ref.title||'vídeo del canal')+'…');
    analysis=await analyzeReferenceForDaily(ref);
   }
   const profileKey=ref?.profile||classifyMusicoterapiaTitle(ref?.title||'');
   const blueprint=referenceBlueprintFromText(ref?.title||'',analysis?.videoAnalysis||'',profileKey);
   if(analysis?.audioAnalysis)blueprint.analysis+=' Audio: '+analysis.audioAnalysis.slice(-900);
   progress(18,youtubeMode?'Analizando estilo, escenas y ritmo de la referencia…':'Preparando concepto audiovisual…');
   const scenes=await generateSceneSet(work,blueprint,seed,progress);
   if(!scenes.length)throw Error('No se pudieron crear escenas visuales.');
   progress(40,'Escenas originales preparadas ('+scenes.length+').');
   const audioSegments=[];
   // Para Programar ahora usamos una única generación musical corta y la repetimos.
   // Así evitamos bloquear la generación durante horas en vídeos largos.
   const segmentSeconds=Math.min(120,Math.max(60,seconds));
   const aud=path.join(work,'music-0.wav');
   progress(42,'Generando música de Musicoterapia…');
   const info=await generateBlueprintMusic(aud,blueprint,String(seed)+'-music-0',segmentSeconds,(p,m)=>progress(42+Math.round(p*.28),m));
   if(info)audioSegments.push(aud);
   else {writeYouTubeWav(aud,segmentSeconds,String(seed)+'-0');audioSegments.push(aud)}
   progress(70,'Música preparada; continuando con el montaje…');
   const audio=path.join(work,'music-long.wav');
   const alist=path.join(work,'audio.txt');
   fs.writeFileSync(alist,audioSegments.map(x=>"file '"+x.replace(/'/g,"'\\''")+"'").join("\n"));
   if(audioSegments.length>1)await ff(['-y','-f','concat','-safe','0','-i',alist,'-c:a','pcm_s16le',audio]);
   else fs.copyFileSync(audioSegments[0],audio);
   progress(76,'Montando escenas con movimiento y transiciones…');
   const sceneSeconds=Math.max(30,Math.ceil(seconds/scenes.length));
   const segs=[];
   for(let i=0;i<scenes.length;i++){
    const seg=path.join(work,'video-'+i+'.mp4');segs.push(seg);
    const zoom=i%2===0?'zoompan=z=min(zoom+0.0008,1.10):x=iw/2-(iw/zoom/2):y=ih/2-(ih/zoom/2):d=1:s=1920x1080:fps=10':'zoompan=z=max(zoom-0.0006,1.0):x=iw/2-(iw/zoom/2):y=ih/2-(ih/zoom/2):d=1:s=1920x1080:fps=10';
    await ff(['-y','-loop','1','-i',scenes[i],'-t',String(sceneSeconds),'-vf',zoom+',format=yuv420p','-r','10','-c:v','libx264','-preset','ultrafast','-crf','24','-pix_fmt','yuv420p',seg]);
   }
   const list=path.join(work,'videos.txt');fs.writeFileSync(list,segs.map(x=>"file '"+x.replace(/'/g,"'\\''")+"'").join("\n"));
   const visual=path.join(work,'visual.mp4');
   await ff(['-y','-f','concat','-safe','0','-i',list,'-c','copy',visual]);
   const audioDuration=seconds;
   await ff(['-y','-stream_loop','-1','-i',visual,'-stream_loop','-1','-i',audio,'-t',String(audioDuration),'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','160k','-ar','44100','-ac','2','-shortest','-movflags','+faststart',out]);
   progress(96,'Comprobando vídeo final…');
   const titleOptions=blueprint.subject==='focus and concentration' ? ['Música Original para Estudiar y Concentrarse · Ambiente Profundo','Concentración Profunda · Música Original para Estudiar','Música Ambiental Original para Trabajo y Estudio'] : blueprint.subject==='deep sleep' ? ['Música Original para Dormir Profundamente · Calma Nocturna','Sueño Profundo · Música Ambiental Original','Música Original para Relajarse y Dormir'] : blueprint.subject==='celtic instrumental relaxation' ? ['Música Celta Original para Relajarse · Flauta y Atmósfera Profunda','Flauta Celta Original · Música para Meditar','Música Instrumental Celta Original para Calmar la Mente'] : ['Música Original para Relajarse · '+blueprint.subject,'Relajación Profunda · Música Ambiental Original','Calma y Meditación · Música Original de RelaxScape'];
   const thumbnailName='thumb-'+path.basename(out,'.mp4')+'.jpg',thumbnail=path.join(VIDEO_DIR,thumbnailName);
   await createYouTubeThumbnail(scenes[0],thumbnail,titleOptions[0],blueprint.key);
   const description='Recreación audiovisual original de RelaxScape Studio inspirada en tendencias de relajación y en la estructura temática de una referencia pública. Todas las imágenes y la música de este vídeo se generan como material nuevo y no reutilizan la grabación, audio, fotogramas, miniatura ni texto del vídeo de referencia.';
   return {url:'/media/videos/'+path.basename(out),name:path.basename(out),durationMinutes:minutes,thumbnailUrl:'/media/videos/'+encodeURIComponent(thumbnailName),generatedImage:true,imageProvider:'Hugging Face · FLUX.1-schnell · escenas originales',referenceVideo:ref?.url||null,referenceTitle:ref?.title||null,referenceAnalysis:analysis?.videoAnalysis||null,sceneCount:scenes.length,musicProvider:'ACE-Step · composición original',theme:blueprint.key,title:titleOptions[0],titleOptions,description,tags:['música relajante','meditación','relajación','estudio','sueño','música original','ambient']};
  }finally{await fs.promises.rm(work,{recursive:true,force:true}).catch(()=>{})}
 }

 app.post('/api/daily-video-now',async(req,res)=>{
  const id='daily-'+Date.now();
  const durationMinutes=Math.max(1,Math.min(1440,Number(req.body?.durationMinutes)||60));
  const estimatedSeconds=Math.max(180,Math.round(180+durationMinutes*2.2));
  const startedAt=Date.now();
  jobs.set(id,{status:'running',progress:2,message:'Preparando generación audiovisual...',startedAt,estimatedSeconds});
  res.json({jobId:id,status:'running',progress:2,message:'Preparando generación audiovisual...',startedAt,estimatedSeconds});
  try{
   const result=await makeVideo({durationMinutes,seed:id,youtubeMode:req.body?.youtubeMode===true,referenceUrl:req.body?.referenceUrl||null,onProgress:(progress,message)=>jobs.set(id,{status:'running',progress,message,startedAt,estimatedSeconds})});
   jobs.set(id,{status:'succeeded',progress:100,message:'Vídeo terminado',startedAt,estimatedSeconds,result});
  }catch(e){console.error('[Daily free]',e);jobs.set(id,{status:'failed',progress:0,error:e.message||String(e),startedAt,estimatedSeconds});}
 });
 app.get('/api/daily-video-status',async(req,res)=>res.json(jobs.get(String(req.query.jobId))||{status:'unknown'}));
 app.post('/api/daily-video-cron',async(req,res)=>{
  const secret=process.env.DAILY_CRON_SECRET;if(secret&&req.get('x-daily-secret')!==secret)return res.status(401).json({error:'Unauthorized'});
  try{const result=await makeVideo({durationMinutes:req.body?.durationMinutes||60,seed:new Date().toISOString().slice(0,10),youtubeMode:true});res.json({ok:true,result});}
  catch(e){res.status(500).json({ok:false,error:e.message});}
 });
};
