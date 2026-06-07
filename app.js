const canvas = document.getElementById("scene");
const ctx = canvas.getContext("2d");
const E = id => document.getElementById(id);

const progressEl = E("progress");
const yawEl = E("yaw");
const pitchEl = E("pitch");
const zoomEl = E("zoom");
const depthEl = E("depth");

const playBtn = E("playBtn");
const resetBtn = E("resetBtn");
const packBtn = E("packBtn");
const unpackBtn = E("unpackBtn");
const orbitBtn = E("orbitBtn");
const cameraBtn = E("cameraBtn");
const cameraPopover = E("cameraPopover");
const camState = E("camState");
const controlCard = E("controlCard");
const collapseBtn = E("collapseBtn");

const stageCopy = E("stageCopy");
const shapeCopy = E("shapeCopy");
const fill = E("fill");
const stageNodes = E("stageNodes");
const modePill = E("modePill");
const presetStrip = E("presetStrip");
const figureEyebrow = E("figureEyebrow");
const figureTitle = E("figureTitle");
const pathBarSteps = [...document.querySelectorAll("[data-path-index]")];

const states = [
  {w:64,h:64,c:1,label:"64×64×1",note:"original spatial image"},
  {w:32,h:32,c:4,label:"32×32×4",note:"each 2×2 block moves into channel depth"},
  {w:16,h:16,c:16,label:"16×16×16",note:"direct 4×4 space-to-depth packing"},
  {w:8,h:8,c:64,label:"8×8×64",note:"direct 8×8 space-to-depth packing"}
];

const PRESET_MANIFEST = {
  "taco": {
    "label": "Taco",
    "src": "presets/taco.png"
  },
  "blue": {
    "label": "Baka",
    "src": "presets/blue.png"
  },
  "red": {
    "label": "Reimu",
    "src": "presets/red.png"
  }
};
const PRESETS = {};
let currentPreset = "red";
let base = [];
let mode = "pack";
let playing = false;
let autoOrbit = false;
let lastTs = performance.now();

function lerp(a,b,t){ return a*(1-t)+b*t; }
function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
function smoothstep(a,b,x){ const t = clamp((x-a)/(b-a),0,1); return t*t*(3-2*t); }
function ease(t){ return t < .5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2; }
function rgb(hex){ const v = hex.replace("#",""); return [parseInt(v.slice(0,2),16), parseInt(v.slice(2,4),16), parseInt(v.slice(4,6),16)]; }
function mix(a,b,t){ const A = rgb(a), B = rgb(b); return `rgb(${Math.round(A[0]*(1-t)+B[0]*t)},${Math.round(A[1]*(1-t)+B[1]*t)},${Math.round(A[2]*(1-t)+B[2]*t)})`; }
function shade(hex, amt){ return mix(hex, amt >= 0 ? "#ffffff" : "#000000", Math.abs(amt)); }

function loadImage(src){
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load preset image: ${src}`));
    image.src = src;
  });
}

async function loadPreset(key, preset){
  const image = await loadImage(preset.src);
  if(image.naturalWidth !== 64 || image.naturalHeight !== 64){
    throw new Error(`Preset ${key} must be exactly 64x64 pixels.`);
  }

  const buffer = document.createElement("canvas");
  buffer.width = 64;
  buffer.height = 64;
  const bufferCtx = buffer.getContext("2d", {willReadFrequently: true});
  bufferCtx.drawImage(image, 0, 0);
  const pixels = bufferCtx.getImageData(0, 0, 64, 64).data;
  const data = Array.from({length: 64}, () => Array(64).fill(null));

  for(let y = 0; y < 64; y++){
    for(let x = 0; x < 64; x++){
      const offset = (y * 64 + x) * 4;
      const alpha = pixels[offset + 3];
      if(alpha === 0) continue;
      if(alpha !== 255) throw new Error(`Preset ${key} contains partial transparency at ${x},${y}.`);
      data[y][x] = `#${[pixels[offset], pixels[offset + 1], pixels[offset + 2]].map(v => v.toString(16).padStart(2, "0")).join("")}`;
    }
  }

  return {...preset, data};
}

async function preloadPresets(){
  const loaded = await Promise.all(
    Object.entries(PRESET_MANIFEST).map(async ([key, preset]) => [key, await loadPreset(key, preset)])
  );
  for(const [key, preset] of loaded) PRESETS[key] = preset;
  base = PRESETS[currentPreset].data;
}

