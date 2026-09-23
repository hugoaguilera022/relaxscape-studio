const fs=require("fs"),fsp=fs.promises,path=require("path"),crypto=require("crypto");
module.exports=function(app){
 const root=path.resolve(process.cwd()), tokenFile=process.env.YOUTUBE_TOKEN_FILE||path.join(root,"data/youtube-token.json"), videoDir=path.join(root,"data/videos");
 fs.mkdirSync(path.dirname(tokenFile),{recursive:true});fs.mkdirSync(videoDir,{recursive:true});
 const cfg=()=>({id:process.env.YOUTUBE_CLIENT_ID,secret:process.env.YOUTUBE_CLIENT_SECRET,redirect:process.env.YOUTUBE_REDIRECT_URI});
 const signState=s=>crypto.createHmac("sha256",String(process.env.YOUTUBE_CLIENT_SECRET||"").trim()).update(s).digest("hex");
 const makeState=(kind="yt")=>{const s=kind+":"+crypto.randomBytes(20).toString("hex");return s+"."+signState(s)};
 const validState=s=>{const [raw,sig]=String(s||"").split(".");if(!raw||!sig)return false;const a=Buffer.from(sig),b=Buffer.from(signState(raw));return a.length===b.length&&crypto.timingSafeEqual(a,b)};
 const supabaseKey=()=>String(process.env.SUPABASE_SERVICE_ROLE_KEY||"").replace(/\s+/g,"");
 const cookieSecret=()=>crypto.createHash("sha256").update(String(process.env.YOUTUBE_CLIENT_SECRET||"").trim()).digest();
 const sessionCookie="relaxscape_session";
 const sessionValue=(sub,email="",name="")=>{const raw=Buffer.from(JSON.stringify({sub,email,name})).toString("base64url");const sig=crypto.createHmac("sha256",cookieSecret()).update(raw).digest("base64url");return raw+"."+sig};
 const sessionSub=req=>{try{const h=String(req.headers.cookie||"");const m=h.match(new RegExp("(?:^|;\\s*)"+sessionCookie+"=([^;]+)"));if(!m)return null;const [raw,sig]=decodeURIComponent(m[1]).split(".");if(!raw||!sig)return null;const a=Buffer.from(sig),b=Buffer.from(crypto.createHmac("sha256",cookieSecret()).update(raw).digest("base64url"));if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return null;return JSON.parse(Buffer.from(raw,"base64url").toString("utf8")).sub||null}catch{return null}};
 const setSession=(res,sub,email="",name="")=>res.setHeader("Set-Cookie",sessionCookie+"="+encodeURIComponent(sessionValue(sub,email,name))+"; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000");
 const clearSession=res=>res.setHeader("Set-Cookie",sessionCookie+"=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
 const remoteReady=()=>!!(process.env.SUPABASE_URL&&supabaseKey()&&process.env.YOUTUBE_TOKEN_ENCRYPTION_KEY);
 const localToken=()=>{try{return JSON.parse(fs.readFileSync(tokenFile,"utf8"))}catch{return null}};
 const saveLocal=t=>fs.writeFileSync(tokenFile,JSON.stringify(t,null,2),{mode:0o600});
 const key=()=>crypto.createHash("sha256").update(process.env.YOUTUBE_TOKEN_ENCRYPTION_KEY||"").digest();
 const encrypt=t=>{const iv=crypto.randomBytes(12),c=crypto.createCipheriv("aes-256-gcm",key(),iv),data=Buffer.concat([c.update(JSON.stringify(t),"utf8"),c.final()]);return [iv.toString("base64"),c.getAuthTag().toString("base64"),data.toString("base64")].join(".")};
 const decrypt=s=>{const [iv,tag,data]=String(s).split("."),d=crypto.createDecipheriv("aes-256-gcm",key(),Buffer.from(iv,"base64"));d.setAuthTag(Buffer.from(tag,"base64"));return JSON.parse(Buffer.concat([d.update(Buffer.from(data,"base64")),d.final()]).toString("utf8"))};
 const supa=()=>String(process.env.SUPABASE_URL||"").trim().replace(/\/+$/,"").replace(/\/rest\/v1$/,"")+"/rest/v1/youtube_tokens";
 const token=async(id="default")=>{if(!remoteReady())return localToken();const r=await fetch(supa()+"?id=eq."+encodeURIComponent(id)+"&select=payload",{headers:{apikey:supabaseKey(),Authorization:"Bearer "+supabaseKey()}});if(!r.ok)throw Error("No se pudo leer el almacenamiento seguro");const d=await r.json();return d[0]?.payload?decrypt(d[0].payload):null};
 const save=async(t,id="default")=>{if(!remoteReady())return saveLocal(t);const r=await fetch(supa(),{method:"POST",headers:{apikey:supabaseKey(),Authorization:"Bearer "+supabaseKey(),"Content-Type":"application/json",Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({id:String(id),payload:encrypt(t),updated_at:new Date().toISOString()})});if(!r.ok){const body=await r.text().catch(()=>"");throw Error("No se pudo guardar el token seguro (Supabase "+r.status+")"+(body?": "+body.slice(0,500):""))}};
 const deleteToken=async(id="default")=>{if(!remoteReady()){try{if(fs.existsSync(tokenFile))fs.unlinkSync(tokenFile)}catch{}return}const r=await fetch(supa()+"?id=eq."+encodeURIComponent(id),{method:"DELETE",headers:{apikey:supabaseKey(),Authorization:"Bearer "+supabaseKey()}});if(!r.ok)throw Error("No se pudo eliminar la conexión")};
 const ready=()=>{const c=cfg();return !!(c.id&&c.secret&&c.redirect)};
 async function access(req=null){
  const sid=req?sessionSub(req):null;
  let t=await token(sid||"default");
  // La sesión web y el canal deben pertenecer a la misma cuenta de Google.
  // Si el token de la sesión no aparece en Supabase, usamos el token global
  // únicamente cuando su usuario coincide con la sesión actual.
  if(!t&&sid){
   const fallback=await token("default");
   if(fallback?.user?.id===sid)t=fallback;
  }
  if(!t)return null;
  if(t.access_token&&Date.now()-t.created_at<((t.expires_in||3600)-120)*1000)return t.access_token;
  if(!t.refresh_token)return t.access_token;
  const c=cfg(),r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:c.id,client_secret:c.secret,refresh_token:t.refresh_token,grant_type:"refresh_token"})}),d=await r.json();
  if(!r.ok)throw Error(d.error_description||d.error||"No se pudo renovar YouTube");
  await save({...t,...d,refresh_token:t.refresh_token,created_at:Date.now()},sid||"default");return d.access_token;
 }
 async function channel(req=null){const a=await access(req);if(!a)return null;const r=await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",{headers:{Authorization:"Bearer "+a}}),d=await r.json();if(!r.ok)throw Error(d.error?.message||"YouTube rechazó la conexión");const x=d.items?.[0];return x&&{id:x.id,title:x.snippet?.title,thumbnail:x.snippet?.thumbnails?.default?.url};}
 app.get("/api/auth/status",async(req,res)=>{
  try{
   const h=String(req.headers.cookie||"");
   const m=h.match(new RegExp("(?:^|;\\s*)"+sessionCookie+"=([^;]+)"));
   if(!m)return res.json({authenticated:false});
   const [raw,sig]=decodeURIComponent(m[1]).split(".");
   if(!raw||!sig)return res.json({authenticated:false});
   const expected=crypto.createHmac("sha256",cookieSecret()).update(raw).digest("base64url");
   const x=Buffer.from(sig),y=Buffer.from(expected);
   if(x.length!==y.length||!crypto.timingSafeEqual(x,y))return res.json({authenticated:false});
   const u=JSON.parse(Buffer.from(raw,"base64url").toString("utf8"));
   if(!u.sub)return res.json({authenticated:false});
   res.json({authenticated:true,user:{id:u.sub,email:u.email||"",name:u.name||""},storage:remoteReady()?"supabase":"local"});
  }catch(e){res.json({authenticated:false,error:e.message})}
 });
 app.get("/api/auth/login",(req,res)=>{if(!ready())return res.status(500).send("Configura YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET y YOUTUBE_REDIRECT_URI en Render.");const returning=String(req.query.return||"")==="youtube";const c=cfg(),state=makeState("auth"),u=new URL("https://accounts.google.com/o/oauth2/v2/auth");if(returning)res.setHeader("Set-Cookie","relaxscape_return=youtube; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600");u.searchParams.set("client_id",c.id);u.searchParams.set("redirect_uri",c.redirect);u.searchParams.set("response_type","code");u.searchParams.set("scope","openid email profile https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.upload");u.searchParams.set("access_type","offline");u.searchParams.set("prompt","consent select_account");u.searchParams.set("state",state);res.redirect(u.toString())});
 app.get("/api/auth/callback",async(req,res)=>{try{const state=String(req.query.state||"");if(!validState(state))throw Error("Estado OAuth no válido o caducado");const c=cfg(),r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({code:String(req.query.code||""),client_id:c.id,client_secret:c.secret,redirect_uri:c.redirect,grant_type:"authorization_code"})}),d=await r.json();if(!r.ok)throw Error(d.error_description||d.error||"Autorización rechazada");const ur=await fetch("https://www.googleapis.com/oauth2/v3/userinfo",{headers:{Authorization:"Bearer "+d.access_token}}),u=await ur.json();if(!ur.ok||!u.sub)throw Error("Google no devolvió la identidad de la cuenta");const old=await token(u.sub).catch(()=>null);const account={...old,...d,created_at:Date.now(),user:{id:u.sub,email:u.email||"",name:u.name||""}};await save(account,u.sub);await save(account,"default");setSession(res,u.sub,u.email||"",u.name||"");const rh=String(req.headers.cookie||"");const returning=rh.split(";").some(x=>x.trim().startsWith("relaxscape_return=youtube"));res.setHeader("Set-Cookie",[sessionCookie+"="+encodeURIComponent(sessionValue(u.sub,u.email||"",u.name||""))+"; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000","relaxscape_return=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"]);res.redirect(returning?"/api/youtube/connect":"/?login=connected")}catch(e){res.status(500).send("No se pudo iniciar sesión: "+e.message)}});
 app.post("/api/auth/logout",(req,res)=>{clearSession(res);res.json({ok:true})});
 app.get("/api/youtube/status", async (req,res)=>{
  try {
   if(!ready()) return res.json({configured:false,connected:false});
   const sid=sessionSub(req);
   if(!sid) return res.json({configured:true,connected:false,authenticated:false});
   const ch=await channel(req);
   return res.json({configured:true,connected:!!ch,authenticated:true,channel:ch,storage:remoteReady()?"supabase":"local"});
  } catch(e) {
   return res.json({configured:true,connected:false,error:e.message});
  }
 });
 app.get("/api/youtube/connect",(req,res)=>{
  try{
   if(!ready()) return res.status(500).send("Configura YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET y YOUTUBE_REDIRECT_URI en Render.");
   const sid=sessionSub(req),c=cfg(),kind=sid?"yt":"ytlogin",state=makeState(kind),u=new URL("https://accounts.google.com/o/oauth2/v2/auth");
   u.searchParams.set("client_id",c.id);u.searchParams.set("redirect_uri",c.redirect);u.searchParams.set("response_type","code");
   u.searchParams.set("scope",sid?"https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.upload":"openid email profile https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.upload");u.searchParams.set("access_type","offline");u.searchParams.set("prompt","consent");u.searchParams.set("state",state);
   res.redirect(u.toString());
  }catch(e){res.status(500).send("No se pudo iniciar la conexión con YouTube: "+e.message)}
 });
 app.get("/api/youtube/callback",async(req,res)=>{
  try{
   const state=String(req.query.state||"");
   if(!validState(state)) throw Error("Estado OAuth no válido o caducado");
   const raw=state.split(".")[0],kind=raw.split(":")[0];
   if(kind==="auth"||kind==="ytlogin"){
    const c=cfg(),r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({code:String(req.query.code||""),client_id:c.id,client_secret:c.secret,redirect_uri:c.redirect,grant_type:"authorization_code"})}),d=await r.json();
    if(!r.ok) throw Error(d.error_description||d.error||"Autorización de Google rechazada");
    const ur=await fetch("https://www.googleapis.com/oauth2/v3/userinfo",{headers:{Authorization:"Bearer "+d.access_token}}),u=await ur.json();
    if(!ur.ok||!u.sub) throw Error("Google no devolvió la identidad de la cuenta");
    const old=await token(u.sub).catch(()=>null),account={...old,...d,created_at:Date.now(),user:{id:u.sub,email:u.email||"",name:u.name||""}};
    await save(account,u.sub);await save(account,"default");setSession(res,u.sub,u.email||"",u.name||"");
    return res.redirect(kind==="ytlogin"?"/?youtube=connected":"/?login=connected");
   }
   const sid=sessionSub(req);
   if(!sid) return res.redirect("/api/auth/login?return=youtube");
   const c=cfg(),r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({code:String(req.query.code||""),client_id:c.id,client_secret:c.secret,redirect_uri:c.redirect,grant_type:"authorization_code"})}),d=await r.json();
   if(!r.ok) throw Error(d.error_description||d.error||"Autorización de YouTube rechazada");
   const old=await token(sid).catch(()=>null);
   const account={...old,...d,created_at:Date.now(),user:old?.user||{id:sid}};
   await save(account,sid);
   await save(account,"default");
   res.redirect("/?youtube=connected");
  }catch(e){res.status(500).send("No se pudo vincular YouTube: "+e.message)}
 });
 app.get("/api/user/preferences",async(req,res)=>{try{const sid=sessionSub(req);if(!sid)return res.status(401).json({error:"Inicia sesión"});const t=await token(sid);res.json({preferences:t?.preferences||{}})}catch(e){res.status(500).json({error:e.message})}});
 app.put("/api/user/preferences",async(req,res)=>{try{const sid=sessionSub(req);if(!sid)return res.status(401).json({error:"Inicia sesión"});const t=await token(sid);if(!t)return res.status(401).json({error:"Inicia sesión"});const preferences=(req.body&&typeof req.body.preferences==="object")?req.body.preferences:{};await save({...t,preferences},sid);res.json({ok:true})}catch(e){res.status(500).json({error:e.message})}});
 app.post("/api/youtube/disconnect",async(req,res)=>{try{const sid=sessionSub(req);if(!sid)throw Error("No has iniciado sesión");await deleteToken(sid);if(sid!=="default")await deleteToken("default");res.json({ok:true})}catch(e){res.status(500).json({error:e.message})}});
 async function upload(file,req,meta={}){
  const a=await access(req);if(!a)throw Error("Primero inicia sesión y vincula YouTube");const st=await fsp.stat(file),date=new Date().toLocaleDateString("es-ES",{timeZone:process.env.DAILY_TIMEZONE||"Europe/Madrid"}),title=String(meta.title||"RelaxScape · Naturaleza y relajación · "+date).slice(0,100),description=String(meta.description||"Vídeo original de relajación, naturaleza y sonidos ambientales creado con RelaxScape Studio."),tags=Array.isArray(meta.tags)&&meta.tags.length?meta.tags.slice(0,30).map(String):["relajación","naturaleza","meditación","sleep","relax","ambient"],privacyStatus=["public","private","unlisted"].includes(meta.privacyStatus)?meta.privacyStatus:"public",init=await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",{method:"POST",headers:{Authorization:"Bearer "+a,"Content-Type":"application/json","X-Upload-Content-Length":String(st.size),"X-Upload-Content-Type":"video/mp4"},body:JSON.stringify({snippet:{title,description,tags,categoryId:"22"},status:{privacyStatus,selfDeclaredMadeForKids:false}})});
  const loc=init.headers.get("location");if(!init.ok||!loc){const d=await init.json().catch(()=>({}));throw Error(d.error?.message||"No se pudo iniciar la subida")};
  const r=await fetch(loc,{method:"PUT",headers:{Authorization:"Bearer "+a,"Content-Type":"video/mp4","Content-Length":String(st.size)},body:fs.createReadStream(file),duplex:"half"}),d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error?.message||"Falló la subida");return {id:d.id,url:"https://www.youtube.com/watch?v="+d.id};
 }
 async function startYouTubeGeneration(req,cron=false){
  const sid=cron?null:sessionSub(req),tokenId=sid||"default";
  if(!cron&&!sid)throw Error("Primero inicia sesión en RelaxScape con Google");
  if(!await token(tokenId))throw Error("Primero vincula tu canal de YouTube con Google");
  const port=Number(process.env.PORT||10000);
  const s=await fetch("http://127.0.0.1:"+port+"/api/daily-video-now",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({durationMinutes:Number(req.body?.durationMinutes||60)})});
  const j=await s.json();
  if(!s.ok||!j.jobId)throw Error(j.error||"No se pudo iniciar el vídeo");
  return {jobId:j.jobId,durationMinutes:Number(req.body?.durationMinutes||60)};
}
app.post("/api/youtube/daily-generate",async(req,res)=>{
  try{res.status(202).json({ok:true,result:await startYouTubeGeneration(req)});}
  catch(e){res.status(500).json({ok:false,error:e.message})}
});
app.get("/api/youtube/daily-generate-status",async(req,res)=>{
  try{
    const sid=sessionSub(req);if(!sid)throw Error("Primero inicia sesión en RelaxScape con Google");
    if(!await token(sid))throw Error("Primero vincula tu canal de YouTube con Google");
    const jobId=String(req.query.jobId||"");if(!jobId)throw Error("Falta el trabajo de generación");
    const port=Number(process.env.PORT||10000);
    const q=await (await fetch("http://127.0.0.1:"+port+"/api/daily-video-status?jobId="+encodeURIComponent(jobId))).json();
    if(q.status==="succeeded"&&q.result){
      const file=path.join(videoDir,q.result.name);
      if(!fs.existsSync(file))throw Error("No se encontró el vídeo generado");
      return res.json({status:"succeeded",progress:100,message:"Vídeo terminado",result:{file,name:q.result.name,url:"/media/videos/"+encodeURIComponent(q.result.name),durationMinutes:q.result.durationMinutes,title:q.result.title,titleOptions:q.result.titleOptions,description:q.result.description,tags:q.result.tags,theme:q.result.theme}});
    }
    if(q.status==="failed")return res.status(500).json({status:"failed",error:q.error||"Falló la generación"});
    res.json({status:q.status||"running",progress:q.progress||0,message:q.message||"Generando vídeo…"});
  }catch(e){res.status(500).json({status:"failed",error:e.message})}
});
app.post("/api/youtube/publish-existing",async(req,res)=>{try{const sid=sessionSub(req);if(!sid)throw Error("Primero inicia sesión en RelaxScape");if(!await token(sid))throw Error("Primero vincula tu canal de YouTube");const name=path.basename(String(req.body?.name||""));if(!name||name!==String(req.body?.name||""))throw Error("Vídeo no válido");const file=path.join(videoDir,name);if(!fs.existsSync(file))throw Error("El vídeo ya no está disponible");res.json({ok:true,result:await upload(file,req,{title:req.body?.title,description:req.body?.description,tags:req.body?.tags,privacyStatus:req.body?.privacyStatus})});}catch(e){res.status(500).json({ok:false,error:e.message})}});
app.post("/api/youtube/daily-publish",async(req,res)=>{try{const secret=String(process.env.YOUTUBE_PUBLISH_SECRET||"");if(!secret||req.get("x-youtube-secret")!==secret)throw Error("No autorizado");if(!await token("default"))throw Error("Primero vincula tu canal de YouTube con Google");const generated=await generateForYouTube(req,true);res.json({ok:true,result:await upload(generated.file,null)});}catch(e){res.status(500).json({ok:false,error:e.message})}});
};