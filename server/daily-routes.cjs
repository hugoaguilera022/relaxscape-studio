const path=require('path');
const fs=require('fs');
const fsp=fs.promises;
const {spawn}=require('child_process');

module.exports=function registerDailyRoutes(app){
  const ROOT=path.resolve(process.cwd());
  const IMAGE_DIR=path.join(ROOT,'data/images');
  const MUSIC_DIR=path.join(ROOT,'data/music');
  const VIDEO_DIR=path.join(ROOT,'data/videos');
  fs.mkdirSync(VIDEO_DIR,{recursive:true});
  const jobs=new Map();
  async function ff(args){
    const p=(await import('ffmpeg-static')).default;
    return new Promise((resolve,reject)=>{
      const x=spawn(p,args,{stdio:['ignore','ignore','pipe']});let err='';
      x.stderr.on('data',d=>err+=d);x.on('error',reject);
      x.on('close',c=>c?reject(Error(err.slice(-8000)||`FFmpeg ${c}`)):resolve());
    });
  }
  function files(dir,rx){return fs.existsSync(dir)?fs.readdirSync(dir).filter(x=>rx.test(x)).map(x=>path.join(dir,x)):[]}
  function pick(a,seed){if(!a.length)return null;let n=0;for(const c of String(seed||'')){n=(n*31+c.charCodeAt(0))>>>0}return a[n%a.length]}
  async function makeVideo({durationMinutes=60,seed='daily'}){
    const images=files(IMAGE_DIR,/\.(jpe?g|png|webp)$/i);
    const music=files(MUSIC_DIR,/\.(mp3|wav|m4a|aac|ogg)$/i);
    if(!images.length)throw Error('No hay imágenes en la biblioteca. Genera primero al menos un paisaje IA.');
    if(!music.length)throw Error('No hay música en la biblioteca. Genera/importa primero una pista.');
    const image=pick(images,seed+'-image'), audio=pick(music,seed+'-audio');
    const stamp=new Date().toISOString().replace(/[:.]/g,'-');
    const out=path.join(VIDEO_DIR,`daily-${stamp}.mp4`);
    const seconds=Math.max(60,Math.min(86400,Number(durationMinutes||60)*60));
    await ff(['-y','-loop','1','-i',image,'-stream_loop','-1','-i',audio,'-t',String(seconds),'-vf','scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,format=yuv420p','-r','30','-c:v','libx264','-preset','veryfast','-crf','22','-c:a','aac','-b:a','192k','-shortest',out]);
    return {url:'/media/videos/'+path.basename(out),name:path.basename(out),durationMinutes:seconds/60,image:path.basename(image),audio:path.basename(audio)};
  }
  app.post('/api/daily-video-now',async(req,res)=>{
    const id=`daily-${Date.now()}`;jobs.set(id,{status:'running',progress:0});
    res.json({jobId:id,status:'running'});
    try{const result=await makeVideo({durationMinutes:req.body?.durationMinutes||60,seed:id});jobs.set(id,{status:'succeeded',progress:100,result});}
    catch(e){jobs.set(id,{status:'failed',error:e.message});}
  });
  app.get('/api/daily-video-status',async(req,res)=>{res.json(jobs.get(String(req.query.jobId))||{status:'unknown'})});
  app.post('/api/daily-video-cron',async(req,res)=>{
    const secret=process.env.DAILY_CRON_SECRET;
    if(secret && req.get('x-daily-secret')!==secret)return res.status(401).json({error:'Unauthorized'});
    const result=await makeVideo({durationMinutes:60,seed:new Date().toISOString().slice(0,10)});
    res.json({ok:true,result});
  });
};
