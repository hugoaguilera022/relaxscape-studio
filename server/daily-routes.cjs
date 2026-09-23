const path=require('path');
const fs=require('fs');
const {spawn}=require('child_process');

module.exports=function registerDailyRoutes(app){
 const ROOT=path.resolve(process.cwd());
 const VIDEO_DIR=path.join(ROOT,'data/videos');
 const TEMP_DIR=path.join(ROOT,'data/daily-temp');
 fs.mkdirSync(VIDEO_DIR,{recursive:true});
 fs.mkdirSync(TEMP_DIR,{recursive:true});
 const jobs=new Map();

 async function ff(args){
  const p=(await import('ffmpeg-static')).default;
  return new Promise((resolve,reject)=>{
   const x=spawn(p,args,{stdio:['ignore','ignore','pipe']});let e='';
   x.stderr.on('data',d=>e+=d);x.on('error',reject);
   x.on('close',c=>c?reject(Error(e.slice(-8000)||`FFmpeg ${c}`)):resolve());
  });
 }
 const clean=f=>{try{if(f&&fs.existsSync(f))fs.unlinkSync(f)}catch{}};

 const LANDSCAPES=[
  'https://images.unsplash.com/photo-1500534623283-312aade485b7?auto=format&fit=crop&w=1920&q=90',
  'https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=1920&q=90',
  'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=1920&q=90',
  'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=1920&q=90',
  'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=1920&q=90',
  'https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=1920&q=90',
  'https://images.unsplash.com/photo-1439853949127-fa647821eba0?auto=format&fit=crop&w=1920&q=90',
  'https://images.unsplash.com/photo-1511497584788-876760111969?auto=format&fit=crop&w=1920&q=90'
 ];

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
   const m=text.match(/data:\s*(\[[\s\S]*?\])\s*(?:\n\n|$)/);
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

 async function downloadLandscape(out,seed){
  const url=LANDSCAPES[hashSeed(seed)%LANDSCAPES.length];
  const r=await fetch(url,{signal:AbortSignal.timeout(30000)});
  if(!r.ok)throw Error('No se pudo descargar el paisaje gratuito (HTTP '+r.status+').');
  const b=Buffer.from(await r.arrayBuffer());
  if(b.length<10000)throw Error('El paisaje descargado no es válido.');
  fs.writeFileSync(out,b);
  return {provider:'Unsplash',sourceUrl:url};
 }

 function promptFor(seed){
  const prompts=[
   'Photorealistic cinematic landscape for a long-form relaxation and meditation video: serene mountain lake at sunrise, soft golden mist, calm water reflections, peaceful natural atmosphere, wide 16:9 composition, no people, no buildings, no text, no logos, original scene',
   'Photorealistic cinematic landscape for sleep and relaxation: quiet tropical beach at sunset, gentle ocean waves, pastel sky, soft warm light, wide 16:9 composition, no people, no buildings, no text, no logos, original scene',
   'Photorealistic cinematic nature landscape: deep green forest with a peaceful waterfall and river, soft morning fog, tranquil meditation atmosphere, wide 16:9 composition, no people, no buildings, no text, no logos, original scene',
   'Photorealistic cinematic alpine landscape: clear mountain lake, pine forest, distant peaks, dawn light, peaceful wellness atmosphere, wide 16:9 composition, no people, no buildings, no text, no logos, original scene',
   'Photorealistic cinematic night landscape for deep sleep: calm ocean, stars and moon reflection, subtle blue tones, peaceful atmosphere, wide 16:9 composition, no people, no buildings, no text, no logos, original scene',
   'Photorealistic rainy forest landscape for meditation: soft rain, mist, calm stream, lush green vegetation, cinematic natural light, wide 16:9 composition, no people, no buildings, no text, no logos, original scene'
  ];
  return prompts[hashSeed(seed)%prompts.length];
 }

 function writeWav(out,seconds,seed){
  const sr=44100,n=Math.max(sr*8,Math.floor(sr*Math.min(300,seconds)));
  const b=Buffer.alloc(44+n*2);b.write('RIFF',0);b.writeUInt32LE(36+n*2,4);b.write('WAVE',8);
  b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);
  b.writeUInt32LE(sr,24);b.writeUInt32LE(sr*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);
  b.write('data',36);b.writeUInt32LE(n*2,40);
  const s=hashSeed(seed),root=[110,130.81,146.83,164.81,196,220][s%6],notes=[root,root*1.25,root*1.5,root*2];
  for(let i=0;i<n;i++){const t=i/sr,fade=Math.min(1,t/4,(seconds-t)/4),pulse=.5+.5*Math.sin(2*Math.PI*t/12);
   let v=0;for(let j=0;j<notes.length;j++)v+=(.018/(j+1))*Math.sin(2*Math.PI*notes[j]*t);
   v+=.012*Math.sin(2*Math.PI*55*t)*pulse;v*=Math.max(0,Math.min(1,fade));
   b.writeInt16LE(Math.round(Math.max(-.8,Math.min(.8,v))*32767),44+i*2);
  }
  fs.writeFileSync(out,b);
 }

 async function makeVideo({durationMinutes=60,seed='daily'}){
  const minutes=Math.max(1,Math.min(1440,Number(durationMinutes)||60)),seconds=Math.max(60,minutes*60);
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const image=path.join(TEMP_DIR,'daily-'+stamp+'.img'),aud=path.join(TEMP_DIR,'daily-'+stamp+'.wav');
  const out=path.join(VIDEO_DIR,'daily-'+stamp+'.mp4');
  try{
   const prompt=promptFor(seed);
   let imageInfo=await generateFreeAIImage(image,prompt,seed);
   if(!imageInfo)imageInfo=await downloadLandscape(image,seed);
   writeWav(aud,Math.min(seconds,300),seed);
   // Renderizamos solo un segmento corto y después lo repetimos por stream-copy.
   // Así 60 minutos no obligan a FFmpeg a codificar 36.000 fotogramas.
   const segment=path.join(TEMP_DIR,'segment-'+stamp+'.mp4');
   try{
    await ff(['-y','-loop','1','-framerate','10','-i',image,'-stream_loop','-1','-i',aud,'-t','10','-shortest',
      '-map','0:v:0','-map','1:a:0','-vf','scale=1920:1080:force_original_aspect_ratio=increase:flags=lanczos,crop=1920:1080,unsharp=5:5:0.35:5:5:0.15,format=yuv420p',
      '-r','10','-c:v','libx264','-preset','ultrafast','-crf','24','-threads','2','-pix_fmt','yuv420p',
      '-c:a','aac','-b:a','128k','-ar','44100','-ac','1','-movflags','+faststart',segment]);
    await ff(['-y','-stream_loop','-1','-i',segment,'-t',String(seconds),
      '-map','0:v:0','-map','0:a:0','-c','copy','-movflags','+faststart',out]);
   }finally{clean(segment);}
   return {url:'/media/videos/'+path.basename(out),name:path.basename(out),durationMinutes:minutes,
    generatedImage:true,imageProvider:imageInfo.provider,reference:'@musicoterapiateam',storedInLibrary:false,paidApis:false,
    aiImage:imageInfo.provider.includes('FLUX')};
  }finally{clean(image);clean(aud);}
 }

 app.post('/api/daily-video-now',async(req,res)=>{
  const id='daily-'+Date.now();jobs.set(id,{status:'running',progress:5,message:'Preparando generación gratuita...'});res.json({jobId:id,status:'running'});
  try{
   jobs.set(id,{status:'running',progress:25,message:'Generando paisaje IA gratuito...'});
   jobs.set(id,{status:'running',progress:55,message:'Creando audio relajante local...'});
   const result=await makeVideo({durationMinutes:req.body?.durationMinutes||60,seed:id});
   jobs.set(id,{status:'succeeded',progress:100,message:'Vídeo terminado',result});
  }catch(e){console.error('[Daily free]',e);jobs.set(id,{status:'failed',progress:0,error:e.message||String(e)});}
 });
 app.get('/api/daily-video-status',async(req,res)=>res.json(jobs.get(String(req.query.jobId))||{status:'unknown'}));
 app.post('/api/daily-video-cron',async(req,res)=>{
  const secret=process.env.DAILY_CRON_SECRET;if(secret&&req.get('x-daily-secret')!==secret)return res.status(401).json({error:'Unauthorized'});
  try{const result=await makeVideo({durationMinutes:req.body?.durationMinutes||60,seed:new Date().toISOString().slice(0,10)});res.json({ok:true,result});}
  catch(e){res.status(500).json({ok:false,error:e.message});}
 });
};
