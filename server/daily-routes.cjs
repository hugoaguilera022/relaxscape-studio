const path=require('path');
const fs=require('fs');
const fsp=fs.promises;
const {spawn}=require('child_process');
const {InferenceClient}=require('@huggingface/inference');

module.exports=function registerDailyRoutes(app){
  const ROOT=path.resolve(process.cwd());
  const VIDEO_DIR=path.join(ROOT,'data/videos');
  fs.mkdirSync(VIDEO_DIR,{recursive:true});
  const jobs=new Map();

  async function ff(args){
    const p=(await import('ffmpeg-static')).default;
    return new Promise((resolve,reject)=>{
      const x=spawn(p,args,{stdio:['ignore','ignore','pipe']});let err='';
      x.stderr.on('data',d=>err+=d);x.on('error',reject);
      x.on('close',c=>c?reject(Error(err.slice(-10000)||`FFmpeg ${c}`)):resolve());
    });
  }

  // PERFIL VISUAL DEL CANAL DE REFERENCIA: se usa como dirección creativa,
  // pero cada imagen se genera desde cero. No se consulta ni reutiliza la biblioteca.
  const VISUAL_PROFILE=`relaxing meditation YouTube visual style, photorealistic cinematic nature landscape, peaceful wide composition, pristine mountain lake, forest, ocean, river or waterfall, soft atmospheric depth, mist, dawn or warm sunset light, tranquil natural colors, subtle realistic reflections, no people, no buildings, no text, no logo, no watermark, premium 16:9 relaxation video frame, serene sleep meditation wellness atmosphere`;
  const SOUND_PROFILE=`deep relaxation meditation music in the style profile of long-form Spanish relaxation and sleep channels: very slow gentle instrumental ambient music, soft piano and warm sustained pads, spacious reverb, peaceful nature atmosphere, no vocals, no lyrics, no aggressive drums, no abrupt transitions, calm and hypnotic, suitable for sleep meditation yoga and stress relief`;

  async function generateFreshImage(prompt,work){
    const token=String(process.env.HF_TOKEN||'').trim();
    if(!token)throw Error('HF_TOKEN no está configurado en Render.');
    const client=new InferenceClient(token);
    const model=process.env.HF_IMAGE_MODEL||'black-forest-labs/FLUX.1-schnell';
    const scenes=['peaceful alpine lake with misty mountains','quiet ocean coastline at dawn','lush forest with a gentle stream','wide mountain valley with soft morning fog','serene waterfall surrounded by deep green forest','calm lake beneath dramatic but peaceful clouds'];
    const scene=scenes[Math.floor(Math.random()*scenes.length)];
    const full=[scene,VISUAL_PROFILE,prompt||'original relaxing landscape inspired by the general visual characteristics of @musicoterapiateam, not copying any specific video'].join(', ');
    const blob=await client.textToImage({model,prompt:full,width:1280,height:720,num_inference_steps:4});
    const out=path.join(work,'daily-ai-landscape.png');
    fs.writeFileSync(out,Buffer.from(await blob.arrayBuffer()));
    return out;
  }

  // Este es el mismo concepto de audio usado por Crear IA: síntesis procedural local
  // con piano/ambiente, pero aquí se genera una pista temporal y nunca se añade a la biblioteca.
  async function generateFreshAudio(work,seed){
    const out=path.join(work,'daily-ai-audio.wav');
    const sr=44100,dur=30,n=sr*dur,buf=Buffer.alloc(44+n*2);
    buf.write('RIFF',0);buf.writeUInt32LE(36+n*2,4);buf.write('WAVE',8);buf.write('fmt ',12);buf.writeUInt32LE(16,16);buf.writeUInt16LE(1,20);buf.writeUInt16LE(1,22);buf.writeUInt32LE(sr,24);buf.writeUInt32LE(sr*2,28);buf.writeUInt16LE(2,32);buf.writeUInt16LE(16,34);buf.write('data',36);buf.writeUInt32LE(n*2,40);
    let h=2166136261>>>0;for(const c of String(seed)){h^=c.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}
    const notes=[220,261.63,329.63,392,329.63,293.66,246.94,196];
    for(let i=0;i<n;i++){
      const t=i/sr, beat=Math.floor(t/3.2), f=notes[(beat+((h>>>3)%notes.length))%notes.length];
      const env=Math.min(1,t/3)*Math.min(1,(dur-t)/4);const tone=Math.sin(2*Math.PI*f*t)*0.11+Math.sin(2*Math.PI*f*2*t)*0.025+Math.sin(2*Math.PI*f*0.5*t)*0.035;
      const v=Math.max(-1,Math.min(1,tone*env));buf.writeInt16LE(Math.round(v*32767),44+i*2);
    }
    fs.writeFileSync(out,buf);return out;
  }

  async function makeVideo({durationMinutes=60,seed='daily'}){
    const work=path.join(VIDEO_DIR,'.daily-'+Date.now());
    await fsp.mkdir(work,{recursive:true});
    try{
      const image=await generateFreshImage(VISUAL_PROFILE,work);
      const audio=await generateFreshAudio(work,seed);
      const stamp=new Date().toISOString().replace(/[:.]/g,'-');
      const out=path.join(VIDEO_DIR,`daily-${stamp}.mp4`);
      const seconds=Math.max(60,Math.min(86400,Number(durationMinutes||60)*60));
      await ff(['-y','-loop','1','-i',image,'-stream_loop','-1','-i',audio,'-t',String(seconds),'-vf','scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,format=yuv420p','-r','30','-c:v','libx264','-preset','veryfast','-crf','22','-c:a','aac','-b:a','192k','-shortest',out]);
      return {url:'/media/videos/'+path.basename(out),name:path.basename(out),durationMinutes:seconds/60,generatedWithAI:true,reference:'@musicoterapiateam',storedInLibrary:false};
    }finally{await fsp.rm(work,{recursive:true,force:true});}
  }

  app.post('/api/daily-video-now',async(req,res)=>{
    const id=`daily-${Date.now()}`;jobs.set(id,{status:'running',progress:5,stage:'generando paisaje IA'});res.json({jobId:id,status:'running'});
    try{jobs.set(id,{status:'running',progress:35,stage:'generando paisaje IA'});const result=await makeVideo({durationMinutes:req.body?.durationMinutes||60,seed:id});jobs.set(id,{status:'succeeded',progress:100,stage:'completado',result});}
    catch(e){console.error('[Daily AI]',e);jobs.set(id,{status:'failed',error:e.message||String(e)});}
  });
  app.get('/api/daily-video-status',async(req,res)=>res.json(jobs.get(String(req.query.jobId))||{status:'unknown'}));
  app.post('/api/daily-video-cron',async(req,res)=>{const secret=process.env.DAILY_CRON_SECRET;if(secret&&req.get('x-daily-secret')!==secret)return res.status(401).json({error:'Unauthorized'});try{const result=await makeVideo({durationMinutes:60,seed:new Date().toISOString().slice(0,10)});res.json({ok:true,result});}catch(e){res.status(500).json({error:e.message||String(e)});}});
};
