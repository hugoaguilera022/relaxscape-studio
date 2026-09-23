const url=process.env.DAILY_WEB_URL||'https://relaxscape-studio.onrender.com';
const secret=process.env.DAILY_CRON_SECRET||'';
const tz=process.env.DAILY_TIMEZONE||'Europe/Madrid';
const wanted=String(process.env.DAILY_VIDEO_HOUR||'05:00');
const parts=wanted.split(':').map(Number);
const hour=Number.isFinite(parts[0])?parts[0]:5;
const minute=Number.isFinite(parts[1])?parts[1]:0;
const now=new Date();
const fmt=new Intl.DateTimeFormat('en-GB',{timeZone:tz,hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const local=fmt.formatToParts(now);
const lh=Number(local.find(x=>x.type==='hour')?.value);
const lm=Number(local.find(x=>x.type==='minute')?.value);
if(lh!==hour || lm!==minute){
  console.log(`Skipping: local time in ${tz} is ${String(lh).padStart(2,'0')}:${String(lm).padStart(2,'0')}; configured ${wanted}.`);
  process.exit(0);
}
const r=await fetch(url.replace(/\/$/,'')+'/api/daily-video-cron',{
  method:'POST',
  headers:{'Content-Type':'application/json',...(secret?{'x-daily-secret':secret}:{})},
  body:JSON.stringify({source:'render-cron',timezone:tz})
});
const text=await r.text();
console.log(r.status,text);
if(!r.ok)process.exit(1);
