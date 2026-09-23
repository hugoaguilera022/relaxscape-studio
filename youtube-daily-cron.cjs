const url=(process.env.DAILY_WEB_URL||"https://relaxscape-studio.onrender.com").replace(/\/$/,"");
const secret=process.env.YOUTUBE_PUBLISH_SECRET||"";
try{
 const r=await fetch(url+"/api/youtube/daily-publish",{method:"POST",headers:{"Content-Type":"application/json",...(secret?{"x-youtube-secret":secret}:{})},body:JSON.stringify({durationMinutes:Number(process.env.YOUTUBE_DAILY_MINUTES||60)})});
 const t=await r.text();
 console.log("[YouTube daily]",r.status,t);
 // If the channel has not been linked yet, the cron remains healthy and waits
 // for the user to connect it from the web UI.
 if(r.status===400 && /vincula|vincul/i.test(t)) process.exit(0);
 if(!r.ok) process.exit(1);
}catch(e){
 console.error("[YouTube daily]",e.message);
 process.exit(1);
}
