const store = {
  get(key, fallback) { try { const v = JSON.parse(localStorage.getItem(key)); return (v ?? fallback); } catch { return fallback; } },
  set(key, val) { localStorage.setItem(key, JSON.stringify(val)); },
  push(key, item, max=300) { const arr = store.get(key, []); arr.unshift(item); store.set(key, arr.slice(0,max)); }
};
const KEYS = { account:"arch.account", connected:"arch.conn", stats:"arch.stats", markers:"arch.markers", activity:"arch.activity" };
const tNow = () => new Date().toLocaleTimeString();
const tStamp = (ms) => new Date(ms).toLocaleString();

/* ---------- auth ---------- */
function ensureAccount() {
  let acct = store.get(KEYS.account, null);
  const modal = document.getElementById("authModal");
  if (!acct) {
    modal?.classList.remove("hidden");
    document.getElementById("authGo")?.addEventListener("click", () => {
      const name = document.getElementById("authName").value.trim();
      const org  = document.getElementById("authOrg").value.trim() || "Field Unit A";
      if (!name) return;
      acct = { id: crypto.randomUUID(), name, org, createdAt: Date.now() };
      store.set(KEYS.account, acct);
      modal.classList.add("hidden");
      inflateSidebar();
    });
  } else modal?.classList.add("hidden");
  inflateSidebar();
}

function inflateSidebar() {
  const acct = store.get(KEYS.account, null);
  const userName = document.getElementById("userName");
  const userOrg = document.getElementById("userOrg");
  if (userName) userName.textContent = acct ? acct.name : "—";
  if (userOrg) userOrg.textContent = acct ? acct.org : "";
  renderConnBadge(!!store.get(KEYS.connected, false));
}

/* ---------- connection + telemetry ---------- */
let telemTimer = null;
function setConnection(connected) {
  const was = !!store.get(KEYS.connected, false);
  store.set(KEYS.connected, connected);
  renderConnBadge(connected);
  if (connected && !was) logActivity(`Connected to drone @ ${tNow()}`);
  if (!connected && was)  logActivity(`Disconnected @ ${tNow()}`);
  runTelemetry(connected);
}
function renderConnBadge(connected) {
  const badge = document.getElementById("connBadge");
  const btn   = document.getElementById("connBtn");
  if (!badge || !btn) return;
  badge.textContent = connected ? "Connected" : "Offline";
  badge.className   = "badge " + (connected ? "ok" : "off");
  btn.textContent   = connected ? "Disconnect" : "Connect";
}
function runTelemetry(connected) {
  clearInterval(telemTimer);
  if (!connected) return;
  telemTimer = setInterval(() => {
    const s = store.get(KEYS.stats, {
      tempC:24, battery:0.86, altitude:1.2, link:0.75, solarW:100,
      motorsW:0, electronicsW:1500, storage:0.12, gpsFix:true, mode:"Idle"
    });
    s.tempC = +(s.tempC + (Math.random()*2-1)).toFixed(1);
    s.battery = Math.max(0, Math.min(1, s.battery - 0.0015 + (s.solarW>80?0.001:0)));
    s.altitude = Math.max(0, +(s.altitude + (Math.random()*0.2-0.1)).toFixed(1));
    s.link = Math.max(0, Math.min(1, s.link + (Math.random()*0.06-0.03)));
    s.solarW = Math.max(0, Math.round(80 + Math.random()*120));
    s.motorsW = Math.round(100 + Math.random()*500);
    s.electronicsW = Math.round(1000 + Math.random()*3000);
    s.storage = Math.min(1, s.storage + 0.0008);
    store.set(KEYS.stats, s);
    drawStats();
  }, 1000);
}

/* ---------- activity ---------- */
function logActivity(msg) { store.push(KEYS.activity, { id:crypto.randomUUID(), t:Date.now(), msg }); renderActivity(); }

/* ---------- stats (home) ---------- */
function drawStats() {
  if (!document.getElementById("statsWrap")) return;
  const s = store.get(KEYS.stats, {});
  const pct = (n)=> Math.round((n||0)*100);
  const set = (id,v)=>{ const el=document.getElementById(id); if(el) el.textContent=v; };
  set("stTemp", `${s.tempC?.toFixed?.(1) ?? "—"}°C`);
  set("stBatt", `${pct(s.battery)}%`);
  set("stAlt", `${s.altitude ?? 0} m`);
  set("stLink", `${pct(s.link)}%`);
  set("stSolar", `${s.solarW ?? 0} W`);
  set("stPower", `${(s.motorsW||0)+(s.electronicsW||0)} W`);
  set("stStorage", `${pct(s.storage)}%`);
  set("stGps", s.gpsFix ? "3D Fix" : "Searching");
  const pb = (id, n)=>{ const e=document.getElementById(id); if(e) e.style.width = Math.max(0,Math.min(100,n)) + "%"; };
  pb("pbBatt", pct(s.battery)); pb("pbLink", pct(s.link)); pb("pbStorage", pct(s.storage));
  const modeNow=document.getElementById("modeNow"); if(modeNow) modeNow.textContent = s.mode || "Idle";
}
function setMode(mode) {
  const s = store.get(KEYS.stats, {}); s.mode = mode; store.set(KEYS.stats, s);
  const modeNow=document.getElementById("modeNow"); if(modeNow) modeNow.textContent = mode;
  logActivity(`Mode changed to ${mode} @ ${tNow()}`);
}

