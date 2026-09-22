const path=require("path");
const http=require("http");
const {spawn}=require("child_process");
const express=require("express");
const multer=require("multer");

const PORT=Number(process.env.PORT||10000);
const INTERNAL_PORT=PORT+1;
const app=express();
const upload=multer({dest:path.join(process.cwd(),"data/youtube-uploads"),limits:{fileSize:300*1024*1024}});
const ROOT=path.resolve(process.cwd());
const VIDEO_DIR=path.join(ROOT,"data/videos");
const MUSIC_DIR=path.join(ROOT,"data/music");
const fs=require("fs");
const fsp=fs.promises;

for(const d of [VIDEO_DIR,MUSIC_DIR]) fs.mkdirSync(d,{recursive:true});

function safe(x){return String(x||"").replace(/[^a-zA-Z0-9._-]/g,"_")}
function hash(s){let h=2166136261>>>0;for(const c of String(s)){h^=c.charCodeAt(0);h=Math.imul(h,16777619)>>>0}return h>>>0}
async function ff(a){
  const p=(await import("ffmpeg-static")).default;
  return new Promise((ok,no)=>{
    const x=spawn(p,a,{stdio:["ignore","ignore","pipe"]});let e="";
    x.stderr.on("data",d=>e+=d);x.on("error",no);
    x.on("close",c=>c?no(Error(e.slice(-12000)||"FFmpeg "+c)):ok());
  });
}
async function ext(prompt,img,out,seed){
  if(!/^https?:\/\//i.test(img)) throw Error("La miniatura de YouTube no es accesible para la IA externa");
  const q=new URLSearchParams({
    model:process.env.POLLINATIONS_VIDEO_MODEL||"bytedance/seedance-2.0-fast",
    duration:"5",audio:"false",aspectRatio:"16:9",image:img,
    seed:String(hash(prompt+"|"+seed)%2147483647)
  });
  const h={Accept:"video/mp4"};
  if(process.env.POLLINATIONS_API_KEY) h.Authorization="Bearer "+process.env.POLLINATIONS_API_KEY;
  const u="https://gen.pollinations.ai/video/"+encodeURIComponent(prompt+"; realistic cinematic relaxing video, natural continuous motion, slow camera movement, stable composition, no text, no logos")+"?"+q;
  const c=new AbortController(),t=setTimeout(()=>c.abort(),240000);
  try{
    const r=await fetch(u,{headers:h,signal:c.signal});
    if(!r.ok){const d=await r.text().catch(()=>"" );throw Error("IA externa HTTP "+r.status+(d?" · "+d.slice(0,800):""))}
    const b=Buffer.from(await r.arrayBuffer());
    if(b.length<1000) throw Error("La IA externa devolvió un vídeo vacío");
    await fsp.writeFile(out,b);
  }finally{clearTimeout(t)}
}

const jobs=new Map();

app.use(express.json({limit:"2mb"}));
app.use(express.static(path.join(ROOT,"public")));
app.use("/media/videos",express.static(VIDEO_DIR));
app.use("/media/music",express.static(MUSIC_DIR));


const YTDLP=path.join(ROOT,"data","yt-dlp");
async function ensureYtDlp(){
  if(fs.existsSync(YTDLP)) return YTDLP;
  await fsp.mkdir(path.dirname(YTDLP),{recursive:true});
  const r=await fetch("https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp");
  if(!r.ok) throw Error("No se pudo descargar yt-dlp ("+r.status+")");
  await fsp.writeFile(YTDLP,Buffer.from(await r.arrayBuffer()),{mode:0o755});
  fs.chmodSync(YTDLP,0o755);
  return YTDLP;
}
function runCmd(bin,args,opts={}){
  return new Promise((resolve,reject)=>{
    const p=spawn(bin,args,{stdio:["ignore","pipe","pipe"],...opts});
    let out="",err="";
    p.stdout.on("data",d=>out+=d);p.stderr.on("data",d=>err+=d);
    p.on("error",reject);
    p.on("close",code=>code?reject(Error((err||out).slice(-12000)||("Proceso "+code))):resolve({out,err}));
  });
}
async function youtubeMetaAndSample(url,work){
  const bin=await ensureYtDlp();
  const videoId=(String(url).match(/(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([A-Za-z0-9_-]{11})/)||[])[1];
  const clients=["android_vr","web_embedded","tv_embedded","mweb","web_safari"];
  let info=null, metaError=null;

  // 1) Intento normal con yt-dlp, pero SOLO desde el servidor.
  for(const client of clients){
    try{
      const meta=await runCmd(bin,[
        "--dump-single-json","--skip-download","--no-warnings",
        "--extractor-args","youtube:player_client="+client,url
      ]);
      info=JSON.parse(meta.out);
      if(info?.id) break;
    }catch(e){
      metaError=e;
      console.warn("[YouTube metadata] cliente "+client+" falló:",e.message);
    }
  }

  // 2) Fallback A: Piped. Si YouTube bloquea la IP de Render, consultamos
  // instancias públicas que exponen metadata + URLs de reproducción.
  let streamInfo=null;
  let streamSource="";
  if(!info?.id && videoId){
    const pipedInstances=[
      "https://pipedapi.kavin.rocks",
      "https://pipedapi.leptons.xyz",
      "https://pipedapi.nosebs.ru",
      "https://pipedapi.owo.si",
      "https://pipedapi.ducks.party",
      "https://api.piped.privacy.com.de",
      "https://pipedapi.adminforge.de",
      "https://api.piped.yt"
    ];
    for(const base of pipedInstances){
      console.log("[Piped] probando:",base);
      try{
        const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),8000);
        const rr=await fetch(base+"/streams/"+videoId,{
          headers:{Accept:"application/json","User-Agent":"Mozilla/5.0"},
          signal:ac.signal
        });
        clearTimeout(timer);
        if(!rr.ok) continue;
        const d=await rr.json();
        if(d?.videoId||d?.title){
          console.log("[Piped] respuesta recibida:",base,"streams:",Array.isArray(d.videoStreams)?d.videoStreams.length:0);
          const playable=(d.videoStreams||[])
            .filter(x=>x?.url && /mp4/i.test(String(x.mimeType||"")) && x.videoOnly===false)
            .sort((a,b)=>Number(a.height||9999)-Number(b.height||9999));
          const chosen=playable.find(x=>Number(x.height||0)<=480)||playable[0];
          if(chosen?.url){
            streamInfo={type:"piped",streamUrl:chosen.url,data:d};
            streamSource="Piped";
            info={
              id:videoId,title:d.title||"Vídeo de YouTube",author:d.uploader||d.uploaderName||"",
              uploader:d.uploader||d.uploaderName||"",channel:d.uploader||d.uploaderName||"",
              duration:Number(d.duration||60),thumbnail:d.thumbnailUrl||d.thumbnail||"",
              description:d.description||"",keywords:d.tags||[],tags:d.tags||[]
            };
            console.log("[YouTube] fallback Piped:",base);
            break;
          }
        }
      }catch(e){
        console.warn("[Piped fallback]",base,e.name==="AbortError"?"timeout":e.message);
      }
    }
  }

  console.log("[YouTube] Piped no proporcionó un stream utilizable; pasando a Invidious");
  // 3) Fallback B: API de una instancia pública de Invidious.
  // Invidious publica formatStreams con URLs MP4 cuando la instancia puede
  // obtener una reproducción directa.
  if(!info?.id && videoId){
    const instances=[
      "https://inv.nadeko.net",
      "https://invidious.nerdvpn.de",
      "https://yt.chocolatemoo53.com",
      "https://invidious.tiekoetter.com",
      "https://invidious.f5.si"
    ];
    for(const base of instances){
      console.log("[Invidious] probando:",base);
      try{
        const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),8000);
        const rr=await fetch(base+"/api/v1/videos/"+videoId+"?hl=es",{
          headers:{Accept:"application/json","User-Agent":"Mozilla/5.0"},
          signal:ac.signal
        });
        clearTimeout(timer);
        if(!rr.ok) continue;
        const d=await rr.json();
        if(d?.videoId){
          streamInfo=d;
          info={
            id:d.videoId,title:d.title,author:d.author,uploader:d.author,
            channel:d.author,duration:d.lengthSeconds,thumbnail:d.videoThumbnails?.find(x=>x.quality==="maxres")?.url||d.videoThumbnails?.at(-1)?.url,
            description:d.description,keywords:d.keywords||[],tags:d.keywords||[]
          };
          console.log("[YouTube] fallback Invidious:",base);
          break;
        }
      }catch(e){
        console.warn("[Invidious fallback]",base,e.name==="AbortError"?"timeout":e.message);
      }
    }
  }

  if(!info?.id){
    throw Error("YouTube está bloqueando el acceso desde Render. Se probaron yt-dlp, Piped e Invidious. "+(metaError?.message||""));
  }

  const duration=Math.max(1,Number(info.duration||60));
  const marks=[0,Math.max(0,duration*.25-15),Math.max(0,duration*.5-15),Math.max(0,duration*.75-15)];
  const clips=[];
  let lastError=null;

  // Si Piped/Invidious devolvió una URL de stream, FFmpeg toma solo el fragmento necesario.
  if(streamInfo){
    let streamUrl="";
    if(streamInfo.type==="piped") streamUrl=streamInfo.streamUrl;
    else{
      const formats=(streamInfo.formatStreams||[])
        .filter(x=>x?.url && x.container==="mp4")
        .sort((a,b)=>Number(a.height||9999)-Number(b.height||9999));
      streamUrl=(formats.find(x=>Number(x.height||0)<=480)||formats[0])?.url||"";
    }
    if(!streamUrl) throw Error("La instancia de respaldo encontró el vídeo pero no proporcionó un stream MP4 reproducible.");

    for(let i=0;i<marks.length;i++){
      const startSec=Math.floor(marks[i]);
      const out=path.join(work,"sample-"+i+".mp4");
      try{
        await ff(["-y","-ss",String(startSec),"-i",fmt.url,"-t","15","-c","copy","-movflags","+faststart",out]);
        if(fs.existsSync(out)&&fs.statSync(out).size>5000) clips.push(out);
      }catch(e){lastError=e;console.warn("[YouTube Invidious sample]",i,e.message)}
    }
  }

  // Último intento con yt-dlp para las muestras si el fallback anterior no produjo clips.
  if(!clips.length){
    for(let i=0;i<marks.length;i++){
      const startSec=Math.floor(marks[i]),endSec=Math.min(duration,startSec+15);
      const out=path.join(work,"sample-"+i+".mp4");
      for(const client of clients){
        try{
          if(fs.existsSync(out)) fs.rmSync(out,{force:true});
          await runCmd(bin,[
            "--no-warnings","--no-playlist",
            "--extractor-args","youtube:player_client="+client,
            "-f","worst[ext=mp4]/worst",
            "--download-sections","*"+startSec+"-"+endSec,
            "--force-keyframes-at-cuts","-o",out,url
          ]);
          if(fs.existsSync(out)&&fs.statSync(out).size>5000){clips.push(out);lastError=null;break}
        }catch(e){lastError=e}
      }
    }
  }

  if(!clips.length){
    throw Error("Se encontró el vídeo pero no fue posible obtener muestras reproducibles. "+(lastError?.message||""));
  }
  return {info,duration,clips};
}

