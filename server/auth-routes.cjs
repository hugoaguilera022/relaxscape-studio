const crypto=require("crypto");

const sessions=new Map();
const prefs=new Map();

function parseCookies(req){
  const out={};
  for(const part of String(req.headers.cookie||"").split(";")){
    const i=part.indexOf("=");
    if(i<0)continue;
    out[part.slice(0,i).trim()]=decodeURIComponent(part.slice(i+1).trim());
  }
  return out;
}
function sessionSecret(){
  return process.env.SESSION_SECRET||process.env.GOOGLE_CLIENT_SECRET||"relaxscape-local-session";
}
function sign(value){
  return crypto.createHmac("sha256",sessionSecret()).update(value).digest("base64url");
}
function makeSession(user){
  const payload=Buffer.from(JSON.stringify({u:user,exp:Date.now()+7*24*3600*1000})).toString("base64url");
  return payload+"."+sign(payload);
}
function readSession(req){
  const raw=parseCookies(req).rs_session||"";
  const [payload,sig]=raw.split(".");
  if(!payload||!sig)return null;
  const expected=sign(payload),a=Buffer.from(sig),bb=Buffer.from(expected);
  if(a.length!==bb.length||!crypto.timingSafeEqual(a,bb))return null;
  try{
    const x=JSON.parse(Buffer.from(payload,"base64url").toString());
    return x.exp>Date.now()?x.u:null;
  }catch{return null}
}
function setCookie(res,name,value,maxAge=2592000){
  const cookie=name+"="+encodeURIComponent(value)+"; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age="+maxAge;
  const current=res.getHeader("Set-Cookie");
  res.setHeader("Set-Cookie",current?[...current,cookie]:[cookie]);
}
function redirectUri(req){
  return process.env.GOOGLE_REDIRECT_URI||("https://"+String(req.headers.host||"relaxscape-studio.onrender.com").replace(/:\d+$/,"")+"/api/auth/callback");
}
function timeoutFetch(url,options={},ms=15000){
  const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);
  return fetch(url,{...options,signal:c.signal}).finally(()=>clearTimeout(t));
}

module.exports=function registerAuthRoutes(app){
  app.get("/api/auth/status",(req,res)=>{
    const user=readSession(req);
    res.json(user?{authenticated:true,user}:{authenticated:false});
  });

  app.get("/api/auth/login",(req,res)=>{
    const id=process.env.GOOGLE_CLIENT_ID;
    if(!id)return res.status(500).send("Falta GOOGLE_CLIENT_ID en Render.");
    const state=crypto.randomBytes(24).toString("hex");
    setCookie(res,"rs_oauth_state",state,600);
    const u=new URL("https://accounts.google.com/o/oauth2/v2/auth");
    u.searchParams.set("client_id",id);
    u.searchParams.set("redirect_uri",redirectUri(req));
    u.searchParams.set("response_type","code");
    u.searchParams.set("scope","openid email profile");
    u.searchParams.set("state",state);
    u.searchParams.set("access_type","online");
    u.searchParams.set("prompt","select_account");
    res.redirect(u.toString());
  });

  app.get("/api/auth/callback",async(req,res)=>{
    try{
      const code=String(req.query.code||"");
      const state=String(req.query.state||"");
      const expected=parseCookies(req).rs_oauth_state||"";
      if(!code)return res.status(400).send("Error 400: Google no devolvió un código de autorización.");
      if(!state||!expected||state!==expected)return res.status(400).send("Error 400: estado OAuth no válido. Vuelve a iniciar sesión.");
      const id=process.env.GOOGLE_CLIENT_ID,secret=process.env.GOOGLE_CLIENT_SECRET;
      if(!id||!secret)return res.status(500).send("Faltan GOOGLE_CLIENT_ID o GOOGLE_CLIENT_SECRET en Render.");

      const tokenBody=new URLSearchParams({
        code,client_id:id,client_secret:secret,redirect_uri:redirectUri(req),grant_type:"authorization_code"
      });
      const tr=await timeoutFetch("https://oauth2.googleapis.com/token",{
        method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:tokenBody
      },20000);
      const td=await tr.json().catch(()=>({}));
      if(!tr.ok||!td.access_token)throw Error("Google token HTTP "+tr.status+(td.error_description?" · "+td.error_description:""));

      const ur=await timeoutFetch("https://openidconnect.googleapis.com/v1/userinfo",{
        headers:{Authorization:"Bearer "+td.access_token,Accept:"application/json"}
      },15000);
      const user=await ur.json().catch(()=>({}));
      if(!ur.ok||!user.email)throw Error("Google userinfo HTTP "+ur.status);

      setCookie(res,"rs_session",makeSession({
        id:user.sub,name:user.name||user.given_name||"Usuario Google",email:user.email,
        picture:user.picture||""
      }));
      setCookie(res,"rs_oauth_state","",0);
      res.redirect("/");
    }catch(e){
      console.error("[Google OAuth]",e.message);
      res.status(400).send("Error 400 al iniciar sesión con Google.<br><br>"+String(e.message||"Error OAuth").replace(/[<>&]/g,""));
    }
  });

  app.post("/api/auth/logout",(req,res)=>{
    setCookie(res,"rs_session","",0);
    res.json({ok:true});
  });

  app.get("/api/user/preferences",(req,res)=>{
    const user=readSession(req);
    if(!user)return res.status(401).json({error:"No autenticado"});
    res.json({preferences:prefs.get(user.id)||{}});
  });

  app.put("/api/user/preferences",(req,res)=>{
    const user=readSession(req);
    if(!user)return res.status(401).json({error:"No autenticado"});
    const incoming=req.body?.preferences;
    if(!incoming||typeof incoming!=="object")return res.status(400).json({error:"Preferencias inválidas"});
    prefs.set(user.id,incoming);
    res.json({ok:true});
  });
};