function stateAddressFromBase(stage, ox, oy){
  const block = 1 << stage;
  return {x: Math.floor(ox / block), y: Math.floor(oy / block), z: (oy % block) * block + (ox % block)};
}
function centerAddr(addr, state, zDepth){
  return {x: addr.x - (state.w - 1) / 2, y: (state.h - 1) / 2 - addr.y, z: (addr.z - (state.c - 1) / 2) * zDepth};
}
function stagedPosition(packStage, local, ox, oy){
  const A = states[packStage];
  const B = states[Math.min(packStage+1, states.length-1)];
  const depthAmount = Number(depthEl.value);
  const aAddr = stateAddressFromBase(packStage, ox, oy);
  const bAddr = stateAddressFromBase(packStage + 1, ox, oy);
  const a = centerAddr(aAddr, A, depthAmount);
  const b = centerAddr(bAddr, B, depthAmount);
  const liftT = ease(smoothstep(0.14, 0.38, local));
  const collapseT = ease(smoothstep(0.38, 0.64, local));
  const scaleT = ease(smoothstep(0.64, 0.84, local));
  return {
    p: {
      x: lerp(a.x, b.x, collapseT),
      y: lerp(a.y, b.y, collapseT),
      z: lerp(a.z, b.z, liftT),
      tileScale: lerp(1, A.w / B.w, scaleT)
    },
    A, B
  };
}
function project(x,y,z){
  const yaw = Number(yawEl.value), pitch = Number(pitchEl.value);
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const x1 = cy*x + sy*z, z1 = -sy*x + cy*z;
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const y1 = cp*y - sp*z1, z2 = sp*y + cp*z1;
  const dist = 110, f = 260, persp = f / (f + z2 + dist);
  return {x:x1*persp, y:-y1*persp, depth:z2, persp};
}
function drawTile(cx, cy, cz, size, color, alpha=1){
  const half = size / 2;
  const corners = [project(cx-half, cy-half, cz), project(cx+half, cy-half, cz), project(cx+half, cy+half, cz), project(cx-half, cy+half, cz)];
  return {corners, color, alpha, depth: corners.reduce((s,p)=>s+p.depth,0)/4, persp: corners.reduce((s,p)=>s+p.persp,0)/4};
}
function drawPolygon(poly, ox, oy, scale){
  const c = poly.corners;
  ctx.globalAlpha = poly.alpha;
  ctx.beginPath();
  ctx.moveTo(ox + c[0].x * scale, oy + c[0].y * scale);
  for(let i=1;i<c.length;i++) ctx.lineTo(ox + c[i].x * scale, oy + c[i].y * scale);
  ctx.closePath();
  const light = clamp((poly.persp - .55) * .34, -0.08, 0.08);
  ctx.fillStyle = shade(poly.color, light);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,.09)";
  ctx.lineWidth = 0.50;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function buildTiles(packP){
  const raw = packP * 3;
  const stage = Math.min(2, Math.floor(raw));
  const local = raw - stage;
  const tiles = [];
  let A = states[stage], B = states[stage+1];
  const visualFootprint = lerp(A.w, B.w, ease(smoothstep(.64, .84, local)));
  for(let oy=0; oy<64; oy++) for(let ox=0; ox<64; ox++){
    const col = base[oy][ox];
    if(!col) continue;
    const r = stagedPosition(stage, local, ox, oy);
    A = r.A; B = r.B;
    tiles.push(drawTile(r.p.x, r.p.y, r.p.z, 0.92 * r.p.tileScale, col, 0.94));
  }
  tiles.sort((a,b) => b.depth - a.depth);
  return {tiles, stage, local, A, B, visualFootprint};
}

function sceneBounds(packP){
  const raw = packP * 3;
  const stage = Math.min(2, Math.floor(raw));
  const local = raw - stage;
  const A = states[stage], B = states[stage+1];
  const depthAmount = Number(depthEl.value);
  const liftT = ease(smoothstep(0.14, 0.38, local));
  const collapseT = ease(smoothstep(0.38, 0.64, local));
  const scaleT = ease(smoothstep(0.64, 0.84, local));
  const w = lerp(A.w, B.w, collapseT);
  const h = lerp(A.h, B.h, collapseT);
  const c = lerp(A.c, B.c, liftT);
  const tileScale = lerp(1, A.w / B.w, scaleT);
  const halfW = (w + tileScale) / 2;
  const halfH = (h + tileScale) / 2;
  const halfD = Math.max(0, c - 1) * depthAmount / 2;
  const corners = [];
  for(const x of [-halfW, halfW]){
    for(const y of [-halfH, halfH]){
      for(const z of [-halfD, halfD]) corners.push(project(x, y, z));
    }
  }
  const xs = corners.map(p => p.x), ys = corners.map(p => p.y);
  return {
    width: Math.max(1, Math.max(...xs) - Math.min(...xs)),
    height: Math.max(1, Math.max(...ys) - Math.min(...ys)),
    spatialFootprint: Math.max(w, h)
  };
}

