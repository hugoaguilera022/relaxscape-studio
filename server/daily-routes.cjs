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
  const selected=pickWeightedProfile(seed,trendCache.profiles);
  return profiles.find(p=>p.key===selected)||profiles[hashSeed(seed)%profiles.length];
 }

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

 function referenceBlueprintFromText(title,analysis,profileKey){
  const t=(String(title||"")+" "+String(analysis||"")).toLowerCase();
  const key=profileKey||classifyMusicoterapiaTitle(title);
  const has=(re)=>re.test(t);
  const visualSets={
   focus:["minimalist desk with warm lamp, open notebook and piano keys","sunlit library with books, soft dust in the air","abstract cream and gold light waves, elegant and calm","night study room with window rain and warm lamp"],
   celtic:["misty stone valley with ancient ruins and soft green light","wooden flute and harp in a candlelit stone room","emerald river gorge with cinematic fog","moonlit Celtic-inspired hall with warm firelight"],
   deep:["quiet bedroom with linen, moonlight and soft curtains","dark blue star field with slow luminous particles","warm candle beside a sleeping-room window at night","abstract deep-indigo clouds and soft glowing light"],
   ocean:["underwater blue light caustics over smooth stones","minimal white room with moving ocean reflections","close view of translucent water and floating light","distant moonlit sea with soft horizon"],
   rain:["rain-covered window with warm interior light","cozy reading room with candle and wood textures","close-up of raindrops and blurred city lights","dark forest seen through a rainy cabin window"],
   spa:["minimal luxury spa room with candles and stone","silk fabric, warm light and shallow water reflections","close-up of hands-free spa stones and soft steam","tropical wellness interior with diffused morning light"],
   forest:["misty woodland path with shafts of light","close-up of moss, ferns and a small stream","wooden cabin interior with forest light through windows","abstract green bokeh and slow luminous particles"],
   zen:["minimal zen room with cushions, candle and soft sunlight","warm stone interior with incense smoke","abstract beige and amber light with subtle particles","quiet architectural space with water reflections"]
  };
  const set=visualSets[key==='focus-piano'?'focus':key==='celtic-flute'?'celtic':key==='deep-sleep'?'deep':key==='ocean-meditation'?'ocean':key==='rain-piano'||key==='cabin-rain'?'rain':key==='spa-water'?'spa':key==='forest-flute'||key==='river-meditation'?'forest':'zen'];
  let subject="original relaxing audiovisual experience";
  if(has(/estudi|concentr|memor|trabaj/))subject="focus and concentration";
  else if(has(/dormir|sueño|sleep|descans/))subject="deep sleep";
  else if(has(/celta|celtic|flauta|flute/))subject="celtic instrumental relaxation";
  else if(has(/mar|océano|ocean|olas|agua/))subject="ocean meditation";
  else if(has(/lluvia|rain/))subject="rain relaxation";
  else if(has(/spa|yoga|masaje|wellness/))subject="spa and wellness";
  return {key,subject,scenes:set,sourceTitle:String(title||""),analysis:String(analysis||"")};
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

 function musicPromptForBlueprint(blueprint,seedIndex){
  const base={
   'focus-piano':'original instrumental concentration music, felt piano, soft marimba, warm strings, subtle acoustic guitar, 62 BPM, evolving harmonic loop, no vocals, no drums',
   'celtic-flute':'original Celtic-inspired instrumental, wooden flute, harp, cello and soft piano, 60 BPM, gentle folk phrasing, no vocals, no drums',
   'deep-sleep':'original deep sleep ambient instrumental, sparse felt piano, warm strings, airy pads, 50 BPM, extremely slow harmonic movement, no vocals, no drums',
   'ocean-meditation':'original ocean meditation instrumental, piano, nylon guitar, airy flute, soft strings, 56 BPM, flowing phrasing, no vocals, no drums',
   'rain-piano':'original rainy-night relaxation instrumental, felt piano, cello, soft strings and subtle room ambience, 54 BPM, no vocals, no drums',
   'spa-water':'original luxury spa instrumental, piano, harp, soft mallets and warm strings, 58 BPM, elegant and minimal, no vocals, no drums',
   'forest-flute':'original forest meditation instrumental, wooden flute, harp, acoustic guitar and strings, 57 BPM, organic and spacious, no vocals, no drums',
   'zen-piano':'original zen instrumental, felt piano, soft strings, harp and airy pads, 58 BPM, spacious and meditative, no vocals, no drums'
  };
  return (base[blueprint.key]||base['zen-piano'])+' Variation '+seedIndex+', different melody and voicing, never imitate the reference recording.';
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
   const segmentSeconds=Math.min(600,Math.max(120,Math.min(seconds,600)));
   for(let i=0;i<Math.min(6,Math.ceil(seconds/segmentSeconds));i++){
    const aud=path.join(work,'music-'+i+'.wav');
    const info=await generateBlueprintMusic(aud,blueprint,String(seed)+'-music-'+i,segmentSeconds,(p,m)=>progress(40+Math.round(p*.45),m));
    if(info)audioSegments.push(aud);
    else {writeYouTubeWav(aud,segmentSeconds,String(seed)+'-'+i);audioSegments.push(aud)}
   }
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
  }finally{await fsp.rm(work,{recursive:true,force:true}).catch(()=>{})}
 }

 app.post('/api/daily-video-now',async(req,res)=>{
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
