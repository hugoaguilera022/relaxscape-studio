const url=(process.env.DAILY_WEB_URL||"https://relaxscape-studio.onrender.com").replace(/\/$/,"");
const secret=process.env.YOUTUBE_PUBLISH_SECRET||"";
const r=await fetch(url+"/api/youtube/daily-publish",{method:"POST",headers:{"Content-Type":"application/json",...(secret?{"x-youtube-secret":secret}:{})},body:JSON.stringify({durationMinutes:Number(process.env.YOUTUBE_DAILY_MINUTES||60)})});
const t=await r.text();console.log(r.status,t);if(!r.ok)process.exit(1);
