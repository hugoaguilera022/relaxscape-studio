const path=require('path');
const fs=require('fs');
const fsp=fs.promises;
const {spawn}=require('child_process');
module.exports=function registerDailyRoutes(app){
 const ROOT=path.resolve(process.cwd()),VIDEO_DIR=path.join(ROOT,'data/videos'),TEMP_DIR=path.join(ROOT,'data/daily-temp');
 fs.mkdirSync(VIDEO_DIR,{recursive:true});fs.mkdirSync(TEMP_DIR,{recursive:true});const jobs=new Map();
 async function ff(args){const p=(await import('ffmpeg-static')).default;return new Promise((resolve,reject)=>{const x=spawn(p,args,{stdio:['ignore','ignore','pipe']});let e='';x.stderr.on('data',d=>e+=d);x.on('error',reject);x.on('close',c=>c?reject(Error(e.slice(-8000)||`FFmpeg ${c}`)):resolve())})}
 const clean=f=>{try{if(f&&fs.existsSync(f))fs.unlinkSync(f)}catch{}};
 function promptFor(seed){const a=['serene mountain lake at sunrise, mist over water, photorealistic nature, soft golden light, cinematic wide composition, peaceful meditation atmosphere','quiet tropical beach at sunset, calm ocean waves, warm pastel sky, photorealistic landscape, peaceful sleep and relaxation atmosphere','deep green forest with waterfall and river, soft morning fog, photorealistic nature, tranquil meditation atmosphere','alpine lake surrounded by mountains and pine trees, dawn light, photorealistic landscape, peaceful wellness atmosphere','quiet ocean at night, starry sky, moon reflection, photorealistic cinematic landscape, deep blue tones, sleep meditation atmosphere','rainy forest with calm stream, soft mist, photorealistic 4K nature scene, soothing relaxation atmosphere'];let n=0;for(const c of String(seed))n=(n*31+c.charCodeAt(0))>>>0;return a[n%a.length]+', no people, no text, no buildings, no logos, no watermark, realistic photography'}
 async function generateImage(prompt,out){
   const seed=Date.now();
   const urls=[
     `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1280&height=720&seed=${seed}&nologo=true`,
     `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=576&seed=${seed+1}`
   ];
   let last='';
   for(const u of urls){
     try{
       const r=await fetch(u,{signal:AbortSignal.timeout(180000),headers:{'Accept':'image/*'}});
       if(!r.ok){const body=await r.text().catch(()=> '');throw Error(`Image provider ${r.status}${body?`: ${body.slice(0,300)}`:''}`)}
       const b=Buffer.from(await r.arrayBuffer());
       if(b.length<10000)throw Error('invalid image response');
       fs.writeFileSync(out,b);return;
     }catch(e){last=e.message||String(e)}
   }
   throw Error(`No se pudo generar el paisaje IA: ${last}`)
 }
 async function audio(out,seconds,seed){const sr=44100,n=Math.max(sr*8,Math.floor(sr*Math.min(300,seconds))),b=Buffer.alloc(44+n*2);b.write('RIFF',0);b.writeUInt32LE(36+n*2,4);b.write('WAVE',8);b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(sr,24);b.writeUInt32LE(sr*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);let s=0;for(const c of String(seed))s=(s*33+c.charCodeAt(0))>>>0;const f1=110+s%55,f2=164+s%50,f3=220+s%45;for(let i=0;i<n;i++){const t=i/sr,fade=Math.min(1,t/3,(seconds-t)/3),v=(Math.sin(2*Math.PI*f1*t)+.55*Math.sin(2*Math.PI*f2*t)+.35*Math.sin(2*Math.PI*f3*t))*.04*fade;b.writeInt16LE(Math.round(v*32767),44+i*2)}fs.writeFileSync(out,b)}
 async function makeVideo({durationMinutes=60,seed='daily'}){const minutes=Math.max(1,Math.min(1440,Number(durationMinutes)||60)),seconds=Math.max(60,minutes*60),stamp=new Date().toISOString().replace(/[:.]/g,'-'),image=path.join(TEMP_DIR,`daily-${stamp}.jpg`),aud=path.join(TEMP_DIR,`daily-${stamp}.wav`),out=path.join(VIDEO_DIR,`daily-${stamp}.mp4`);try{await generateImage(promptFor(seed),image);await audio(aud,Math.min(seconds,300),seed);await ff(['-y','-loop','1','-i',image,'-stream_loop','-1','-i',aud,'-t',String(seconds),'-vf','scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,format=yuv420p','-r','30','-c:v','libx264','-preset','veryfast','-crf','22','-c:a','aac','-b:a','192k','-shortest',out]);return{url:'/media/videos/'+path.basename(out),name:path.basename(out),durationMinutes:minutes,generatedImage:true,storedInLibrary:false}}finally{clean(image);clean(aud)}}
 app.post('/api/daily-video-now',async(req,res)=>{const id=`daily-${Date.now()}`;jobs.set(id,{status:'running',progress:5,message:'Generando paisaje IA...'});res.json({jobId:id,status:'running'});try{jobs.set(id,{status:'running',progress:20,message:'Creando paisaje IA con referencia Musicoterapia...'});const result=await makeVideo({durationMinutes:req.body?.durationMinutes||60,seed:id});jobs.set(id,{status:'succeeded',progress:100,message:'Vídeo terminado',result})}catch(e){console.error('[Daily AI]',e);jobs.set(id,{status:'failed',error:e.message||String(e)})}});
 app.get('/api/daily-video-status',async(req,res)=>res.json(jobs.get(String(req.query.jobId))||{status:'unknown'}));
 app.post('/api/daily-video-cron',async(req,res)=>{const secret=process.env.DAILY_CRON_SECRET;if(secret&&req.get('x-daily-secret')!==secret)return res.status(401).json({error:'Unauthorized'});try{const result=await makeVideo({durationMinutes:req.body?.durationMinutes||60,seed:new Date().toISOString().slice(0,10)});res.json({ok:true,result})}catch(e){res.status(500).json({ok:false,error:e.message})}});
};