async function extractFrame(video,out){
  await ff(["-y","-ss","5","-i",video,"-frames:v","1","-q:v","2",out]);
}
async function analyzeVision(frames,meta){
  const key=process.env.POLLINATIONS_API_KEY;
  if(!key) return "";
  const content=[{type:"text",text:"Analiza estas capturas de un vídeo relajante de YouTube. Describe de forma concreta: paisaje/escena, sujeto principal, movimiento, cámara, iluminación, colores, hora del día, clima, elementos que se repiten y sensación sonora/ambiente visual. No copies personas, logos ni fotogramas. Devuelve una guía breve para crear una obra audiovisual original muy parecida en ambiente y ritmo."}];
  for(const f of frames.slice(0,4)){
    const b=fs.readFileSync(f).toString("base64");
    content.push({type:"image_url",image_url:{url:"data:image/jpeg;base64,"+b}});
  }
  try{
    const rr=await fetch("https://gen.pollinations.ai/v1/chat/completions",{
      method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+key},
      body:JSON.stringify({model:"gemini-search",messages:[{role:"user",content}],max_tokens:900})
    });
    if(!rr.ok)return "";
    const d=await rr.json();
    return d.choices?.[0]?.message?.content||"";
  }catch{return ""}
}
async function analyzeAudio(video){
  try{
    const r=await runCmd((await import("ffmpeg-static")).default,[
      "-hide_banner","-i",video,"-af","volumedetect,astats=metadata=1:reset=1","-f","null","-"
    ]);
    return (r.err||"").slice(-5000);
  }catch{return ""}
}
async function analyzeLocalVideo(video,work,extra={}){
  const frames=[];
  const dur=Math.max(1,Number(extra.duration||60));
  const times=[1,Math.max(1,dur*.25),Math.max(1,dur*.5),Math.max(1,dur*.75)];
  for(let i=0;i<times.length;i++){
    const f=path.join(work,"frame-"+i+".jpg");
    try{await ff(["-y","-ss",String(Math.min(times[i],Math.max(1,dur-1))),"-i",video,"-frames:v","1","-q:v","2",f]);if(fs.existsSync(f))frames.push(f)}catch{}
  }
  const vision=await analyzeVision(frames,extra);
  const audio=await analyzeAudio(video);
  return {title:extra.title||"",author:extra.author||"",duration:dur,thumbnail:extra.thumbnail||"",description:extra.description||"",keywords:extra.keywords||"",videoAnalysis:vision||"Análisis visual realizado sobre capturas reales del vídeo.",audioAnalysis:audio,samples:frames.map(f=>"/media/videos/"+path.basename(work)+"/"+path.basename(f))};
}
app.post("/api/youtube-ai-analyze",async(req,res)=>{
  const url=String(req.body?.url||"");
  if(!url)return res.status(400).json({error:"Falta el enlace de YouTube"});
  const work=path.join(VIDEO_DIR,"analysis-"+Date.now());
  try{
    await fsp.mkdir(work,{recursive:true});
    const x=await youtubeMetaAndSample(url,work);
    const analysis=await analyzeLocalVideo(x.clips[0],work,{title:x.info.title,author:x.info.uploader||x.info.channel,duration:x.duration,thumbnail:x.info.thumbnail,description:x.info.description,keywords:(x.info.tags||[]).join(",")});
    res.json(analysis);
  }catch(e){res.status(500).json({error:e.message||String(e),code:"YOUTUBE_ACCESS_BLOCKED"})}
  finally{setTimeout(()=>fsp.rm(work,{recursive:true,force:true}).catch(()=>{}),600000)}
});

