const path=require('path');
const fs=require('fs');
const {spawn}=require('child_process');

module.exports=function registerDailyRoutes(app){
 const ROOT=path.resolve(process.cwd());
 const VIDEO_DIR=path.join(ROOT,'data/videos');
 const TEMP_DIR=path.join(ROOT,'data/daily-temp');
 fs.mkdirSync(VIDEO_DIR,{recursive:true});
 fs.mkdirSync(TEMP_DIR,{recursive:true});
 const jobs=new Map();

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
  // La imagen se selecciona por el MISMO perfil que controla la música.
  // Así evitamos combinaciones incoherentes (por ejemplo mar + música celta).
  const profiles={
   'zen-piano':[
    'https://images.unsplash.com/photo-1500534623283-312aade485b7?auto=format&fit=crop&w=2400&q=92',
    'https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=2400&q=92'
   ],
   'ocean-meditation':[
    'https://images.unsplash.com/photo-1439853949127-fa647821eba0?auto=format&fit=crop&w=2400&q=92',
    'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=2400&q=92'
   ],
   'focus-piano':[
    'https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=2400&q=92',
    'https://images.unsplash.com/photo-1511497584788-876760111969?auto=format&fit=crop&w=2400&q=92'
   ],
   'celtic-flute':[
    'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=2400&q=92',
    'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=2400&q=92'
   ],
   'deep-sleep':[
    'https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=2400&q=92',
    'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=2400&q=92'
   ],
   'spa-water':[
    'https://images.unsplash.com/photo-1500534623283-312aade485b7?auto=format&fit=crop&w=2400&q=92',
    'https://images.unsplash.com/photo-1439853949127-fa647821eba0?auto=format&fit=crop&w=2400&q=92'
   ]
  };
  const keys=Object.keys(profiles),profile=youtubeProfileFor(seed),urls=profiles[profile.key]||profiles['zen-piano'];
  const url=urls[hashSeed(seed)%urls.length];
  const r=await fetch(url,{signal:AbortSignal.timeout(30000)});
  if(!r.ok)throw Error('No se pudo descargar el paisaje YouTube (HTTP '+r.status+').');
  const b=Buffer.from(await r.arrayBuffer());if(b.length<10000)throw Error('Paisaje YouTube no válido.');
  fs.writeFileSync(out,b);return {provider:'Unsplash · fotografía real coherente con el perfil',sourceUrl:url,profile:profile.key};
 }

 async function generateAceStep(out,seed,seconds){
  // ACE-Step 1.5: API pública del Space oficial de Hugging Face.
  // Permite piezas mucho más largas y coherentes que MusicGen y tiene licencia MIT.
  const base='https://ace-step-v1-5.hf.space';
  const prompts={
   'zen-piano':'instrumental zen meditation music, soft expressive piano as the main instrument, gentle warm strings, very subtle acoustic guitar, slow 58 BPM, spacious long notes, peaceful mountain lake at sunrise, serene spa atmosphere, emotional but minimal, no vocals, no drums, no percussion, no beat, no electronic sounds',
   'ocean-meditation':'instrumental ocean meditation music, delicate piano and airy flute, very soft acoustic guitar, slow 56 BPM, flowing sustained harmony, gentle waves atmosphere, peaceful turquoise sea and quiet beach at sunrise, soothing yoga and relaxation mood, no vocals, no drums, no percussion, no beat',
   'focus-piano':'instrumental concentration and study music, beautiful soft piano melody, warm sustained pads, subtle acoustic guitar, slow 62 BPM, repetitive but evolving harmonic flow, calm Japanese garden and still lake atmosphere, sophisticated peaceful background music, no vocals, no drums, no percussion, no electronic beat',
   'celtic-flute':'instrumental relaxing Celtic-inspired music, emotional wooden flute as the main instrument, soft piano and gentle strings underneath, slow 60 BPM, flowing melody, emerald forest, river and misty mountains atmosphere, natural acoustic character, peaceful and cinematic, no vocals, no drums, no percussion',
   'deep-sleep':'instrumental deep sleep music, extremely gentle felt piano, long soft notes, warm airy strings, distant flute tones, very slow 50 BPM, minimal melody, blue-hour mountain lake and moonlight atmosphere, dreamy continuous relaxation, no vocals, no drums, no percussion, no beat',
   'spa-water':'instrumental luxury spa relaxation music, delicate piano, soft marimba-like mallets, airy flute and warm strings, slow 58 BPM, flowing water and tropical lagoon atmosphere, elegant wellness and meditation mood, peaceful and spacious, no vocals, no drums, no percussion, no electronic beat'
  };
  const profile=youtubeProfileFor(seed),caption=prompts[profile.key]||prompts['zen-piano'];
  const duration=Math.min(600,Math.max(120,Number(seconds)||300));
  let submit;
  try{
   submit=await fetch(base+'/v1/music/generate',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({caption,lyrics:'[Instrumental]',thinking:true,instrumental:true,audio_duration:duration,audio_format:'mp3',model:'acestep-v15-turbo',inference_steps:8,batch_size:1,use_random_seed:false,seed:hashSeed(seed)}),
    signal:AbortSignal.timeout(30000)
   });
  }catch{return null;}
  if(!submit.ok)return null;
  const job=await submit.json().catch(()=>null),jobId=job?.job_id;if(!jobId)return null;
  const deadline=Date.now()+Math.max(300000,duration*1500);
  try{
   while(Date.now()<deadline){
    const r=await fetch(base+'/v1/jobs/'+encodeURIComponent(jobId),{signal:AbortSignal.timeout(30000)});
    if(!r.ok)return null;
    const j=await r.json().catch(()=>null);
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
    await new Promise(resolve=>setTimeout(resolve,5000));
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
  // Perfiles originales construidos a partir de patrones descriptivos de los vídeos
  // con más reproducciones de Musicoterapia: zen/anti-estrés, estudio/concentración,
  // meditación con mar/agua, piano, flauta celta, sueño y paisajes naturales.
  const profiles=[
   {key:'zen-piano',prompt:'Photorealistic cinematic wide landscape for a long-form zen relaxation video: vast turquoise mountain lake, layered pine mountains, soft dawn mist, warm peach and gold sunrise, mirror reflections, elegant tranquil wellness mood, lush natural detail, cinematic depth, no people, no buildings, no text, no logos, original scene'},
   {key:'ocean-meditation',prompt:'Photorealistic cinematic ocean meditation landscape: quiet turquoise sea meeting a secluded rocky beach, gentle rolling waves, distant cliffs, soft sunrise haze, luminous sky, peaceful premium wellness aesthetic, realistic water reflections, wide 16:9 composition, no people, no buildings, no text, no logos, original scene'},
   {key:'focus-piano',prompt:'Photorealistic cinematic landscape designed for long study and concentration music: serene Japanese-inspired garden beside a still lake, elegant trees, distant mountains, early morning light, subtle fog, balanced composition, refined calm atmosphere, natural greens and blue tones, wide 16:9, no people, no buildings, no text, no logos, original scene'},
   {key:'celtic-flute',prompt:'Photorealistic cinematic Celtic-inspired nature panorama: emerald valley, ancient mossy forest, winding river and waterfall, dramatic misty mountains, soft cloudy daylight, rich deep greens, mystical but completely realistic natural scenery, beautiful depth, wide 16:9, no people, no buildings, no text, no logos, original scene'},
   {key:'deep-sleep',prompt:'Photorealistic cinematic deep-sleep landscape: still mountain lake at blue hour, dark pine forest, moonlight path across the water, faint stars, soft low fog, deep navy and silver tones, extremely peaceful premium relaxation aesthetic, wide 16:9, no people, no buildings, no text, no logos, original scene'},
   {key:'spa-water',prompt:'Photorealistic cinematic luxury nature spa landscape: clear tropical lagoon, smooth river stones, waterfall, lush rainforest and palms, soft golden morning light, gentle mist, serene meditation and massage atmosphere, realistic textures, wide 16:9, no people, no buildings, no text, no logos, original scene'}
  ];
  return profiles[hashSeed(seed)%profiles.length];
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
  const sr=44100,dur=Math.min(300,Math.max(60,seconds)),n=sr*dur,channels=2;
  const b=Buffer.alloc(44+n*channels*2);
  b.write('RIFF',0);b.writeUInt32LE(36+n*channels*2,4);b.write('WAVE',8);
  b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(2,22);
  b.writeUInt32LE(sr,24);b.writeUInt32LE(sr*4,28);b.writeUInt16LE(4,32);b.writeUInt16LE(16,34);
  b.write('data',36);b.writeUInt32LE(n*4,40);
  const s=hashSeed(seed),profile=s%6;
  const roots=[[130.81,164.81,196,261.63],[110,146.83,164.81,220],[130.81,164.81,196,246.94],[146.83,196,220,293.66],[98,123.47,146.83,196],[110,138.59,164.81,220]][profile];
  const scales=[[0,2,4,7,9,11],[0,2,4,7,9,12],[0,2,4,7,9,11],[0,3,5,7,10,12],[0,2,3,7,9,10],[0,2,4,7,9,11]][profile];
  for(let i=0;i<n;i++){
   const t=i/sr;let l=0,r=0;
   for(let j=0;j<roots.length;j++){
    const f=roots[j],slow=.65+.35*Math.sin(2*Math.PI*t/(75+j*11));
    const a=Math.sin(2*Math.PI*f*t),bb=Math.sin(2*Math.PI*f*1.5*t+.7),level=.0105/(j+1)*slow;
    l+=level*(a+.18*bb);r+=level*(Math.sin(2*Math.PI*f*t+.025)+.16*bb);
   }
   const bar=Math.floor(t/12),within=t-bar*12,ni=(bar*2+(s%5))%scales.length,midi=57+scales[ni]+(profile===4?-12:0),nf=440*Math.pow(2,(midi-69)/12);
   if(within<7.5){
    const env=Math.exp(-within*.58)*(1-Math.exp(-within*5)),p=Math.sin(2*Math.PI*nf*t)+.27*Math.sin(2*Math.PI*nf*2*t)+.09*Math.sin(2*Math.PI*nf*3*t);
    l+=.030*env*p;r+=.030*env*(p*.92+Math.sin(2*Math.PI*nf*1.001*t)*.08);
   }
   const phrase=Math.sin(2*Math.PI*t/48),ff=roots[(Math.floor(t/48)+profile)%roots.length]*2,fe=.004*(.5+.5*phrase);
   l+=fe*(Math.sin(2*Math.PI*ff*t)+.11*Math.sin(2*Math.PI*ff*2*t));r+=fe*(Math.sin(2*Math.PI*ff*t+.018)+.10*Math.sin(2*Math.PI*ff*2*t));
   const wave=.5+.5*Math.sin(2*Math.PI*t/9.5+1.3),rain=.5+.5*Math.sin(2*Math.PI*t/5.7+2.1),water=.0018*wave*wave+.0012*rain*rain,ocean=profile===1?water*2.2:water;
   l+=ocean*(Math.sin(2*Math.PI*37*t)+.35*Math.sin(2*Math.PI*61*t));r+=ocean*(Math.sin(2*Math.PI*39*t+.4)+.35*Math.sin(2*Math.PI*63*t));
   const breath=.0018*(.5+.5*Math.sin(2*Math.PI*t/18));l+=breath*Math.sin(2*Math.PI*55*t);r+=breath*Math.sin(2*Math.PI*55*t+.03);
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

 async function createYouTubeThumbnail(image,out,title){
  const safe=String(title||'RelaxScape').replace(/[\\:\\[\\]\\']/g,'\\\\ async function makeVideo({durationMinutes=60,seed='daily',youtubeMode=false}){').replace(/%/g,'\\\\%').replace(/,/g,'\\\\,');
  await ff(['-y','-i',image,'-vf',
   "scale=1280:720:force_original_aspect_ratio=increase:flags=lanczos,crop=1280:720,drawbox=x=0:y=500:w=1280:h=220:color=black@0.48:t=fill,drawtext=text='"+safe+"':fontcolor=white:fontsize=46:font='Sans':x=50:y=560:box=0:shadowcolor=black@0.8:shadowx=2:shadowy=2",
   '-frames:v','1','-q:v','2',out]);
  return out;
 }

 async function makeVideo({durationMinutes=60,seed='daily',youtubeMode=false}){
  const minutes=Math.max(1,Math.min(1440,Number(durationMinutes)||60)),seconds=Math.max(60,minutes*60);
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const image=path.join(TEMP_DIR,'daily-'+stamp+'.img'),aud=path.join(TEMP_DIR,'daily-'+stamp+'.wav');
  const out=path.join(VIDEO_DIR,'daily-'+stamp+'.mp4');
  try{
   const theme=youtubeMode?youtubeProfileFor(seed):promptFor(seed);
   const prompt=theme.prompt;
   let imageInfo= youtubeMode?await downloadYouTubeLandscape(image,seed):await generateFreeAIImage(image,prompt,seed);
   if(!imageInfo)imageInfo=await downloadLandscape(image,seed);
   const segmentSeconds=Math.min(seconds,300);
   let audioInfo=null;
   if(youtubeMode)audioInfo=await generateAceStep(aud,seed,segmentSeconds);
   if(!audioInfo){if(youtubeMode)writeYouTubeWav(aud,segmentSeconds,seed);else writeWav(aud,segmentSeconds,seed);}
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
    'spa-water':['Música Relajante para Spa, Yoga y Meditación · Agua y Naturaleza','Música de Spa para Relajarse · Cascada, Bosque y Calma','Meditación Profunda · Música Relajante y Paisaje Natural']
   };
   const titleOptions=(youtubeMode?youtubeTitles[theme.key]:titles[theme.key])||titles.zen;
   const thumbnailName='thumb-'+path.basename(out,'.mp4')+'.jpg';
   const thumbnail=path.join(VIDEO_DIR,thumbnailName);
   if(youtubeMode)await createYouTubeThumbnail(image,thumbnail,titleOptions[0]);
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
   jobs.set(id,{status:'running',progress:55,message:'Creando audio relajante local...'});
   const result=await makeVideo({durationMinutes:req.body?.durationMinutes||60,seed:id,youtubeMode:req.body?.youtubeMode===true});
   jobs.set(id,{status:'succeeded',progress:100,message:'Vídeo terminado',result});
  }catch(e){console.error('[Daily free]',e);jobs.set(id,{status:'failed',progress:0,error:e.message||String(e)});}
 });
 app.get('/api/daily-video-status',async(req,res)=>res.json(jobs.get(String(req.query.jobId))||{status:'unknown'}));
 app.post('/api/daily-video-cron',async(req,res)=>{
  const secret=process.env.DAILY_CRON_SECRET;if(secret&&req.get('x-daily-secret')!==secret)return res.status(401).json({error:'Unauthorized'});
  try{const result=await makeVideo({durationMinutes:req.body?.durationMinutes||60,seed:new Date().toISOString().slice(0,10)});res.json({ok:true,result});}
  catch(e){res.status(500).json({ok:false,error:e.message});}
 });
};
