const path=require('path');
const fs=require('fs');
const {spawn}=require('child_process');
const sharp=require('sharp');

module.exports=function registerDailyRoutes(app){
 const ROOT=path.resolve(process.cwd());
 const VIDEO_DIR=path.join(ROOT,'data/videos');
 const TEMP_DIR=path.join(ROOT,'data/daily-temp');
 fs.mkdirSync(VIDEO_DIR,{recursive:true});
 fs.mkdirSync(TEMP_DIR,{recursive:true});
 const jobs=new Map();
 const trendCache={at:0,profiles:null,topVideos:[]};

 function classifyMusicoterapiaTitle(title='') {
  const t=String(title).toLowerCase();
  if (/sleep|sueño|dormir|insomnia|insomnio|deep sleep/.test(t)) return 'sleep';
  if (/study|estudiar|focus|concentr|concentration|work|trabajar/.test(t)) return 'focus';
  if (/meditation|meditacion|meditación|mindfulness|zen|relax|relaj/.test(t)) return 'meditation';
  if (/piano|pian/.test(t)) return 'piano';
  if (/rain|lluvia|rain sounds|white noise/.test(t)) return 'rain';
  if (/spa|massage|masaje|healing|sanación|sanacion/.test(t)) return 'spa';
  return 'relax';
}

async function refreshMusicoterapiaTrends(){
  const key=process.env.YOUTUBE_API_KEY;
  if(!key || Date.now()-trendCache.at<6*60*60*1000)return trendCache.profiles;
  try{
   const channelRes=await fetch('https://www.googleapis.com/youtube/v3/channels?part=contentDetails&forHandle=%40musicoterapiateam&key='+encodeURIComponent(key),{signal:AbortSignal.timeout(15000)});
   if(!channelRes.ok)throw Error('YouTube channels HTTP '+channelRes.status);
   const channel=await channelRes.json();
   const uploads=channel?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
   if(!uploads)throw Error('No se encontró la playlist de vídeos de Musicoterapia.');
   const listRes=await fetch('https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=50&playlistId='+encodeURIComponent(uploads)+'&key='+encodeURIComponent(key),{signal:AbortSignal.timeout(15000)});
   if(!listRes.ok)throw Error('YouTube playlistItems HTTP '+listRes.status);
   const list=await listRes.json();
   const ids=(list.items||[]).map(x=>x.contentDetails?.videoId).filter(Boolean);
   if(!ids.length)throw Error('No se encontraron vídeos de Musicoterapia.');
   const videoRes=await fetch('https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id='+ids.join(',')+'&key='+encodeURIComponent(key),{signal:AbortSignal.timeout(15000)});
   if(!videoRes.ok)throw Error('YouTube videos HTTP '+videoRes.status);
   const data=await videoRes.json();
   const top=(data.items||[]).map(v=>({
    id:v.id,title:v.snippet?.title||'',views:Number(v.statistics?.viewCount||0),
    duration:v.contentDetails?.duration||'',profile:classifyMusicoterapiaTitle(v.snippet?.title||'')
   })).sort((a,b)=>b.views-a.views).slice(0,12);
   const totals=new Map();
   for(const v of top)totals.set(v.profile,(totals.get(v.profile)||0)+Math.max(1,v.views));
   const profiles=[];
   for(const [keyName,weight] of totals.entries())profiles.push({key:keyName,weight});
   profiles.sort((a,b)=>b.weight-a.weight);
   trendCache.at=Date.now();trendCache.profiles=profiles;trendCache.topVideos=top;
   console.log('[Musicoterapia trends]',top.map(v=>v.views+' · '+v.profile+' · '+v.title).join(' | '));
   return profiles;
  }catch(e){
   console.warn('[Musicoterapia trends] fallback:',e.message||e);
   trendCache.at=Date.now();
   trendCache.profiles=null;
   return null;
  }
 }

 function pickWeightedProfile(seed,profiles){
  if(!Array.isArray(profiles)||!profiles.length)return null;
  const total=profiles.reduce((n,p)=>n+Math.max(1,p.weight),0);
  let x=hashSeed(seed)%total;
  for(const p of profiles){x-=Math.max(1,p.weight);if(x<0)return p.key;}
  return profiles[0].key;
 }

 async function ff(args){
  const p=(await import('ffmpeg-static')).default;
  return new Promise((resolve,reject)=>{
   const x=spawn(p,args,{stdio:['ignore','ignore','pipe']});let e='';
   x.stderr.on('data',d=>e+=d);x.on('error',reject);
   x.on('close',c=>c?reject(Error(e.slice(-8000)||`FFmpeg ${c}`)):resolve());
  });
 }
 const clean=f=>{try{if(f&&fs.existsSync(f))fs.unlinkSync(f)}catch{}};

 const LANDSCAPES=[
  'https://images.unsplash.com/photo-1500534623283-312aade485b7?auto=format&fit=crop&w=1920&q=90',
  'https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=1920&q=90',
  'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=1920&q=90',
  'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=1920&q=90',
  'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=1920&q=90',
  'https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=1920&q=90',
  'https://images.unsplash.com/photo-1439853949127-fa647821eba0?auto=format&fit=crop&w=1920&q=90',
  'https://images.unsplash.com/photo-1511497584788-876760111969?auto=format&fit=crop&w=1920&q=90'
 ];

 function hashSeed(seed){let n=0;for(const c of String(seed))n=(n*31+c.charCodeAt(0))>>>0;return n;}

 /*
  * Generador IA gratuito mediante el Space público de FLUX.1-schnell.
  * No usa Gemini, Pexels ni una API de pago. HF Spaces expone una API Gradio
  * pública y el Space oficial de FLUX.1-schnell ejecuta el modelo en ZeroGPU.
  * Si el Space está ocupado o sin cuota, hacemos fallback a Unsplash.
  */
 async function generateFreeAIImage(out,prompt,seed){
  const base='https://black-forest-labs-flux-1-schnell.hf.space';
  const payload={data:[prompt,hashSeed(seed),true,1024,576,4]};
  let submit;
  try{
   submit=await fetch(base+'/gradio_api/call/infer',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(payload),signal:AbortSignal.timeout(12000)
   });
  }catch(e){return null;}
  if(!submit.ok)return null;
  const submitted=await submit.json().catch(()=>null);
  const eventId=submitted?.event_id;
  if(!eventId)return null;

  try{
   const stream=await fetch(base+'/gradio_api/call/infer/'+eventId,{signal:AbortSignal.timeout(30000)});
   if(!stream.ok)return null;
   const text=await stream.text();
    const m=text.match(/data:\s*(\[[\s\S]*?\])\s*(?:\r?\n|$)/);
   if(!m)return null;
   const data=JSON.parse(m[1]);
   const file=data?.[0];
   const url=file?.url || (file?.path ? base+'/file='+file.path : null);
   if(!url)return null;
   const img=await fetch(url,{signal:AbortSignal.timeout(60000)});
   if(!img.ok)return null;
   const b=Buffer.from(await img.arrayBuffer());
   if(b.length<10000)return null;
   fs.writeFileSync(out,b);
   return {provider:'Hugging Face Spaces · FLUX.1-schnell',sourceUrl:url};
  }catch(e){return null;}
 }

 async function downloadYouTubeLandscape(out,seed){
  const profile=youtubeProfileFor(seed);
  const aiPrompt=profile.prompt+' Natural premium YouTube relaxation artwork, cinematic photography, rich atmospheric depth, realistic light, no people, no text, no logos.';
  const ai=await generateFreeAIImage(out,aiPrompt,seed);
  if(ai)return {...ai,profile:profile.key,provider:'Hugging Face · IA generativa · paisaje original'};
  const fallbacks={
   'zen-piano':'https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=2400&q=92',
   'ocean-meditation':'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=2400&q=92',
   'focus-piano':'https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=2400&q=92',
   'celtic-flute':'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=2400&q=92',
   'deep-sleep':'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=2400&q=92',
   'spa-water':'https://images.unsplash.com/photo-1439853949127-fa647821eba0?auto=format&fit=crop&w=2400&q=92',
   'rain-piano':'https://images.unsplash.com/photo-1511497584788-876760111969?auto=format&fit=crop&w=2400&q=92',
   'forest-flute':'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=2400&q=92',
   'sunset-piano':'https://images.unsplash.com/photo-1500534623283-312aade485b7?auto=format&fit=crop&w=2400&q=92',
   'river-meditation':'https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=2400&q=92',
   'cabin-rain':'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=2400&q=92',
   'desert-calm':'https://images.unsplash.com/photo-1500534623283-312aade485b7?auto=format&fit=crop&w=2400&q=92'
  };
  const url=fallbacks[profile.key]||fallbacks['zen-piano'];
  const rr=await fetch(url,{signal:AbortSignal.timeout(30000)});
  if(!rr.ok)throw Error('No se pudo descargar el paisaje YouTube (HTTP '+rr.status+').');
  const b=Buffer.from(await rr.arrayBuffer());
  if(b.length<10000)throw Error('Paisaje YouTube no válido.');
  fs.writeFileSync(out,b);
  return {provider:'Unsplash · fotografía real de respaldo',sourceUrl:url,profile:profile.key};
 }
 
 async function generateAceStep(out,seed,seconds,onProgress){
  const base='https://ace-step-v1-5.hf.space';
  const prompts={
   'zen-piano':'long-form instrumental zen relaxation, beautiful soft felt piano melody, warm strings, airy pads, very subtle acoustic guitar, 58 BPM, slow evolving harmony, spacious cinematic meditation, no vocals, no drums, no percussion, no electronic beat',
   'ocean-meditation':'long-form instrumental ocean meditation, delicate piano, nylon-string guitar, airy flute, soft strings, 56 BPM, gentle flowing melody, serene yoga and relaxation mood, no vocals, no drums, no percussion, no electronic beat',
   'focus-piano':'long-form instrumental study and concentration music, elegant soft piano, warm acoustic guitar, subtle strings, 62 BPM, repeating but evolving chord progression, calm sophisticated background, no vocals, no drums, no percussion, no electronic beat',
   'celtic-flute':'long-form instrumental Celtic-inspired relaxation, expressive wooden flute lead, harp, soft piano and strings, 60 BPM, flowing folk melody, ancient forest and misty river mood, acoustic and cinematic, no vocals, no drums, no percussion',
   'deep-sleep':'long-form instrumental deep sleep, felt piano with sparse notes, warm strings, distant flute, 50 BPM, very slow harmonic movement, dreamy nocturnal atmosphere, minimal and soothing, no vocals, no drums, no percussion, no beat',
   'spa-water':'long-form luxury spa instrumental, delicate piano, harp, soft mallets, airy flute, warm strings, 58 BPM, elegant flowing melody, tropical wellness atmosphere, no vocals, no drums, no percussion, no electronic beat',
   'rain-piano':'long-form relaxing piano instrumental, intimate felt piano, soft cello and warm strings, 54 BPM, gentle emotional melody, rainy forest atmosphere, no vocals, no drums, no percussion',
   'forest-flute':'long-form nature meditation instrumental, wooden flute, harp, acoustic guitar and soft strings, 57 BPM, organic evolving melody, ancient forest atmosphere, no vocals, no drums, no percussion',
   'sunset-piano':'long-form cinematic relaxation piano, warm expressive piano, cello, soft strings and acoustic guitar, 60 BPM, beautiful sunset melody, emotional but peaceful, no vocals, no drums, no percussion',
   'river-meditation':'long-form meditation instrumental, piano, harp, bamboo flute and soft strings, 55 BPM, flowing water-like musical phrasing, spacious peaceful harmony, no vocals, no drums, no percussion',
   'cabin-rain':'long-form sleep and rain relaxation music, felt piano, soft cello, warm pads and gentle guitar, 52 BPM, cozy intimate melody, no vocals, no drums, no percussion, no electronic beat',
   'desert-calm':'long-form ambient meditation instrumental, soft piano, oud-like plucked strings, airy flute and warm pads, 56 BPM, spacious peaceful melody, elegant minimalist atmosphere, no vocals, no drums, no percussion'
  };
  const profile=youtubeProfileFor(seed),caption=prompts[profile.key]||prompts['zen-piano'];
  const duration=Math.min(600,Math.max(120,Number(seconds)||300));
  let submit;
  try{
   submit=await fetch(base+'/v1/music/generate',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({caption,lyrics:'[Instrumental]',thinking:true,instrumental:true,audio_duration:duration,audio_format:'mp3',model:'acestep-v15-turbo',inference_steps:8,batch_size:1,use_random_seed:true}),
    signal:AbortSignal.timeout(30000)
   });
  }catch{return null;}
  if(!submit.ok)return null;
  const job=await submit.json().catch(()=>null),jobId=job?.job_id;if(!jobId)return null;
  const deadline=Date.now()+Math.max(360000,duration*1800);
  try{
   while(Date.now()<deadline){
    const rr=await fetch(base+'/v1/jobs/'+encodeURIComponent(jobId),{signal:AbortSignal.timeout(30000)});
    if(!rr.ok)return null;
    const j=await rr.json().catch(()=>null);
    if(j?.status==='failed')return null;
    if(j?.status==='succeeded'){
     const result=j.result||{};
     const audioPath=result.first_audio_path||(Array.isArray(result.audio_paths)?result.audio_paths[0]:null);
     if(!audioPath)return null;
     const audioUrl=audioPath.startsWith('http')?audioPath:(base+'/v1/audio?path='+encodeURIComponent(audioPath));
     const src=await fetch(audioUrl,{signal:AbortSignal.timeout(120000)});if(!src.ok)return null;
     const tmp=path.join(TEMP_DIR,'acestep-'+Date.now()+'.mp3');fs.writeFileSync(tmp,Buffer.from(await src.arrayBuffer()));
     try{await ff(['-y','-i',tmp,'-vn','-ac','2','-ar','44100','-c:a','pcm_s16le',out]);}
     finally{clean(tmp);}
     return {provider:'ACE-Step 1.5 · Hugging Face ZeroGPU',prompt:caption,profile:profile.key};
    }
    if(typeof onProgress==='function'){const elapsed=Math.max(0,Date.now()-(deadline-Math.max(360000,duration*1800)));const total=Math.max(1,Math.max(360000,duration*1800));const local=Math.min(94,55+Math.round((elapsed/total)*39));onProgress(local,'Creando audio relajante IA…');} await new Promise(resolve=>setTimeout(resolve,5000));
   }
  }catch{return null;}
  return null;
 }
 
 async function downloadLandscape(out,seed){
  const url=LANDSCAPES[hashSeed(seed)%LANDSCAPES.length];
  const r=await fetch(url,{signal:AbortSignal.timeout(30000)});
  if(!r.ok)throw Error('No se pudo descargar el paisaje gratuito (HTTP '+r.status+').');
  const b=Buffer.from(await r.arrayBuffer());
  if(b.length<10000)throw Error('El paisaje descargado no es válido.');
  fs.writeFileSync(out,b);
  return {provider:'Unsplash',sourceUrl:url};
 }

 function youtubeProfileFor(seed='daily') {
  const profiles = {
    piano:{title:'Piano relajante', visual:'abstract cinematic ambient artwork with soft light, flowing gradients, dreamy atmosphere, premium meditation aesthetic, no landscape, no realistic nature', music:'original slow emotional ambient piano, warm felt piano, soft pads, spacious reverb, no vocals, no nature sounds'},
    meditation:{title:'Meditación profunda', visual:'abstract ethereal meditation artwork, luminous particles, soft gradients, dark blue and teal atmosphere, cinematic AI art, premium wellness aesthetic, no landscape, no literal nature', music:'original deep meditation ambient, warm synth pads, subtle piano, slow evolving textures, no vocals, no nature sounds'},
    sleep:{title:'Sueño profundo', visual:'dreamy abstract night artwork, soft moon-like glow, stars as subtle particles, dark navy and violet gradients, cinematic AI aesthetic, no landscape', music:'original deep sleep ambient, very slow soft pads, gentle piano notes, warm low frequencies, no vocals, no nature sounds'},
    focus:{title:'Música para estudiar', visual:'minimal futuristic study ambience, elegant abstract room-like geometry, soft blue lighting, cinematic AI artwork, clean premium composition, no landscape', music:'original focus music, calm piano and subtle electronic ambient layers, steady unobtrusive texture, no vocals, no nature sounds'},
    rain:{title:'Lluvia para relajarse', visual:'cinematic abstract window atmosphere with soft rain reflections, blue night lighting, bokeh, cozy premium AI artwork, no outdoor landscape', music:'original calming ambient piano with very subtle rain-like texture, no thunder, no vocals, no natural field recordings'},
    spa:{title:'Spa y relajación', visual:'luxury spa-inspired abstract ambient artwork, soft turquoise water-like light patterns, candles represented as glow, premium cinematic AI aesthetic, no landscape', music:'original spa ambient music, soft piano, airy pads, gentle bells used sparingly, no vocals, no nature sounds'},
    relax:{title:'Música relajante', visual:'premium abstract relaxation artwork, flowing light ribbons, soft blue teal gradients, dreamy cinematic atmosphere, high-end AI art, no landscape, no literal nature', music:'original relaxing ambient music, soft piano, warm pads, slow evolution, no vocals, no nature sounds'}
  };
  const keys=Object.keys(profiles);
  const n=Math.abs(String(seed).split('').reduce((a,ch)=>a+ch.charCodeAt(0),0))%keys.length;
  return profiles[keys[n]];
}