function drawLayerOutlines(packP, scale, ox, oy){
  const raw = packP * 3, stage = Math.min(2, Math.floor(raw)), local = raw - stage;
  const A = states[stage], B = states[stage+1];
  const cEstimate = Math.round(lerp(A.c, B.c, ease(smoothstep(0.14,0.38,local))));
  const wEstimate = lerp(A.w, B.w, ease(smoothstep(0.38,0.64,local)));
  const hEstimate = lerp(A.h, B.h, ease(smoothstep(0.38,0.64,local)));
  const depthAmount = Number(depthEl.value);
  const maxLayersToDraw = Math.min(cEstimate, 18), stride = Math.max(1, Math.floor(cEstimate / maxLayersToDraw));
  ctx.save(); ctx.lineWidth = 1;
  for(let z=0; z<cEstimate; z+=stride){
    const zz = (z - (cEstimate - 1)/2) * depthAmount;
    const corners = [project(-wEstimate/2, -hEstimate/2, zz), project(wEstimate/2, -hEstimate/2, zz), project(wEstimate/2, hEstimate/2, zz), project(-wEstimate/2, hEstimate/2, zz)];
    ctx.beginPath();
    ctx.moveTo(ox + corners[0].x * scale, oy + corners[0].y * scale);
    for(let i=1;i<corners.length;i++) ctx.lineTo(ox + corners[i].x * scale, oy + corners[i].y * scale);
    ctx.closePath();
    ctx.strokeStyle = `rgba(255,255,255,${cEstimate <= 4 ? .14 : .06})`;
    ctx.stroke();
  }
  ctx.restore();
}

function drawFloorGlow(W,H,x,y,scale,extent){
  ctx.save();
  ctx.translate(x, y + extent*scale*.25);
  ctx.scale(1,.32);
  const g = ctx.createRadialGradient(0,0,12,0,0,extent*scale*.52);
  g.addColorStop(0,"rgba(241,200,107,.11)");
  g.addColorStop(1,"rgba(241,200,107,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0,0,extent*scale*.58,extent*scale*.26,0,0,Math.PI*2);
  ctx.fill();
  ctx.restore();
}

function drawAxes(W, H){
  const originX = Math.min(42, W - 56);
  const originY = Math.max(78, H - 132);
  const axisScale = 1.35;
  const origin = project(0, 0, 0);
  const axes = [
    {label:"x", color:"rgba(155,200,255,.82)", point:project(22, 0, 0)},
    {label:"y", color:"rgba(241,200,107,.86)", point:project(0, 22, 0)},
    {label:"z", color:"rgba(188,238,196,.78)", point:project(0, 0, 22)}
  ].sort((a,b) => a.point.depth - b.point.depth);

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const ox = originX + origin.x * axisScale;
  const oy = originY + origin.y * axisScale;
  ctx.fillStyle = "rgba(10,13,18,.42)";
  ctx.beginPath();
  ctx.arc(ox, oy, 3, 0, Math.PI * 2);
  ctx.fill();

  for(const axis of axes){
    const x = originX + axis.point.x * axisScale;
    const y = originY + axis.point.y * axisScale;
    ctx.strokeStyle = axis.color;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(x, y);
    ctx.stroke();

    const angle = Math.atan2(y - oy, x - ox);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - Math.cos(angle - .45) * 5, y - Math.sin(angle - .45) * 5);
    ctx.moveTo(x, y);
    ctx.lineTo(x - Math.cos(angle + .45) * 5, y - Math.sin(angle + .45) * 5);
    ctx.stroke();

    ctx.fillStyle = axis.color;
    ctx.fillText(axis.label, x + Math.cos(angle) * 9, y + Math.sin(angle) * 9);
  }
  ctx.restore();
}

