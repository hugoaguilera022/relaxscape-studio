(()=>{
  const $=s=>document.querySelector(s);
  const api=async(url,opt={})=>{const r=await fetch(url,opt);const t=await r.text();let d={};try{d=t?JSON.parse(t):{}}catch{};if(!r.ok)throw Error(d.error||`Error ${r.status}`);return d};
  const status=(msg,err=false)=>{const e=$('#dailyStatus');if(e){e.textContent=(err?'❌ ':'✓ ')+msg;e.classList.toggle('error',err)}};
  async function runNow(){
    const b=$('#runDailyNow');if(b)b.disabled=true;
    try{
      status('Iniciando el creador de MP4…');
      const d=await api('/api/daily-video-now',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({durationMinutes:Number($('#scheduleDuration')?.value||60)})});
      localStorage.setItem('relaxscape_daily_last_run',new Date().toISOString());
      if(!d.jobId)throw Error('El servidor no devolvió un trabajo de generación.');
      status('Vídeo diario en generación. Puedes dejar esta página abierta.');
      for(let i=0;i<240;i++){
        await new Promise(r=>setTimeout(r,3000));
        const j=await api('/api/daily-video-status?jobId='+encodeURIComponent(d.jobId));
        if(j.status==='succeeded'){
          status('✓ Vídeo terminado. Abriendo el MP4…');
          const v=j.result;
          const video=$('#video'),down=$('#download'),result=$('#result');
          if(video)video.src=v.url+'?v='+Date.now();
          if(down){down.href=v.url;down.download=v.name||'relaxscape-daily.mp4'}
          if(result)result.classList.remove('hidden');
          return;
        }
        if(j.status==='failed')throw Error(j.error||'La generación del MP4 falló.');
        status(`Generando MP4… ${Math.min(99,Math.round((i+1)/240*100))}%`);
      }
      throw Error('La generación está tardando más de lo esperado.');
    }catch(e){status(e.message||'No se pudo iniciar la generación.',true)}finally{if(b)b.disabled=false}
  }
  async function save(){
    const toggle=$('#scheduleToggle'),hour=$('#scheduleHour'),dur=$('#scheduleDuration');
    const cfg={enabled:!!toggle?.checked,hour:hour?.value||'07:00',duration:Number(dur?.value||1)};
    localStorage.setItem('relaxscape_daily_schedule',JSON.stringify(cfg));
    status(cfg.enabled?`Programación guardada: todos los días a las ${cfg.hour}.`:'Programación desactivada.');
  }
  function loadCfg(){try{const c=JSON.parse(localStorage.getItem('relaxscape_daily_schedule')||'null');if(!c)return;if($('#scheduleToggle'))$('#scheduleToggle').checked=!!c.enabled;if($('#scheduleHour'))$('#scheduleHour').value=c.hour||'07:00';if($('#scheduleDuration'))$('#scheduleDuration').value=String(c.duration||1)}catch{}}
  function scheduleLoop(){
    const cfg=(()=>{try{return JSON.parse(localStorage.getItem('relaxscape_daily_schedule')||'null')}catch{return null}})();
    if(!cfg?.enabled)return;
    const now=new Date(), target=new Date(now);const [h,m]=String(cfg.hour||'07:00').split(':').map(Number);target.setHours(h||0,m||0,0,0);
    if(target<=now)target.setDate(target.getDate()+1);
    const delay=Math.min(target-now,2147483647);
    setTimeout(async()=>{await runNow();setTimeout(scheduleLoop,3000)},delay);
    status(`Programado para ${target.toLocaleString('es-ES')}.`);
  }
  function init(){
    loadCfg();
    $('#runDailyNow')?.addEventListener('click',e=>{e.preventDefault();runNow()});
    $('#saveSchedule')?.addEventListener('click',e=>{e.preventDefault();save();scheduleLoop()});
    const toggle=$('#scheduleToggle');toggle?.addEventListener('change',()=>{save();scheduleLoop()});
    const saved=localStorage.getItem('relaxscape_daily_schedule');if(saved)scheduleLoop();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