app.post("/api/youtube-ai-analyze-upload",upload.single("video"),async(req,res)=>{
  if(!req.file)return res.status(400).json({error:"No se recibió ningún vídeo"});
  const work=path.join(VIDEO_DIR,"analysis-upload-"+Date.now());
  try{
    await fsp.mkdir(work,{recursive:true});
    const extn=path.extname(req.file.originalname||".mp4")||".mp4";
    const source=path.join(work,"reference"+extn);
    await fsp.rename(req.file.path,source);
    const ffbin=(await import("ffmpeg-static")).default;
    let duration=60;
    try{const p=await runCmd(ffbin,["-hide_banner","-i",source,"-f","null","-"]);const m=String(p.err||"").match(/Duration:\s*(\\d+):(\\d+):(\\d+)/);if(m)duration=Number(m[1])*3600+Number(m[2])*60+Number(m[3])}catch{}
    const a=await analyzeLocalVideo(source,work,{duration});
    a.originalFileName=req.file.originalname||"referencia.mp4";
    a.referenceImage=a.samples?.[0]||"";
    res.json(a);
  }catch(e){res.status(500).json({error:e.message||String(e)})}
  finally{setTimeout(()=>fsp.rm(work,{recursive:true,force:true}).catch(()=>{}),1800000)}
});