function drawScene(){
  const W = canvas.clientWidth, H = canvas.clientHeight;
  ctx.clearRect(0,0,W,H);
  if(!base.length) return;
  const bg = ctx.createRadialGradient(W*.52,H*.50,40,W*.52,H*.50,Math.max(W,H)*.52);
  bg.addColorStop(0,"rgba(255,255,255,.06)");
  bg.addColorStop(.45,"rgba(255,255,255,.02)");
  bg.addColorStop(1,"rgba(255,255,255,0)");
  ctx.fillStyle = bg; ctx.fillRect(0,0,W,H);

  const packP = mode === "pack" ? Number(progressEl.value) : 1 - Number(progressEl.value);
  const built = buildTiles(packP);
  const bounds = sceneBounds(packP);
  const endPadding = lerp(0.66, 0.61, smoothstep(0.76, 1, packP));
  const targetScale = Math.min(W * endPadding / bounds.width, H * endPadding / bounds.height) * Number(zoomEl.value);
  const originX = W * 0.52, originY = H * 0.54;
  drawFloorGlow(W,H,originX,originY,targetScale,bounds.spatialFootprint);
  drawLayerOutlines(packP, targetScale, originX, originY);
  for(const tile of built.tiles) drawPolygon(tile, originX, originY, targetScale);
  drawAxes(W, H);
  updateUi(packP, built);
}

function updateUi(packP, built){
  const from = mode === "pack" ? built.A.label : built.B.label;
  const to = mode === "pack" ? built.B.label : built.A.label;
  const currentIndex = Math.min(3, Math.round(packP * 3));
  const imageName = PRESETS[currentPreset].label;
  shapeCopy.textContent = `${from} → ${to}`;
  if(mode === "pack"){
    figureEyebrow.textContent = "space-to-depth · pixel unshuffle";
    figureTitle.textContent = "Space-to-depth pixel shuffle";
    stageCopy.textContent = `Space-to-depth ${imageName} — pixel unshuffle; ${states[currentIndex].note}`;
  }else{
    figureEyebrow.textContent = "depth-to-space · pixel shuffle";
    figureTitle.textContent = "Depth-to-space pixel shuffle";
    stageCopy.textContent = `Depth-to-space ${imageName} — pixel shuffle; ${states[currentIndex].note}`;
  }
  fill.style.width = `${packP * 100}%`;
  [...stageNodes.children].forEach((n,i)=>n.classList.toggle("active", i === currentIndex));
  pathBarSteps.forEach((step,i)=>step.classList.toggle("active", i === currentIndex));
  modePill.textContent = `${mode === "pack" ? "unshuffle" : "shuffle"} · ${autoOrbit ? "orbit" : "manual"}`;
  camState.textContent = autoOrbit ? "orbiting" : "manual";
  [...presetStrip.children].forEach((btn,i)=>btn.classList.toggle("active", btn.dataset.key === currentPreset));
}

function setupNodes(){
  stageNodes.innerHTML = "";
  states.forEach((s, i) => {
    const node = document.createElement("div");
    node.className = "stage-node";
    node.innerHTML = `<div class="dot"></div><div class="label">${s.label}</div>`;
    node.addEventListener("click", () => {
      progressEl.value = (mode === "pack" ? i/3 : 1 - i/3).toFixed(3);
      setPaused(true);
      drawScene();
    });
    stageNodes.appendChild(node);
  });
}

function setupPresets(){
  presetStrip.innerHTML = "";
  for(const [key, preset] of Object.entries(PRESETS)){
    const btn = document.createElement("button");
    btn.className = "preset-btn";
    btn.dataset.key = key;
    btn.innerHTML = `<div class="preset-thumb"><img src="${preset.src}" alt="${preset.label}"></div><div class="preset-name">${preset.label}</div>`;
    btn.addEventListener("click", () => setPreset(key));
    presetStrip.appendChild(btn);
  }
}

function setPreset(key){
  currentPreset = key;
  base = PRESETS[key].data;
  drawScene();
}

