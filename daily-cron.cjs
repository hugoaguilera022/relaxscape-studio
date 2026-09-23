const url=process.env.DAILY_WEB_URL||'https://relaxscape-studio.onrender.com';
const secret=process.env.DAILY_CRON_SECRET||'';
const r=await fetch(url.replace(/\/$/,'')+'/api/daily-video-cron',{method:'POST',headers:{'Content-Type':'application/json',...(secret?{'x-daily-secret':secret}:{})},body:JSON.stringify({source:'render-cron'})});
const text=await r.text();
console.log(r.status,text);
if(!r.ok)process.exit(1);
