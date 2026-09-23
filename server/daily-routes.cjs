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
  // Audio original de larga duración inspirado en el lenguaje general de Musicoterapia:
  // pads cálidos, drones muy suaves, resonancias tipo cuenco y textura ambiental.
  // Todo está diseñado para repetirse exactamente cada 5 minutos, sin cortes cada 10 s.
  const sr=44100, dur=Math.min(300,Math.max(60,seconds)), n=sr*dur;
  const channels=2, bytesPerSample=2;
  const b=Buffer.alloc(44+n*channels*bytesPerSample);
  b.write('RIFF',0);b.writeUInt32LE(36+n*channels*bytesPerSample,4);b.write('WAVE',8);
  b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(channels,22);
  b.writeUInt32LE(sr,24);b.writeUInt32LE(sr*channels*bytesPerSample,28);
  b.writeUInt16LE(channels*bytesPerSample,32);b.writeUInt16LE(16,34);
  b.write('data',36);b.writeUInt32LE(n*channels*bytesPerSample,40);

  const s=hashSeed(seed);
  const root=[100,110,120,140,160,180][s%6];
  const chord=[root,root*1.2,root*1.5,root*2];
  const phases=chord.map((_,i)=>((s+i*97)%1000)/1000*Math.PI*2);
  const ambience=[
    [0.0025,7.5],[0.0020,10],[0.0017,12],[0.0014,15],[0.0011,20]
  ];

  for(let i=0;i<n;i++){
    const t=i/sr;
    let l=0,r=0;

    // Pad armónico muy lento: no es una melodía, sino una cama continua.
    for(let j=0;j<chord.length;j++){
      const f=chord[j];
      const swell=.72+.28*Math.sin(2*Math.PI*t/(60+j*12));
      const tone=Math.sin(2*Math.PI*f*t+phases[j]);
      const harmonic=Math.sin(2*Math.PI*f*0.5*t+phases[j]*.7);
      const level=.010/(j+1)*swell;
      l+=level*tone;
      r+=level*Math.sin(2*Math.PI*f*t+phases[j]+0.035);
      l+=.003/(j+1)*harmonic;
      r+=.003/(j+1)*Math.sin(2*Math.PI*f*0.5*t+phases[j]*.7+0.05);
    }

    // Resonancias muy espaciadas, similares a un ambiente de meditación.
    const pulse=Math.pow(Math.max(0,Math.sin(2*Math.PI*t/19)),12);
    const shimmer=Math.pow(Math.max(0,Math.sin(2*Math.PI*t/37+1.2)),18);
    l+=.0045*pulse*Math.sin(2*Math.PI*root*2.5*t);
    r+=.0045*pulse*Math.sin(2*Math.PI*root*2.5*t+0.04);
    l+=.0025*shimmer*Math.sin(2*Math.PI*root*3.5*t+0.3);
    r+=.0025*shimmer*Math.sin(2*Math.PI*root*3.5*t+0.36);

    // Textura de aire periódica: todos los periodos dividen 300 s, así que el loop es limpio.
    for(const [level,period] of ambience){
      const a=Math.sin(2*Math.PI*t/period+phases[0]);
      const b2=Math.sin(2*Math.PI*t/(period*1.5)+phases[1]);
      l+=level*(a*.65+b2*.35);
      r+=level*(a*.65+b2*.35);
    }

    // Movimiento estéreo extremadamente lento.
    const pan=.5+.5*Math.sin(2*Math.PI*t/73);
    const mid=(l+r)*.5, side=(l-r)*.5;
    l=mid+side*(.55+.45*pan);
    r=mid-side*(.55+.45*(1-pan));

    // Nivel conservador para que el vídeo quede agradable a volumen alto.
    l=Math.max(-.35,Math.min(.35,l));
    r=Math.max(-.35,Math.min(.35,r));
    const pos=44+i*4;
    b.writeInt16LE(Math.round(l*32767),pos);
    b.writeInt16LE(Math.round(r*32767),pos+2);
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
   const segmentSeconds=Math.min(seconds,300);
   writeWav(aud,segmentSeconds,seed);
   // El segmento de audio ahora dura hasta 5 minutos completos. Se repite ese bloque,
   // nunca un bloque de 10 s, y el WAV está construido para cerrar el loop suavemente.
   const segment=path.join(TEMP_DIR,'segment-'+stamp+'.mp4');
   try{
    await ff(['-y','-loop','1','-framerate','10','-i',image,'-i',aud,'-t',String(segmentSeconds),
      '-map','0:v:0','-map','1:a:0',
      '-vf','scale=1920:1080:force_original_aspect_ratio=increase:flags=lanczos,crop=1920:1080,unsharp=5:5:0.35:5:5:0.15,format=yuv420p',
      '-r','10','-c:v','libx264','-preset','ultrafast','-crf','24','-threads','2','-pix_fmt','yuv420p',
      '-c:a','aac','-b:a','160k','-ar','44100','-ac','2','-movflags','+faststart',segment]);
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