app.post("/api/youtube-ai-generate",(req,res)=>{
  const b=req.body||{},url=String(b.url||""),thumb=String(b.referenceImage||b.thumbnail||"");
  if(!url||!thumb)return res.status(400).json({error:"Falta la referencia de YouTube"});
  const id="ytai-"+Date.now()+"-"+Math.random().toString(36).slice(2,7);
  jobs.set(id,{status:"running",progress:0,stage:"preparando",results:[],error:null});
  res.status(202).json({jobId:id});
  (async()=>{
    const j=jobs.get(id),w=path.join(VIDEO_DIR,id);await fsp.mkdir(w,{recursive:true});
    try{
      const context=["ANÁLISIS REAL DE LA REFERENCIA DE YOUTUBE",b.videoAnalysis||"",b.audioAnalysis||"","REFERENCIA REAL DE YOUTUBE","URL: "+url,b.title?"Título: "+b.title:"",b.author?"Canal: "+b.author:"",b.category?"Categoría: "+b.category:"",b.description?"Descripción: "+b.description:"",b.keywords?"Palabras clave: "+b.keywords:"","Representa específicamente el contenido de esta referencia con material visual original y relajante.","Conserva sujeto, lugar, actividad, objetos, clima, iluminación y ambiente identificables; no lo conviertas en un paisaje genérico.","No copies personas, logos, grabaciones ni fotogramas."].filter(Boolean).join(". ");
      const clips=[];
      for(let i=0;i<4;i++){
        j.stage="IA externa · toma "+(i+1)+"/4";j.progress=i*20;
        const f=path.join(w,"c"+i+".mp4");await ext(context,thumb,f,i);clips.push(f);
      }
      const list=path.join(w,"list.txt");
      await fsp.writeFile(list,clips.map(x=>"file '"+x.replace(/'/g,"'\\''")+"'").join("\n"));
      const visual=path.join(w,"visual.mp4");
      await ff(["-y","-f","concat","-safe","0","-i",list,"-c","copy",visual]);
      let music="";
      if(b.music){
        music=path.join(MUSIC_DIR,safe(decodeURIComponent(String(b.music).split("/").pop())));
        if(!fs.existsSync(music))throw Error("No se encontró la música IA");
      }
      const name="relaxscape-youtube-ai-"+Date.now()+".mp4",out=path.join(VIDEO_DIR,name);
      j.stage="mezclando música IA";
      if(music)await ff(["-y","-stream_loop","-1","-i",visual,"-stream_loop","-1","-i",music,"-t","30","-map","0:v","-map","1:a","-c:v","copy","-c:a","aac","-b:a","192k","-ar","48000","-ac","2",out]);
      else await ff(["-y","-stream_loop","-1","-i",visual,"-t","30","-c","copy",out]);
      j.results=[{url:"/media/videos/"+encodeURIComponent(name),name,durationSeconds:30,externalAI:true}];
      j.progress=100;j.stage="completado";j.status="succeeded";
    }catch(e){j.status="failed";j.error=e.message||String(e);console.error("[YouTube AI]",j.error)}
    finally{await fsp.rm(w,{recursive:true,force:true});setTimeout(()=>jobs.delete(id),1800000)}
  })();
});

app.get("/api/youtube-ai-status",(req,res)=>{
  const j=jobs.get(String(req.query.jobId||""));
  if(!j)return res.status(404).json({error:"Generación no encontrada"});
  res.json(j);
});

app.post("/api/youtube-ai-final",async(req,res)=>{
  const b=req.body||{},p=String(b.preview||""),m=String(b.music||""),h=Number(b.durationHours||1);
  if(!p||!Number.isInteger(h)||h<1||h>24)return res.status(400).json({error:"Faltan datos o duración inválida"});
  const pn=safe(decodeURIComponent(p.split("/").pop())),pp=path.join(VIDEO_DIR,pn);
  if(!fs.existsSync(pp))return res.status(404).json({error:"No se encontró el vídeo IA"});
  const w=path.join(VIDEO_DIR,"yt-final-"+Date.now()),seg=path.join(w,"seg.mp4"),name="relaxscape-youtube-final-"+h+"h-"+Date.now()+".mp4",out=path.join(VIDEO_DIR,name);
  await fsp.mkdir(w,{recursive:true});
  try{
    let mp="";
    if(m){mp=path.join(MUSIC_DIR,safe(decodeURIComponent(m.split("/").pop())));if(!fs.existsSync(mp))throw Error("No se encontró la música IA")}
    if(mp)await ff(["-y","-stream_loop","-1","-i",pp,"-stream_loop","-1","-i",mp,"-t","30","-map","0:v","-map","1:a","-c:v","copy","-c:a","aac","-b:a","192k","-ar","48000","-ac","2",seg]);
    else await ff(["-y","-stream_loop","-1","-i",pp,"-t","30","-c","copy",seg]);
    await ff(["-y","-stream_loop","-1","-i",seg,"-t",String(h*3600),"-c","copy",out]);
    res.json({url:"/media/videos/"+encodeURIComponent(name),name,hours:h,externalAI:true});
  }catch(e){res.status(500).json({error:e.message||String(e)})}
  finally{await fsp.rm(w,{recursive:true,force:true})}
});

const child=spawn(process.execPath,[path.join(ROOT,"server/index.js")],{
  env:{...process.env,PORT:String(INTERNAL_PORT)},
  stdio:"inherit"
});
child.on("exit",(code,signal)=>{console.error("[RelaxScape core] exited",code,signal);process.exit(code||1)});

function proxyToCore(req,res){
  const headers={...req.headers,host:"127.0.0.1:"+INTERNAL_PORT};
  delete headers["content-length"];
  const chunks=[];
  req.on("data",c=>chunks.push(c));
  req.on("end",async()=>{
    try{
      const body=chunks.length?Buffer.concat(chunks):undefined;
      const r=await fetch("http://127.0.0.1:"+INTERNAL_PORT+req.originalUrl,{method:req.method,headers,body});
      res.status(r.status);
      r.headers.forEach((v,k)=>{if(k.toLowerCase()!=="transfer-encoding")res.setHeader(k,v)});
      const ab=await r.arrayBuffer();res.end(Buffer.from(ab));
    }catch(e){res.status(502).json({error:"Servidor principal no disponible: "+e.message})}
  });
}
app.use(proxyToCore);

app.listen(PORT,"0.0.0.0",()=>console.log("RelaxScape YouTube AI wrapper activo en http://0.0.0.0:"+PORT));