function referenceBlueprintFromText(title,analysis,profileKey){
  const profile=youtubeProfileFor(profileKey||title||'daily');
  const scenes=[
    'abstract flowing light ribbons with soft cinematic glow',
    'dreamy luminous particles through deep blue and teal gradients',
    'minimal premium wellness composition with soft volumetric light',
    'ethereal geometric forms with slow elegant visual rhythm'
  ];
  return {key:profileKey||'relax',title:profile.title,subject:profile.title,scenes,visual:profile.visual,music:profile.music,sourceTitle:String(title||''),analysis:String(analysis||'')};
}

async function getMusicoterapiaReference(seed){
  await refreshMusicoterapiaTrends();
  const top=trendCache.topVideos||[];
  if(!top.length)return null;
  const idx=hashSeed(seed)%Math.min(top.length,8);
  const v=top[idx];
  return {...v,url:"https://www.youtube.com/watch?v="+v.id};
 }

 async function analyzeReferenceForDaily(ref){
  if(!ref?.url)return null;
  try{
   const baseUrl='http://127.0.0.1:'+String(process.env.PORT||3000);
   const rr=await fetch(baseUrl+'/api/youtube-ai-analyze',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({url:ref.url}),signal:AbortSignal.timeout(180000)
   });
   if(!rr.ok)return null;
   return await rr.json();
  }catch(e){
   console.warn('[Daily reference analysis]',e.message||e);
   return null;
  }
 }

 async function generateSceneSet(work,blueprint,seed,onProgress){
  const files=[];
  const total=blueprint.scenes.length;
  for(let i=0;i<total;i++){
   const scene=blueprint.scenes[i];
   const prompt=[
    'Create a completely original cinematic visual for a long-form relaxation video.',
    scene+'.',
    'Theme: '+blueprint.subject+'.',
    'Visual reference description only: '+blueprint.analysis.slice(0,1200),
    'Do not reproduce any frame, composition, logo, person, text, thumbnail or identifiable copyrighted artwork from the reference.',
    'Use a distinct original composition, realistic premium photography, slow peaceful atmosphere, subtle depth, 16:9, no text, no logos.'
   ].join(' ');
   const out=path.join(work,'scene-'+i+'.jpg');
   let ok=await generateFreeAIImage(out,prompt,String(seed)+'-scene-'+i);
   if(!ok){
    const fallback=LANDSCAPES[(hashSeed(String(seed)+'-'+i))%LANDSCAPES.length];
    const rr=await fetch(fallback,{signal:AbortSignal.timeout(30000)});
    if(rr.ok)fs.writeFileSync(out,Buffer.from(await rr.arrayBuffer()));
   }
   if(fs.existsSync(out)&&fs.statSync(out).size>10000)files.push(out);
   if(typeof onProgress==='function')onProgress(22+Math.round((i+1)/total*18),'Creando escena '+(i+1)+'/'+total+' · '+blueprint.subject+'…');
  }
  return files;
 }

 function musicPromptForBlueprint(blueprint) {
  return blueprint?.music || 'original premium relaxing ambient music, soft piano and warm pads, slow evolution, no vocals, no nature sounds';
}