function setPaused(paused){
  playing = !paused;
  playBtn.textContent = playing ? "❚❚" : "▶";
  playBtn.title = playing ? "Pause" : "Play";
  playBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
  playBtn.classList.toggle("active", playing);
}
function setMode(next){
  mode = next;
  packBtn.classList.toggle("active", mode === "pack");
  unpackBtn.classList.toggle("active", mode === "unpack");
  drawScene();
}
function toggleCameraPopover(force){
  const open = force !== undefined ? force : !cameraPopover.classList.contains("open");
  cameraPopover.classList.toggle("open", open);
}
function setControlCardCollapsed(collapsed, persist = true){
  controlCard.classList.toggle("collapsed", collapsed);
  collapseBtn.setAttribute("aria-expanded", String(!collapsed));
  collapseBtn.setAttribute("aria-label", collapsed ? "Expand controls" : "Collapse controls");
  collapseBtn.title = collapsed ? "Expand controls" : "Collapse controls";
  collapseBtn.textContent = collapsed ? "+" : "−";
  if(collapsed) toggleCameraPopover(false);
  if(persist) localStorage.setItem("pixl-controls-collapsed", String(collapsed));
}

packBtn.addEventListener("click", ()=>setMode("pack"));
unpackBtn.addEventListener("click", ()=>setMode("unpack"));
playBtn.addEventListener("click", ()=>setPaused(playing));
collapseBtn.addEventListener("click", ()=>setControlCardCollapsed(!controlCard.classList.contains("collapsed")));
resetBtn.addEventListener("click", ()=>{
  progressEl.value = 0;
  yawEl.value = 0.72;
  pitchEl.value = 0.58;
  zoomEl.value = 1.05;
  depthEl.value = 1.45;
  autoOrbit = false;
  orbitBtn.classList.remove("active");
  setPaused(true);
  drawScene();
});
orbitBtn.addEventListener("click", ()=>{
  autoOrbit = !autoOrbit;
  orbitBtn.classList.toggle("active", autoOrbit);
  drawScene();
});
cameraBtn.addEventListener("click", (e)=>{ e.stopPropagation(); toggleCameraPopover(); });
document.addEventListener("click", (e)=>{
  if(!cameraPopover.contains(e.target) && !cameraBtn.contains(e.target)) toggleCameraPopover(false);
});
[progressEl, yawEl, pitchEl, zoomEl, depthEl].forEach(input => {
  input.addEventListener("input", ()=>{
    if(input === progressEl) setPaused(true);
    if(input === yawEl || input === pitchEl){ autoOrbit = false; orbitBtn.classList.remove("active"); }
    drawScene();
  });
});

let dragging = false, lx = 0, ly = 0;
canvas.addEventListener("pointerdown", e=>{ dragging = true; lx = e.clientX; ly = e.clientY; autoOrbit = false; orbitBtn.classList.remove("active"); canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener("pointermove", e=>{
  if(!dragging) return;
  const dx = e.clientX - lx, dy = e.clientY - ly;
  lx = e.clientX; ly = e.clientY;
  yawEl.value = clamp(Number(yawEl.value) + dx*.008, -2.1, 2.1).toFixed(2);
  pitchEl.value = clamp(Number(pitchEl.value) + dy*.006, -0.15, 1.30).toFixed(2);
  drawScene();
});
canvas.addEventListener("pointerup", ()=>dragging = false);
canvas.addEventListener("pointercancel", ()=>dragging = false);
canvas.addEventListener("wheel", e=>{ e.preventDefault(); zoomEl.value = clamp(Number(zoomEl.value) - e.deltaY*.001, .65, 1.85).toFixed(2); drawScene(); }, {passive:false});

function resize(){
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  ctx.setTransform(dpr,0,0,dpr,0,0);
}
window.addEventListener("resize", ()=>{ resize(); drawScene(); });
function animate(ts){
  const dt = Math.min(.05, (ts - lastTs)/1000);
  lastTs = ts;
  if(playing){ let p = Number(progressEl.value) + dt*.075; if(p > 1) p = 0; progressEl.value = p.toFixed(3); }
  if(autoOrbit){ let y = Number(yawEl.value) + dt*.42; if(y > 2.1) y = -2.1; yawEl.value = y.toFixed(2); }
  drawScene();
  requestAnimationFrame(animate);
}

async function init(){
  await preloadPresets();
  resize();
  setupNodes();
  setupPresets();
  const savedCollapsed = localStorage.getItem("pixl-controls-collapsed");
  const isMobile = window.matchMedia("(max-width: 740px)").matches;
  setControlCardCollapsed(isMobile || savedCollapsed === "true", false);
  setMode("pack");
  setPaused(true);
  drawScene();

  setTimeout(() => {
    lastTs = performance.now();
    setPaused(false);
    requestAnimationFrame(animate);
  }, 650);
}

init().catch(error => {
  console.error(error);
  stageCopy.textContent = "Could not load preset images.";
});
