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
   const x=spawn(p,args,{stdio:['ignore','ignore','pipe']});
   let e='';
   x.stderr.on('data',d=>e+=d);
   x.on('error',reject);
   x.on('close',c=>c?reject(Error(e.slice(-8000)||`FFmpeg ${c}`)):resolve());
  });
 }
 const clean=f=>{try{if(f&&fs.existsSync(f))fs.unlinkSync(f)}catch{}};

 /*
  * GRATUITO: no Gemini, no Hugging Face y no API keys.
  * Usamos fotografías de paisajes disponibles en Unsplash y las combinamos
  * con audio ambiental/musical generado localmente. No se copia ningún vídeo
  * de YouTube ni se descarga contenido de @musicoterapiateam.
  */
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

 async function downloadLandscape(out,seed){
  let n=0;
  for(const c of String(seed)) n=(n*31+c.charCodeAt(0))>>>0;
  const url=LANDSCAPES[n%LANDSCAPES.length];
  const r=await fetch(url,{signal:AbortSignal.timeout(30000)});
  if(!r.ok) throw Error('No se pudo descargar el paisaje gratuito (HTTP '+r.status+').');
  const b=Buffer.from(await r.arrayBuffer());
  if(b.length<10000) throw Error('El paisaje descargado no es válido.');
  fs.writeFileSync(out,b);
  return {provider:'Unsplash',sourceUrl:url};
 }

 function writeWav(out,seconds,seed){
  const sr=44100, n=Math.max(sr*8,Math.floor(sr*Math.min(300,seconds)));
  const b=Buffer.alloc(44+n*2);
  b.write('RIFF',0);b.writeUInt32LE(36+n*2,4);b.write('WAVE',8);
  b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);
  b.writeUInt16LE(1,22);b.writeUInt32LE(sr,24);b.writeUInt32LE(sr*2,28);
  b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);
  let s=0;for(const c of String(seed))s=(s*33+c.charCodeAt(0))>>>0;
  const roots=[110,130.81,146.83,164.81,196,220];
  const root=roots[s%roots.length];
  const notes=[root,root*1.25,root*1.5,root*2];
  for(let i=0;i<n;i++){
   const t=i/sr;
   const fade=Math.min(1,t/4,(seconds-t)/4);
   const pulse=0.5+0.5*Math.sin(2*Math.PI*t/12);
   let v=0;
   for(let j=0;j<notes.length;j++) v+=(0.018/(j+1))*Math.sin(2*Math.PI*notes[j]*t);
   v+=0.012*Math.sin(2*Math.PI*55*t)*pulse;
   v*=Math.max(0,Math.min(1,fade));
   b.writeInt16LE(Math.round(Math.max(-.8,Math.min(.8,v))*32767),44+i*2);
  }
  fs.writeFileSync(out,b);
 }

 async function makeVideo({durationMinutes=60,seed='daily'}){
  const minutes=Math.max(1,Math.min(1440,Number(durationMinutes)||60));
  const seconds=Math.max(60,minutes*60);
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const image=path.join(TEMP_DIR,'daily-'+stamp+'.jpg');
  const aud=path.join(TEMP_DIR,'daily-'+stamp+'.wav');
  const out=path.join(VIDEO_DIR,'daily-'+stamp+'.mp4');
  try{
   const imageInfo=await downloadLandscape(image,seed);
   writeWav(aud,Math.min(seconds,300),seed);
   await ff([
    '-y','-loop','1','-framerate','10','-i',image,
    '-stream_loop','-1','-i',aud,'-t',String(seconds),
    '-map','0:v:0','-map','1:a:0',
    '-vf','scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,format=yuv420p',
    '-r','10','-c:v','libx264','-preset','ultrafast','-crf','22','-threads','2',
    '-pix_fmt','yuv420p','-c:a','aac','-b:a','160k','-ar','44100','-ac','1',
    '-movflags','+faststart',out
   ]);
   return {
    url:'/media/videos/'+path.basename(out),
    name:path.basename(out),
    durationMinutes:minutes,
    generatedImage:true,
    imageProvider:imageInfo.provider,
    reference:'@musicoterapiateam',
    storedInLibrary:false,
    paidApis:false
   };
  }finally{
   clean(image);clean(aud);
  }
 }

 app.post('/api/daily-video-now',async(req,res)=>{
  const id='daily-'+Date.now();
  jobs.set(id,{status:'running',progress:5,message:'Preparando generación gratuita...'});
  res.json({jobId:id,status:'running'});
  try{
   jobs.set(id,{status:'running',progress:30,message:'Descargando paisaje gratuito...'});
   jobs.set(id,{status:'running',progress:55,message:'Creando audio relajante local...'});
   const result=await makeVideo({durationMinutes:req.body?.durationMinutes||60,seed:id});
   jobs.set(id,{status:'succeeded',progress:100,message:'Vídeo terminado',result});
  }catch(e){
   console.error('[Daily free]',e);
   jobs.set(id,{status:'failed',progress:0,error:e.message||String(e)});
  }
 });

 app.get('/api/daily-video-status',async(req,res)=>{
  res.json(jobs.get(String(req.query.jobId))||{status:'unknown'});
 });

 app.post('/api/daily-video-cron',async(req,res)=>{
  const secret=process.env.DAILY_CRON_SECRET;
  if(secret&&req.get('x-daily-secret')!==secret)return res.status(401).json({error:'Unauthorized'});
  try{
   const result=await makeVideo({durationMinutes:req.body?.durationMinutes||60,seed:new Date().toISOString().slice(0,10)});
   res.json({ok:true,result});
  }catch(e){
   res.status(500).json({ok:false,error:e.message});
  }
 });
};
