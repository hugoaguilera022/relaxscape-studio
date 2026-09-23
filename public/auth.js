(()=>{
 const gate=document.querySelector("#authGate"),login=document.querySelector("#loginGoogle"),err=document.querySelector("#authError");
 const show=()=>{if(gate)gate.style.display="flex"};
 const hide=()=>{if(gate)gate.style.display="none"};
 async function status(){try{const r=await fetch("/api/auth/status",{cache:"no-store"});const x=await r.json();if(x.authenticated){hide();window.RelaxScapeUser=x.user;await loadPrefs()}else show()}catch(e){show();if(err)err.textContent="No se pudo comprobar la sesión."}}
 async function loadPrefs(){try{const r=await fetch("/api/user/preferences",{cache:"no-store"});if(!r.ok)return;const x=await r.json();const p=x.preferences||{};for(const [id,v] of Object.entries(p)){const el=document.getElementById(id);if(!el)continue;if(el.type==="checkbox")el.checked=!!v;else if(el.type!=="file")el.value=String(v)};localStorage.setItem("relaxscape.preferences",JSON.stringify(p))}catch{}}
 let timer;
 async function savePrefs(){if(gate?.style.display!=="none")return;const p={};document.querySelectorAll("input[id],textarea[id],select[id]").forEach(el=>{if(el.type==="file")return;if(el.type==="checkbox")p[el.id]=el.checked;else if(el.type!=="password")p[el.id]=el.value});try{await fetch("/api/user/preferences",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({preferences:p})})}catch{}}
 document.addEventListener("DOMContentLoaded",()=>{if(login)login.onclick=()=>location.href="/api/auth/login";status();timer=setInterval(savePrefs,5000);document.addEventListener("change",savePrefs);document.addEventListener("input",()=>{clearTimeout(window.__rsSave);window.__rsSave=setTimeout(savePrefs,1200)})});
})();