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

 function classifyMusicoterapiaTitle(title){
  const t=String(title||'').toLowerCase();
  if(/estudi|concentr|memor|ondas alfa|trabaj/.test(t))return 'focus-piano';
  if(/celta|celtic|flauta|flute/.test(t))return 'celtic-flute';
  if(/dormir|sueño|sleep|descans/.test(t))return 'deep-sleep';
  if(/mar|olas|océano|ocean|agua/.test(t))return 'ocean-meditation';
  if(/lluvia|rain/.test(t))return 'rain-piano';
  if(/spa|yoga|masaje|wellness/.test(t))return 'spa-water';
  if(/bosque|forest|naturaleza|naturaleza|río|river/.test(t))return 'forest-flute';
  return 'zen-piano';
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
    const m=text.match(/data:\s*(\[[\s\S]*?\])\s*(?:\n|$)/);
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

 function youtubeProfileFor(seed){
  // 12 familias originales basadas en patrones descriptivos de los vídeos más vistos:
  // zen/anti-estrés, estudio, sueño, mar, agua, celta, flauta, piano y naturaleza.
  const profiles=[
   {key:'zen-piano',prompt:'Photorealistic cinematic mountain lake at sunrise, turquoise water, layered alpine mountains, soft golden mist, elegant pine trees, warm peach sky, peaceful healing and anti-stress atmosphere, premium relaxation channel aesthetic, wide 16:9'},
   {key:'ocean-meditation',prompt:'Photorealistic cinematic tropical ocean at sunrise, crystal turquoise water, quiet sandy beach, gentle waves, distant rocky cliffs, warm glowing horizon, serene meditation and yoga atmosphere, premium relaxation channel aesthetic, wide 16:9'},
   {key:'focus-piano',prompt:'Photorealistic cinematic Japanese-inspired garden beside a still lake, graceful maple and pine trees, distant mountains, soft morning light, subtle mist, refined concentration and study atmosphere, beautiful natural composition, wide 16:9'},
   {key:'celtic-flute',prompt:'Photorealistic cinematic emerald Celtic valley, ancient moss-covered forest, winding river, waterfall, dramatic misty mountains, soft overcast daylight, deep green tones, peaceful Celtic healing atmosphere, wide 16:9'},
   {key:'deep-sleep',prompt:'Photorealistic cinematic moonlit mountain lake at blue hour, dark pine forest, silver moon reflection, faint stars, low mist, deep navy tones, dreamy sleep and night relaxation atmosphere, wide 16:9'},
   {key:'spa-water',prompt:'Photorealistic cinematic luxury tropical waterfall and lagoon, smooth stones, lush rainforest, palms, golden morning rays through mist, elegant spa and wellness atmosphere, wide 16:9'},
   {key:'rain-piano',prompt:'Photorealistic cinematic rainy mountain forest, glassy river, soft waterfall, dense green leaves covered in rain, atmospheric fog, cozy peaceful mood, gentle piano relaxation aesthetic, wide 16:9'},
   {key:'forest-flute',prompt:'Photorealistic cinematic ancient European forest at dawn, tall trees, moss, tiny stream, sunbeams through fog, rich natural greens, intimate wooden flute and meditation atmosphere, wide 16:9'},
   {key:'sunset-piano',prompt:'Photorealistic cinematic peaceful alpine valley at sunset, orange and pink sky, calm lake reflections, distant mountains, soft haze, emotional but relaxing piano atmosphere, wide 16:9'},
   {key:'river-meditation',prompt:'Photorealistic cinematic clear river flowing through a lush valley, smooth rocks, small cascades, ferns and trees, soft morning light, tranquil meditation and breathing atmosphere, wide 16:9'},
   {key:'cabin-rain',prompt:'Photorealistic cinematic remote mountain cabin surrounded by pine forest during gentle rain, misty valley, warm window glow, cozy sleep and stress-relief atmosphere, elegant realistic photography, wide 16:9'},
   {key:'desert-calm',prompt:'Photorealistic cinematic peaceful desert oasis at golden hour, palm trees, still water, distant mountains, warm amber light, minimalist meditation and deep relaxation atmosphere, premium realistic photography, wide 16:9'}
  ];
  const selected=pickWeightedProfile(seed,trendCache.profiles);\n  return profiles.find(p=>p.key===selected)||profiles[hashSeed(seed)%profiles.length];\n }

 function promptFor(seed){
  // Selección basada en los patrones de los vídeos con más reproducciones del canal:
  // zen/anti-estrés, concentración/estudio, sueño/relajación y estética celta/natural.
  const themes=[
   {
    key:'zen',
    prompt:'Photorealistic cinematic nature scene for a very long-form zen relaxation and meditation video: crystal-clear mountain lake, lush forest, soft sunrise mist, warm golden light, subtle water reflections, peaceful spa and wellness atmosphere, highly detailed natural landscape, wide 16:9 composition, no people, no buildings, no text, no logos, original scene'
   },
   {
    key:'focus',
    prompt:'Photorealistic cinematic peaceful nature landscape for concentration, studying and working: elegant Japanese-inspired garden beside a quiet lake, gentle morning light, green trees, soft mist, calm water, refined tranquil atmosphere, beautiful depth, wide 16:9 composition, no people, no buildings, no text, no logos, original scene'
   },
   {
    key:'sleep',
    prompt:'Photorealistic cinematic night nature landscape for deep sleep and relaxation: quiet lake surrounded by dark pine forest, moonlight reflected on still water, soft blue tones, faint mist, stars, dreamy peaceful atmosphere, wide 16:9 composition, no people, no buildings, no text, no logos, original scene'
   },
   {
    key:'celtic',
    prompt:'Photorealistic cinematic Celtic-inspired natural landscape for relaxing instrumental music: emerald valley, ancient forest, waterfall and river, distant misty mountains, soft overcast light, magical but realistic atmosphere, rich greens, wide 16:9 composition, no people, no buildings, no text, no logos, original scene'
   },
   {
    key:'spa',
    prompt:'Photorealistic cinematic tropical spa landscape for relaxation and meditation: tranquil turquoise lagoon, smooth stones, lush palms and rainforest, soft sunrise, gentle water movement, warm natural light, luxurious peaceful wellness atmosphere, wide 16:9 composition, no people, no buildings, no text, no logos, original scene'
   },
   {
    key:'rain',
    prompt:'Photorealistic cinematic rainy forest for sleep and anxiety relief: lush green woodland, slow river, small waterfall, soft rainfall, atmospheric fog, muted natural colors, intimate peaceful mood, realistic water droplets, wide 16:9 composition, no people, no buildings, no text, no logos, original scene'
   }
  ];
  return themes[hashSeed(seed)%themes.length];
 }

 function writeYouTubeWav(out,seconds,seed){
  const sr=44100,dur=Math.min(300,Math.max(60,seconds)),n=sr*dur;
  const b=Buffer.alloc(44+n*4);
  b.write('RIFF',0);b.writeUInt32LE(36+n*4,4);b.write('WAVE',8);
  b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(2,22);
  b.writeUInt32LE(sr,24);b.writeUInt32LE(sr*4,28);b.writeUInt16LE(4,32);b.writeUInt16LE(16,34);
  b.write('data',36);b.writeUInt32LE(n*4,40);
  const s=hashSeed(seed),profile=youtubeProfileFor(seed).key;
  const presets={
   'zen-piano':{roots:[130.81,164.81,196,261.63],scale:[0,2,4,7,9,11],lead:1},
   'ocean-meditation':{roots:[110,146.83,164.81,220],scale:[0,2,4,7,9,12],lead:2},
   'focus-piano':{roots:[130.81,164.81,196,246.94],scale:[0,2,4,7,9,11],lead:1},
   'celtic-flute':{roots:[146.83,196,220,293.66],scale:[0,3,5,7,10,12],lead:3},
   'deep-sleep':{roots:[98,123.47,146.83,196],scale:[0,2,3,7,9,10],lead:1},
   'spa-water':{roots:[110,138.59,164.81,220],scale:[0,2,4,7,9,11],lead:1},
   'rain-piano':{roots:[110,146.83,164.81,220],scale:[0,2,3,7,9,10],lead:1},
   'forest-flute':{roots:[130.81,164.81,196,261.63],scale:[0,3,5,7,10,12],lead:3},
   'sunset-piano':{roots:[110,146.83,174.61,220],scale:[0,2,4,7,9,11],lead:1},
   'river-meditation':{roots:[123.47,164.81,196,246.94],scale:[0,2,4,7,9,12],lead:2},
   'cabin-rain':{roots:[98,130.81,164.81,196],scale:[0,2,3,7,9,10],lead:1},
   'desert-calm':{roots:[110,146.83,164.81,220],scale:[0,2,4,7,9,11],lead:2}
  };
  const p=presets[profile]||presets['zen-piano'];
  for(let i=0;i<n;i++){
   const t=i/sr;let l=0,r=0;
   for(let j=0;j<p.roots.length;j++){
    const f=p.roots[j],swell=.72+.28*Math.sin(2*Math.PI*t/(54+j*9));
    const level=.0105/(j+1)*swell;
    l+=level*(Math.sin(2*Math.PI*f*t)+.16*Math.sin(2*Math.PI*f*2*t+.4));
    r+=level*(Math.sin(2*Math.PI*f*t+.025)+.14*Math.sin(2*Math.PI*f*2*t+.45));
   }
   const bar=Math.floor(t/8),within=t-bar*8,idx=(bar*2+(s%p.scale.length))%p.scale.length;
   const midi=57+p.scale[idx]+(p.lead===1&&bar%4===3?12:0),nf=440*Math.pow(2,(midi-69)/12);
   if(within<5.5){
    const env=Math.exp(-within*.72)*(1-Math.exp(-within*9));
    const piano=Math.sin(2*Math.PI*nf*t)+.30*Math.sin(2*Math.PI*nf*2*t)+.10*Math.sin(2*Math.PI*nf*3*t);
    l+=.034*env*piano;r+=.034*env*(piano*.94+.06*Math.sin(2*Math.PI*nf*1.002*t));
   }
   const leadF=p.roots[(Math.floor(t/32)+p.lead)%p.roots.length]*2;
   const leadEnv=.0035*(.5+.5*Math.sin(2*Math.PI*t/32));
   l+=leadEnv*(Math.sin(2*Math.PI*leadF*t)+.10*Math.sin(2*Math.PI*leadF*2*t));
   r+=leadEnv*(Math.sin(2*Math.PI*leadF*t+.018)+.10*Math.sin(2*Math.PI*leadF*2*t));
   if(profile==='ocean-meditation'||profile==='rain-piano'||profile==='cabin-rain'){
    const tex=.0012*(.5+.5*Math.sin(2*Math.PI*t/(profile==='ocean-meditation'?7.5:5.2)));
    l+=tex*Math.sin(2*Math.PI*34*t);r+=tex*Math.sin(2*Math.PI*36*t+.2);
   }
   const pan=.5+.5*Math.sin(2*Math.PI*t/71),mid=(l+r)*.5,side=(l-r)*.5;
   l=mid+side*(.55+.45*pan);r=mid-side*(.55+.45*(1-pan));
   l=Math.max(-.38,Math.min(.38,l));r=Math.max(-.38,Math.min(.38,r));
   const pos=44+i*4;b.writeInt16LE(Math.round(l*32767),pos);b.writeInt16LE(Math.round(r*32767),pos+2);
  }
  fs.writeFileSync(out,b);
 }

 function writeWav(out,seconds,seed){
  // Arquitectura sonora inspirada en los patrones observados en los vídeos más vistos:
  // cama ambiental + piano/arpio sintético muy suave + textura de flauta/cuerdas +
  // naturaleza abstracta. Es original y no utiliza ni copia las grabaciones del canal.
  const sr=44100, dur=Math.min(300,Math.max(60,seconds)), n=sr*dur;
  const channels=2, bytesPerSample=2;
  const b=Buffer.alloc(44+n*channels*bytesPerSample);
  b.write('RIFF',0);b.writeUInt32LE(36+n*channels*bytesPerSample,4);b.write('WAVE',8);
  b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(channels,22);
  b.writeUInt32LE(sr,24);b.writeUInt32LE(sr*channels*bytesPerSample,28);
  b.writeUInt16LE(channels*bytesPerSample,32);b.writeUInt16LE(16,34);
  b.write('data',36);b.writeUInt32LE(n*channels*bytesPerSample,40);

  const s=hashSeed(seed), theme=s%6;
  // El audio usa exactamente el mismo índice temático que promptFor(seed),
  // para que paisaje, iluminación y música pertenezcan al mismo ambiente.
  const roots=[[110,132,165,220],[100,120,150,200],[90,108,135,180],[120,144,180,240],[104,130,156,208],[82,98,123,164]][theme];
  const phases=roots.map((_,i)=>((s+i*97)%1000)/1000*Math.PI*2);
  const scale=theme===3?[0,3,5,7,10,12]:theme===5?[0,2,3,7,9,10]:[0,2,4,7,9,11];
  const ambience=[[.0025,7.5],[.0020,10],[.0017,12],[.0014,15],[.0011,20]];

  for(let i=0;i<n;i++){
    const t=i/sr;
    let l=0,r=0;

    // 1) Cama armónica continua, muy discreta.
    for(let j=0;j<roots.length;j++){
      const f=roots[j];
      const swell=.72+.28*Math.sin(2*Math.PI*t/(60+j*12));
      const tone=Math.sin(2*Math.PI*f*t+phases[j]);
      const airy=Math.sin(2*Math.PI*f*2*t+phases[j]*.7);
      const level=.009/(j+1)*swell;
      l+=level*tone+.0015*airy/(j+1);
      r+=level*Math.sin(2*Math.PI*f*t+phases[j]+.035)+.0015*Math.sin(2*Math.PI*f*2*t+phases[j]*.7+.05)/(j+1);
    }

    // 2) "Piano/harpa": pequeñas notas espaciadas, sin convertirse en una canción.
    // El patrón se repite a los 300 s y cambia según la semilla.
    const bar=Math.floor(t/12), within=t-bar*12;
    const noteIndex=(bar+(s%7))%scale.length;
    const midi=57+scale[noteIndex]+(theme===2? -12:0);
    const nf=440*Math.pow(2,(midi-69)/12);
    if(within<4.8){
      const env=Math.exp(-within*(theme===1?.95:1.25))*(1-Math.exp(-within*8));
      const pluck=Math.sin(2*Math.PI*nf*t)+.32*Math.sin(2*Math.PI*nf*2*t)+.12*Math.sin(2*Math.PI*nf*3*t);
      const shimmer=Math.sin(2*Math.PI*nf*1.003*t);
      l+=.020*env*pluck;
      r+=.020*env*(pluck*.88+shimmer*.12);
    }

    // 3) Capa sostenida tipo flauta/cuerda, respirando lentamente.
    const phrase=Math.sin(2*Math.PI*t/36);
    const fluteF=roots[(Math.floor(t/36)+theme)%roots.length]*2;
    const fluteEnv=.0045*(.5+.5*phrase);
    const flute=Math.sin(2*Math.PI*fluteF*t)+.12*Math.sin(2*Math.PI*fluteF*2*t);
    l+=fluteEnv*flute;
    r+=fluteEnv*Math.sin(2*Math.PI*fluteF*t+.018)+.0005*Math.sin(2*Math.PI*fluteF*2*t);

    // 4) Campanas/resonancias muy lejanas y poco frecuentes.
    const pulse=Math.pow(Math.max(0,Math.sin(2*Math.PI*t/19)),14);
    const shimmer=Math.pow(Math.max(0,Math.sin(2*Math.PI*t/43+1.1)),20);
    l+=.0038*pulse*Math.sin(2*Math.PI*roots[0]*3*t);
    r+=.0038*pulse*Math.sin(2*Math.PI*roots[0]*3*t+.04);
    l+=.0022*shimmer*Math.sin(2*Math.PI*roots[1]*3.5*t);
    r+=.0022*shimmer*Math.sin(2*Math.PI*roots[1]*3.5*t+.05);

    // 5) Textura de aire/agua abstracta, periódica para que el bloque de 5 min cierre bien.
    for(const [level,period] of ambience){
      const a=Math.sin(2*Math.PI*t/period+phases[0]);
      const b2=Math.sin(2*Math.PI*t/(period*1.5)+phases[1]);
      l+=level*(a*.65+b2*.35);
      r+=level*(a*.65+b2*.35);
    }

    // Estéreo lento y muy suave.
    const pan=.5+.5*Math.sin(2*Math.PI*t/73);
    const mid=(l+r)*.5, side=(l-r)*.5;
    l=mid+side*(.55+.45*pan);
    r=mid-side*(.55+.45*(1-pan));

    l=Math.max(-.35,Math.min(.35,l));
    r=Math.max(-.35,Math.min(.35,r));
    const pos=44+i*4;
    b.writeInt16LE(Math.round(l*32767),pos);
    b.writeInt16LE(Math.round(r*32767),pos+2);
  }
  fs.writeFileSync(out,b);
 }

 async function createYouTubeThumbnail(image,out,title,profileKey){
  const labels={
   'zen-piano':['MÚSICA ZEN RELAJANTE','CALMA · MEDITACIÓN · ANTI ESTRÉS'],
   'ocean-meditation':['MÚSICA PARA MEDITAR','OCÉANO · CALMA · RELAJACIÓN'],
   'focus-piano':['MÚSICA PARA ESTUDIAR','CONCENTRACIÓN · TRABAJO · ESTUDIO'],
   'celtic-flute':['MÚSICA CELTA RELAJANTE','FLAUTA · NATURALEZA · RELAJACIÓN'],
   'deep-sleep':['MÚSICA PARA DORMIR','SUEÑO PROFUNDO · CALMA · DESCANSO'],
   'spa-water':['MÚSICA RELAJANTE SPA','YOGA · MEDITACIÓN · BIENESTAR'],
   'rain-piano':['MÚSICA PARA RELAJARSE','LLUVIA · PIANO · NATURALEZA'],
   'forest-flute':['MÚSICA DE BOSQUE','FLAUTA · MEDITACIÓN · NATURALEZA'],
   'sunset-piano':['PIANO RELAJANTE','ATARDECER · CALMA · NATURALEZA'],
   'river-meditation':['MÚSICA PARA MEDITAR','RÍO · NATURALEZA · CALMA'],
   'cabin-rain':['MÚSICA PARA DORMIR','LLUVIA · BOSQUE · DESCANSO'],
   'desert-calm':['MÚSICA PARA MEDITAR','OASIS · CALMA · RELAJACIÓN']
  };
  const pair=labels[profileKey]||labels['zen-piano'];
  const esc=v=>String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
  const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".08"/><stop offset="1" stop-color="#000" stop-opacity=".72"/></linearGradient></defs><rect width="1280" height="720" fill="url(#g)"/><rect x="42" y="34" width="240" height="48" rx="24" fill="#000" fill-opacity=".42"/><text x="162" y="67" text-anchor="middle" font-family="DejaVu Sans,Arial,sans-serif" font-size="25" font-weight="700" fill="white">RELAXSCAPE</text><text x="52" y="535" font-family="DejaVu Sans,Arial,sans-serif" font-size="48" font-weight="700" fill="white">'+esc(pair[0])+'</text><text x="52" y="588" font-family="DejaVu Sans,Arial,sans-serif" font-size="23" font-weight="500" fill="white">'+esc(pair[1])+'</text></svg>');
  await sharp(image).resize(1280,720,{fit:'cover'}).composite([{input:svg,blend:'over'}]).jpeg({quality:90,mozjpeg:true}).toFile(out);
  return out;
 }
 async function makeVideo({durationMinutes=60,seed='daily',youtubeMode=false,onProgress}){
  const minutes=Math.max(1,Math.min(1440,Number(durationMinutes)||60)),seconds=Math.max(60,minutes*60);
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const image=path.join(TEMP_DIR,'daily-'+stamp+'.img'),aud=path.join(TEMP_DIR,'daily-'+stamp+'.wav');
  const out=path.join(VIDEO_DIR,'daily-'+stamp+'.mp4');
  try{
   if(youtubeMode)await refreshMusicoterapiaTrends();
   const theme=youtubeMode?youtubeProfileFor(seed):promptFor(seed);
   const prompt=theme.prompt;
   const progress=(p,m)=>{if(typeof onProgress==='function')onProgress(p,m);};
   progress(20,'Preparando paisaje…');
   let imageInfo= youtubeMode?await downloadYouTubeLandscape(image,seed):await generateFreeAIImage(image,prompt,seed);
   if(!imageInfo)imageInfo=await downloadLandscape(image,seed);
   progress(40,'Paisaje preparado.');
   const segmentSeconds=Math.min(seconds,300);
   let audioInfo=null;
   if(youtubeMode)audioInfo=await generateAceStep(aud,seed,segmentSeconds,(p,m)=>progress(p,m));
   if(!audioInfo){progress(70,'Creando audio relajante local…');if(youtubeMode)writeYouTubeWav(aud,segmentSeconds,seed);else writeWav(aud,segmentSeconds,seed);}
   progress(75,'Montando vídeo…');
   // El motor YouTube genera un bloque musical largo y coherente que se repite solo
   // después de varios minutos, evitando bucles cortos y artificiales.
   const segment=path.join(TEMP_DIR,'segment-'+stamp+'.mp4');
   try{
    await ff(['-y','-loop','1','-framerate','10','-i',image,'-i',aud,'-t',String(segmentSeconds),
      '-map','0:v:0','-map','1:a:0',
      '-vf','scale=1920:1080:force_original_aspect_ratio=increase:flags=lanczos,crop=1920:1080,unsharp=5:5:0.35:5:5:0.15,format=yuv420p',
      '-r','10','-c:v','libx264','-preset','ultrafast','-crf','24','-threads','2','-pix_fmt','yuv420p',
      '-c:a','aac','-b:a','160k','-ar','44100','-ac','2','-movflags','+faststart',segment]);
    await ff(['-y','-stream_loop','-1','-i',segment,'-t',String(seconds),
      '-map','0:v:0','-map','0:a:0','-c','copy','-movflags','+faststart',out]);
   }finally{clean(segment);}
   progress(96,'Comprobando vídeo final…');
   const titles={
    zen:['Música Zen para Relajarse y Calmar la Mente · Naturaleza y Meditación','Relajación Profunda · Música Zen y Paisajes Naturales','Música Relajante para Reducir el Estrés · Zen y Naturaleza'],
    focus:['Música para Estudiar y Concentrarse · Paisaje Natural Relajante','Música Relajante para Trabajar, Estudiar y Concentrarse','Concentración Profunda · Música Ambiental y Naturaleza'],
    sleep:['Música para Dormir Profundamente · Noche Tranquila y Naturaleza','Sueño Profundo · Música Relajante con Paisaje Nocturno','Música Relajante para Dormir · Calma, Noche y Naturaleza'],
    celtic:['Música Celta Relajante · Flauta, Naturaleza y Montañas','Música Celta para Relajarse · Bosque, Río y Montañas','Música Instrumental Celta · Relajación y Naturaleza'],
    spa:['Música para Meditación y Spa · Agua, Naturaleza y Relajación','Relajación Profunda · Música de Spa y Paisajes Naturales','Música Relajante para Meditar · Naturaleza y Agua'],
    rain:['Sonidos de Lluvia y Música Relajante · Bosque para Dormir','Lluvia en el Bosque · Música para Dormir y Relajarse','Música Relajante con Lluvia · Calma y Sueño Profundo']
   };
   const youtubeTitles={
    'zen-piano':['Música Zen Relajante para Calmar la Mente · Paisaje de Montaña','Música Relajante de Piano y Naturaleza · Meditación Profunda','Música Zen para Reducir el Estrés · Lago, Montañas y Piano'],
    'ocean-meditation':['Música Relajante con Olas del Mar · Meditación y Calma','Música para Yoga y Meditación · Mar Tranquilo y Piano','Sonidos del Mar y Música Relajante · Paz, Calma y Descanso'],
    'focus-piano':['Música para Estudiar, Trabajar y Concentrarse · Piano y Naturaleza','Música Relajante para Concentración · Estudio y Trabajo','Música Ambiental para Estudiar · Piano Suave y Paisaje Natural'],
    'celtic-flute':['Música Celta Relajante · Flauta, Bosque y Montañas','Música Celta Instrumental para Relajarse · Naturaleza y Río','Flauta Celta y Paisajes Naturales · Música para Meditar'],
    'deep-sleep':['Música para Dormir Profundamente · Noche, Lago y Relajación','Música Relajante para Dormir · Sueño Profundo y Naturaleza','Música para Dormir y Descansar · Paisaje Nocturno y Calma'],
    'spa-water':['Música Relajante para Spa, Yoga y Meditación · Agua y Naturaleza','Música de Spa para Relajarse · Cascada, Bosque y Calma','Meditación Profunda · Música Relajante y Paisaje Natural'],
    'rain-piano':['Música Relajante con Lluvia y Piano · Bosque para Dormir','Lluvia en el Bosque · Piano Suave para Relajarse','Música para Dormir con Lluvia · Naturaleza y Calma'],
    'forest-flute':['Flauta y Bosque · Música Relajante para Meditar','Música de Naturaleza con Flauta · Relajación Profunda','Música para Meditar · Bosque, Flauta y Naturaleza'],
    'sunset-piano':['Piano Relajante al Atardecer · Música para Calmar la Mente','Música de Piano para Relajarse · Lago y Puesta de Sol','Atardecer en las Montañas · Piano y Naturaleza'],
    'river-meditation':['Música para Meditar con Río y Naturaleza · Calma Profunda','Meditación y Relajación · Río, Bosque y Música Suave','Música Relajante para Respirar y Meditar · Paisaje Natural'],
    'cabin-rain':['Música para Dormir con Lluvia · Bosque y Cabaña','Lluvia Nocturna y Piano · Música para Dormir Profundamente','Relajación Profunda · Lluvia, Bosque y Música Suave'],
    'desert-calm':['Música para Meditar en un Oasis · Calma y Relajación','Meditación Profunda · Oasis, Piano y Naturaleza','Música Relajante para Yoga y Respiración · Paisaje de Oasis']
   };
   const titleOptions=(youtubeMode?youtubeTitles[theme.key]:titles[theme.key])||titles.zen;
   const thumbnailName='thumb-'+path.basename(out,'.mp4')+'.jpg';
   const thumbnail=path.join(VIDEO_DIR,thumbnailName);
   if(youtubeMode)await createYouTubeThumbnail(image,thumbnail,titleOptions[0],theme.key);
   const descriptions={
    'zen-piano':'Música zen relajante para calmar la mente y reducir el estrés. Un paisaje de montaña y lago acompañado de piano suave y armonías ambientales para meditación, descanso, yoga y momentos de tranquilidad. 🌿\\n\\n🎧 Escucha con auriculares para disfrutar de la atmósfera completa.\\n\\nEste vídeo ha sido creado originalmente por RelaxScape Studio mediante generación audiovisual y no utiliza grabaciones del canal Musicoterapia.',
    'ocean-meditation':'Música relajante para meditación, yoga y descanso, inspirada en la calma del mar. Piano delicado, flauta suave y una atmósfera lenta acompañan un paisaje natural de agua y amanecer. 🌊\\n\\nIdeal para relajación, respiración, meditación, yoga, ansiedad y descanso.\\n\\nContenido original creado por RelaxScape Studio.',
    'focus-piano':'Música ambiental para estudiar, trabajar y concentrarse. Piano suave, armonías continuas y un paisaje natural tranquilo crean un fondo sin distracciones para sesiones de concentración y lectura. 📚\\n\\nIdeal para estudio, trabajo, lectura, escritura y concentración profunda.\\n\\nContenido original creado por RelaxScape Studio.',
    'celtic-flute':'Música celta instrumental relajante con flauta, cuerdas suaves y paisajes naturales de bosque, río y montaña. Una atmósfera tranquila para meditar, descansar y desconectar. 🍃\\n\\nContenido original creado por RelaxScape Studio.',
    'deep-sleep':'Música extremadamente suave para dormir profundamente y descansar. Piano delicado, cuerdas ambientales y un paisaje nocturno crean una atmósfera lenta y continua para el sueño. 🌙\\n\\nRecomendado para dormir, relajarse y crear un ambiente tranquilo antes de acostarse.\\n\\nContenido original creado por RelaxScape Studio.',
    'spa-water':'Música relajante para spa, yoga y meditación con piano, flauta y una atmósfera natural inspirada en agua, cascadas y naturaleza tropical. 💧\\n\\nIdeal para masaje, spa, meditación, yoga, respiración y descanso.\\n\\nContenido original creado por RelaxScape Studio.'
   };
   const description=youtubeMode?(descriptions[theme.key]||'Música relajante y paisaje natural creados originalmente por RelaxScape Studio.'):'Vídeo original de RelaxScape Studio con música ambiental y paisaje natural. Ideal para relajación, meditación, estudio o descanso.';
   return {url:'/media/videos/'+path.basename(out),name:path.basename(out),durationMinutes:minutes,thumbnailUrl:youtubeMode?'/media/videos/'+encodeURIComponent(thumbnailName):null,
    generatedImage:true,imageProvider:imageInfo.provider,reference:youtubeMode?'Musicoterapia · patrones de vídeos más vistos':'@musicoterapiateam',storedInLibrary:false,paidApis:false,
    aiImage:imageInfo.provider.includes('FLUX'),theme:theme.key,title:titleOptions[0],titleOptions,
    description,tags:['música relajante','relajación','meditación','naturaleza','sleep','ambient','calma']};
  }finally{clean(image);clean(aud);}
 }

 app.post('/api/daily-video-now',async(req,res)=>{
  const id='daily-'+Date.now();jobs.set(id,{status:'running',progress:5,message:'Preparando generación gratuita...'});res.json({jobId:id,status:'running'});
  try{
   jobs.set(id,{status:'running',progress:25,message:'Generando paisaje IA gratuito...'});
   const result=await makeVideo({durationMinutes:req.body?.durationMinutes||60,seed:id,youtubeMode:req.body?.youtubeMode===true,onProgress:(progress,message)=>jobs.set(id,{status:'running',progress,message})});
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