async function generateBlueprintMusic(out,blueprint,seed,seconds,onProgress){
  const duration=Math.min(600,Math.max(120,seconds));
  const base='https://ace-step-v1-5.hf.space';
  const caption=musicPromptForBlueprint(blueprint,hashSeed(seed)%1000);
  let submit;
  try{
   submit=await fetch(base+'/v1/music/generate',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({caption,lyrics:'[Instrumental]',thinking:true,instrumental:true,audio_duration:duration,audio_format:'mp3',model:'acestep-v15-turbo',inference_steps:8,batch_size:1,use_random_seed:true}),
    signal:AbortSignal.timeout(30000)
   });
  }catch{return null}
  if(!submit.ok)return null;
  const job=await submit.json().catch(()=>null),jobId=job?.job_id;if(!jobId)return null;
  const deadline=Date.now()+Math.max(360000,duration*1800);
  while(Date.now()<deadline){
   try{
    const rr=await fetch(base+'/v1/jobs/'+encodeURIComponent(jobId),{signal:AbortSignal.timeout(30000)});
    if(!rr.ok)return null;
    const j=await rr.json().catch(()=>null);
    if(j?.status==='failed')return null;
    if(j?.status==='succeeded'){
     const rp=j.result||{},ap=rp.first_audio_path||(Array.isArray(rp.audio_paths)?rp.audio_paths[0]:null);
     if(!ap)return null;
     const u=ap.startsWith('http')?ap:(base+'/v1/audio?path='+encodeURIComponent(ap));
     const src=await fetch(u,{signal:AbortSignal.timeout(120000)});if(!src.ok)return null;
     const tmp=path.join(TEMP_DIR,'blue-music-'+Date.now()+'.mp3');fs.writeFileSync(tmp,Buffer.from(await src.arrayBuffer()));
     try{await ff(['-y','-i',tmp,'-vn','-ac','2','-ar','44100','-c:a','pcm_s16le',out]);}finally{clean(tmp)}
     return {provider:'ACE-Step 1.5 · original composition',prompt:caption};
    }
    if(typeof onProgress==='function'){
     const elapsed=Math.max(0,Date.now()-(deadline-Math.max(360000,duration*1800)));
     const total=Math.max(1,Math.max(360000,duration*1800));
     onProgress(40+Math.min(35,Math.round(elapsed/total*35)),'Creando música original IA…');
    }
    await new Promise(r=>setTimeout(r,5000));
   }catch{return null}
  }
  return null;
 }


 async function makeVideo({durationMinutes=60,seed='daily',youtubeMode=false,onProgress,referenceUrl=null}){
  const minutes=Math.max(1,Math.min(1440,Number(durationMinutes)||60)),seconds=Math.max(60,minutes*60);
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const work=path.join(TEMP_DIR,'daily-work-'+stamp);
  const out=path.join(VIDEO_DIR,'daily-'+stamp+'.mp4');
  fs.mkdirSync(work,{recursive:true});
  try{
   const progress=(p,m)=>{if(typeof onProgress==='function')onProgress(p,m)};
   let ref=null,analysis=null;
   if(youtubeMode){
    progress(5,'Buscando una referencia real de Musicoterapia…');
    ref=referenceUrl?{url:referenceUrl,id:(String(referenceUrl).match(/[?&]v=([^&]+)/)||[])[1]||'',title:''}:await getMusicoterapiaReference(seed);
    if(ref)progress(10,'Referencia seleccionada: '+(ref.title||'vídeo del canal')+'…');
    analysis=await analyzeReferenceForDaily(ref);
   }
   const profileKey=ref?.profile||classifyMusicoterapiaTitle(ref?.title||'');
   const blueprint=referenceBlueprintFromText(ref?.title||'',analysis?.videoAnalysis||'',profileKey);
   if(analysis?.audioAnalysis)blueprint.analysis+=' Audio: '+analysis.audioAnalysis.slice(-900);
   progress(18,youtubeMode?'Analizando estilo, escenas y ritmo de la referencia…':'Preparando concepto audiovisual…');
   const scenes=await generateSceneSet(work,blueprint,seed,progress);
   if(!scenes.length)throw Error('No se pudieron crear escenas visuales.');
   progress(40,'Escenas originales preparadas ('+scenes.length+').');
   const audioSegments=[];
   // Para Programar ahora usamos una única generación musical corta y la repetimos.
   // Así evitamos bloquear la generación durante horas en vídeos largos.
   const segmentSeconds=Math.min(120,Math.max(60,seconds));
   const aud=path.join(work,'music-0.wav');
   progress(42,'Generando música de Musicoterapia…');
   const info=await generateBlueprintMusic(aud,blueprint,String(seed)+'-music-0',segmentSeconds,(p,m)=>progress(42+Math.round(p*.28),m));
   if(info)audioSegments.push(aud);
   else {writeYouTubeWav(aud,segmentSeconds,String(seed)+'-0');audioSegments.push(aud)}
   progress(70,'Música preparada; continuando con el montaje…');
   const audio=path.join(work,'music-long.wav');
   const alist=path.join(work,'audio.txt');
   fs.writeFileSync(alist,audioSegments.map(x=>"file '"+x.replace(/'/g,"'\\''")+"'").join("\n"));
   if(audioSegments.length>1)await ff(['-y','-f','concat','-safe','0','-i',alist,'-c:a','pcm_s16le',audio]);
   else fs.copyFileSync(audioSegments[0],audio);
   progress(76,'Montando escenas con movimiento y transiciones…');
   const sceneSeconds=Math.max(30,Math.ceil(seconds/scenes.length));
   const segs=[];
   for(let i=0;i<scenes.length;i++){
    const seg=path.join(work,'video-'+i+'.mp4');segs.push(seg);
    const zoom=i%2===0?'zoompan=z=min(zoom+0.0008,1.10):x=iw/2-(iw/zoom/2):y=ih/2-(ih/zoom/2):d=1:s=1920x1080:fps=10':'zoompan=z=max(zoom-0.0006,1.0):x=iw/2-(iw/zoom/2):y=ih/2-(ih/zoom/2):d=1:s=1920x1080:fps=10';
    await ff(['-y','-loop','1','-i',scenes[i],'-t',String(sceneSeconds),'-vf',zoom+',format=yuv420p','-r','10','-c:v','libx264','-preset','ultrafast','-crf','24','-pix_fmt','yuv420p',seg]);
   }
   const list=path.join(work,'videos.txt');fs.writeFileSync(list,segs.map(x=>"file '"+x.replace(/'/g,"'\\''")+"'").join("\n"));
   const visual=path.join(work,'visual.mp4');
   await ff(['-y','-f','concat','-safe','0','-i',list,'-c','copy',visual]);
   const audioDuration=seconds;
   await ff(['-y','-stream_loop','-1','-i',visual,'-stream_loop','-1','-i',audio,'-t',String(audioDuration),'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','160k','-ar','44100','-ac','2','-shortest','-movflags','+faststart',out]);
   progress(96,'Comprobando vídeo final…');
   const titleOptions=blueprint.subject==='focus and concentration' ? ['Música Original para Estudiar y Concentrarse · Ambiente Profundo','Concentración Profunda · Música Original para Estudiar','Música Ambiental Original para Trabajo y Estudio'] : blueprint.subject==='deep sleep' ? ['Música Original para Dormir Profundamente · Calma Nocturna','Sueño Profundo · Música Ambiental Original','Música Original para Relajarse y Dormir'] : blueprint.subject==='celtic instrumental relaxation' ? ['Música Celta Original para Relajarse · Flauta y Atmósfera Profunda','Flauta Celta Original · Música para Meditar','Música Instrumental Celta Original para Calmar la Mente'] : ['Música Original para Relajarse · '+blueprint.subject,'Relajación Profunda · Música Ambiental Original','Calma y Meditación · Música Original de RelaxScape'];
   const thumbnailName='thumb-'+path.basename(out,'.mp4')+'.jpg',thumbnail=path.join(VIDEO_DIR,thumbnailName);
   await createYouTubeThumbnail(scenes[0],thumbnail,titleOptions[0],blueprint.key);
   const description='Recreación audiovisual original de RelaxScape Studio inspirada en tendencias de relajación y en la estructura temática de una referencia pública. Todas las imágenes y la música de este vídeo se generan como material nuevo y no reutilizan la grabación, audio, fotogramas, miniatura ni texto del vídeo de referencia.';
   return {url:'/media/videos/'+path.basename(out),name:path.basename(out),durationMinutes:minutes,thumbnailUrl:'/media/videos/'+encodeURIComponent(thumbnailName),generatedImage:true,imageProvider:'Hugging Face · FLUX.1-schnell · escenas originales',referenceVideo:ref?.url||null,referenceTitle:ref?.title||null,referenceAnalysis:analysis?.videoAnalysis||null,sceneCount:scenes.length,musicProvider:'ACE-Step · composición original',theme:blueprint.key,title:titleOptions[0],titleOptions,description,tags:['música relajante','meditación','relajación','estudio','sueño','música original','ambient']};
  }finally{await fs.promises.rm(work,{recursive:true,force:true}).catch(()=>{})}
 }

 app.post('/api/daily-video-now',async(req,res,next)=>{if(req.body?.musicoterapia===true)return next();
  const id='daily-'+Date.now();jobs.set(id,{status:'running',progress:5,message:'Preparando generación gratuita...'});res.json({jobId:id,status:'running'});
  try{
   jobs.set(id,{status:'running',progress:5,message:'Preparando referencia y generación audiovisual...'});
   const result=await makeVideo({durationMinutes:req.body?.durationMinutes||60,seed:id,youtubeMode:req.body?.youtubeMode===true,referenceUrl:req.body?.referenceUrl||null,onProgress:(progress,message)=>jobs.set(id,{status:'running',progress,message})});
   jobs.set(id,{status:'succeeded',progress:100,message:'Vídeo terminado',result});
  }catch(e){console.error('[Daily free]',e);jobs.set(id,{status:'failed',progress:0,error:e.message||String(e)});}
 });
 app.get('/api/daily-video-status',async(req,res)=>res.json(jobs.get(String(req.query.jobId))||{status:'unknown'}));
 app.post('/api/daily-video-cron',async(req,res)=>{
  const secret=process.env.DAILY_CRON_SECRET;if(secret&&req.get('x-daily-secret')!==secret)return res.status(401).json({error:'Unauthorized'});
  try{const result=await makeVideo({durationMinutes:req.body?.durationMinutes||60,seed:new Date().toISOString().slice(0,10),youtubeMode:true});res.json({ok:true,result});}
  catch(e){res.status(500).json({ok:false,error:e.message});}
 });
};