/* ---------- imaging ---------- */
function imagingInit() {
  const canvas = document.getElementById("feedCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const bg = gridDataURI();
  function drawAll() {
    const w = canvas.width = canvas.clientWidth;
    const h = canvas.height = canvas.clientHeight;
    const img = new Image();
    img.onload = () => { ctx.drawImage(img,0,0,w,h); drawMarkers(ctx); };
    img.src = bg;
  }
  drawAll(); window.addEventListener("resize", drawAll);

  canvas.addEventListener("click", (e) => {
    if (!store.get(KEYS.connected,false)) return;
    const r = canvas.getBoundingClientRect();
    const x = Math.round(((e.clientX - r.left) / r.width) * 1000)/10;
    const y = Math.round(((e.clientY - r.top) / r.height) * 1000)/10;
    const color = document.getElementById("markerColor").value || "#10b981";
    const markers = store.get(KEYS.markers, []);
    const m = { id:crypto.randomUUID(), x, y, color, label:`Potential site ${markers.length+1}` };
    store.set(KEYS.markers, [...markers, m]);
    logActivity(`Marker added at (${x}%, ${y}%)`);
    renderMarkerTable(); drawAll();
  });

  document.getElementById("clearMarkers")?.addEventListener("click", ()=>{
    store.set(KEYS.markers, []); logActivity("All markers cleared");
    renderMarkerTable(); drawAll();
  });

  renderMarkerTable();
  if (!store.get(KEYS.connected,false)) document.getElementById("camOverlay")?.classList.remove("hidden");
}
function drawMarkers(ctx) {
  const ms = store.get(KEYS.markers, []);
  ctx.font = "12px ui-sans-serif, system-ui";
  for (const m of ms) {
    const x = (m.x/100) * ctx.canvas.width;
    const y = (m.y/100) * ctx.canvas.height;
    ctx.beginPath(); ctx.arc(x,y,6,0,Math.PI*2); ctx.fillStyle = m.color || "#10b981"; ctx.fill();
    ctx.fillStyle = "#0f172a"; ctx.fillText(m.label, x+10, y-8);
  }
}
function renderMarkerTable() {
  const tb = document.getElementById("markerRows");
  if (!tb) return;
  tb.innerHTML = "";
  const ms = store.get(KEYS.markers, []);
  if (ms.length === 0) { tb.innerHTML = `<tr><td colspan="3" class="row-muted" style="padding:12px">No markers yet.</td></tr>`; return; }
  for (const m of ms) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span style="display:inline-block;width:10px;height:10px;border-radius:999px;background:${m.color}" class="mr8"></span>
          <input class="input" style="max-width:260px" value="${m.label}"></td>
      <td class="row-muted">${m.x}%, ${m.y}%</td>
      <td style="text-align:right"><button class="btn secondary" data-id="${m.id}">Delete</button></td>`;
    tr.querySelector("input").addEventListener("input",(e)=>{
      const arr = store.get(KEYS.markers, []); const i=arr.findIndex(x=>x.id===m.id);
      if(i>-1){ arr[i].label=e.target.value; store.set(KEYS.markers, arr); }
    });
    tr.querySelector("button").addEventListener("click", ()=>{
      const arr = store.get(KEYS.markers, []).filter(x=>x.id!==m.id);
      store.set(KEYS.markers, arr); logActivity(`Marker removed (${m.label})`);
      renderMarkerTable(); imagingInit();
    });
    tb.appendChild(tr);
  }
}

/* ---------- activity page ---------- */
function renderActivity() {
  const ul = document.getElementById("activityList");
  if (!ul) return;
  const items = store.get(KEYS.activity, []);
  ul.innerHTML = items.length ? "" : `<li class="row-muted">No activity yet.</li>`;
  for (const a of items) {
    const li = document.createElement("li");
    li.style.cssText = "padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#fff;margin-bottom:8px;";
    li.innerHTML = `<span class="row-muted mr8">${tStamp(a.t)}:</span>${a.msg}`;
    ul.appendChild(li);
  }
}

/* ---------- tiny SVG grid as data URI ---------- */
function gridDataURI() {
  const svg = encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='800' height='480'>
    <defs><pattern id='g' width='40' height='40' patternUnits='userSpaceOnUse'>
      <rect width='40' height='40' fill='#fafafa'/>
      <path d='M 40 0 L 0 0 0 40' fill='none' stroke='#e5e7eb' stroke-width='1'/>
    </pattern></defs>
    <rect width='100%' height='100%' fill='url(#g)'/>
    <text x='20' y='36' font-size='18' fill='#94a3b8'>Live feed (mock)</text>
  </svg>`);
  return `data:image/svg+xml;charset=utf-8,${svg}`;
}

/* ---------- boot per page ---------- */
document.addEventListener("DOMContentLoaded", () => {
  ensureAccount();
  const connected = !!store.get(KEYS.connected, false);
  renderConnBadge(connected);
  runTelemetry(connected);

  document.getElementById("connBtn")?.addEventListener("click", ()=> setConnection(!store.get(KEYS.connected,false)));
  document.getElementById("logoutBtn")?.addEventListener("click", ()=> { localStorage.removeItem(KEYS.account); location.reload(); });

  drawStats();     // home
  imagingInit();   // imaging
  renderActivity();// activity
});