const path=require("path");
const http=require("http");
const {spawn}=require("child_process");
const express=require("express");

const PORT=Number(process.env.PORT||10000);
const INTERNAL_PORT=PORT+1;
const app=express();
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

app.post("/api/youtube-ai-generate",(req,res)=>{
  const b=req.body||{},url=String(b.url||""),thumb=String(b.thumbnail||"");
  if(!url||!thumb)return res.status(400).json({error:"Falta la referencia de YouTube"});
  const id="ytai-"+Date.now()+"-"+Math.random().toString(36).slice(2,7);
  jobs.set(id,{status:"running",progress:0,stage:"preparando",results:[],error:null});
  res.status(202).json({jobId:id});
  (async()=>{
    const j=jobs.get(id),w=path.join(VIDEO_DIR,id);await fsp.mkdir(w,{recursive:true});
    try{
      const context=["REFERENCIA REAL DE YOUTUBE","URL: "+url,b.title?"Título: "+b.title:"",b.author?"Canal: "+b.author:"",b.category?"Categoría: "+b.category:"",b.description?"Descripción: "+b.description:"",b.keywords?"Palabras clave: "+b.keywords:"","Representa específicamente el contenido de esta referencia con material visual original y relajante.","Conserva sujeto, lugar, actividad, objetos, clima, iluminación y ambiente identificables; no lo conviertas en un paisaje genérico.","No copies personas, logos, grabaciones ni fotogramas."].filter(Boolean).join(". ");
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
