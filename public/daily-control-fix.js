(()=>{
  const $=s=>document.querySelector(s);
  const api=async(url,opt={})=>{const r=await fetch(url,opt);const t=await r.text();let d={};try{d=t?JSON.parse(t):{}}catch{};if(!r.ok)throw Error(d.error||`Error ${r.status}`);return d};
  const status=(msg,err=false)=>{const e=$('#dailyStatus');if(e){e.innerHTML=(err?'❌ ':'✓ ')+msg;e.classList.toggle('error',err)}};
  const fmt=(s)=>{s=Math.max(0,Math.round(Number(s)||0));if(s<60)return `${s}s`;const m=Math.floor(s/60),sec=s%60;return sec?`${m} min ${sec}s`:`${m} min`};
  async function runNow(){
    const b=$('#runDailyNow');if(b)b.disabled=true;
    const started=Date.now();
    const renderProgress=(percent,message,estimated)=>{
      const p=Math.max(0,Math.min(100,Number(percent)||0));
      const elapsed=Math.max(0,Math.round((Date.now()-started)/1000));
      let eta=estimated;
      if(p>=5&&p<100) eta=Math.max(0,Math.round(elapsed*(100-p)/p));
      const etaText=eta!=null?' · quedan ~'+fmt(eta):'';
      status('Generando vídeo… <b>'+p+'%</b> · '+(message||'Procesando')+' · tiempo transcurrido: '+fmt(elapsed)+etaText);
    };
    try{
      const minutes=Math.max(1,Math.min(1440,Number($('#scheduleDuration')?.value||60)));
      const clientEstimate=Math.max(180,Math.round(180+minutes*2.2));
      status('Iniciando generación… <b>0%</b> · tiempo transcurrido: 0s · estimación inicial: ~'+fmt(clientEstimate));
      const d=await api('/api/daily-video-now',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({durationMinutes:minutes,youtubeMode:true,musicoterapia:true})});
      localStorage.setItem('relaxscape_daily_last_run',new Date().toISOString());
      if(!d.jobId)throw Error('El servidor no devolvió un trabajo de generación.');
      renderProgress(d.progress||5,d.message||'Preparando generación…',d.estimatedSeconds||clientEstimate);
      for(let i=0;i<3600;i++){
        await new Promise(r=>setTimeout(r,1500));
        const j=await api('/api/daily-video-status?jobId='+encodeURIComponent(d.jobId));
        if(j.status==='succeeded'){
          status('✓ <b>100%</b> · Vídeo terminado. Tiempo total: '+fmt((Date.now()-started)/1000)+'. MP4 listo para visualizar y publicar.');
          const v=j.result,video=$('#video'),down=$('#download'),result=$('#result');
          if(video){video.src=v.url+'?v='+Date.now();video.load();}
          if(down){down.href=v.url;down.download=v.name||'relaxscape-daily.mp4'}
          if(result)result.classList.remove('hidden');
          return;
        }
        if(j.status==='failed')throw Error(j.error||'La generación del MP4 falló.');
        if(j.status==='unknown')throw Error('El servidor perdió el trabajo de generación.');
        renderProgress(j.progress||0,j.message||'Procesando…',j.estimatedSeconds);
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
    const now=new Date(),target=new Date(now);const [h,m]=String(cfg.hour||'07:00').split(':').map(Number);target.setHours(h||0,m||0,0,0);if(target<=now)target.setDate(target.getDate()+1);
    status(`Programado para ${target.toLocaleString('es-ES')}. La ejecución automática se realiza en el servidor.`);
  }
  function init(){loadCfg();$('#runDailyNow')?.addEventListener('click',e=>{e.preventDefault();runNow()});$('#saveSchedule')?.addEventListener('click',e=>{e.preventDefault();save();scheduleLoop()});$('#scheduleToggle')?.addEventListener('change',()=>{save();scheduleLoop()});scheduleLoop()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
