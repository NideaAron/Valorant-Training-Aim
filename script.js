const $ = id => document.getElementById(id);
const soundVolumeControl = document.getElementById('soundVolume');
if (soundVolumeControl) soundVolumeControl.addEventListener('input', e => { masterVolume = Number(e.target.value); try { localStorage.setItem('vtm3d_vol', e.target.value); } catch (err) {} });
const RAD = Math.PI / 180;
let DURATION = 30; // default training duration; selectable in the start screen

// ---------- leaderboard (optional online) ----------
// Para sa online leaderboard, ilagay dito ang Supabase URL at anon key. Kung walang laman, local lang ang leaderboard.
const SUPABASE_URL = '';
const SUPABASE_KEY = '';

const LEVELS = {
  easy:   { life: 3200, gap: 700, max: 3, move: 0,   speed: 4,   hold: 1.8, strafe: 0,   hmax: 1, hgap: 900 },
  medium: { life: 2400, gap: 500, max: 4, move: 1.5, speed: 6.5, hold: 1.3, strafe: 1,   hmax: 2, hgap: 600 },
  hard:   { life: 1600, gap: 350, max: 5, move: 3.2, speed: 9,   hold: 0.9, strafe: 1.6, hmax: 3, hgap: 400 }
};
const WEAPONS = {
  vandal:  { name: 'Vandal',  interval: 103, p: 0.55, y: 0.35, auto: true, mag: 25, reload: 2.5 },
  phantom: { name: 'Phantom', interval: 90,  p: 0.42, y: 0.28, auto: true, mag: 30, reload: 2.3 },
  sheriff: { name: 'Sheriff', interval: 250, p: 2.2,  y: 0.5,  auto: false, mag: 6, reload: 2.2 },
  operator: { name: 'Operator', interval: 1350, p: 4.2, y: 0.6, auto: false, mag: 5, reload: 3.4, sniper: true, bodyDmg: 3, hipSpread: 3.6 },
  shotgun:  { name: 'Shotgun',  interval: 850,  p: 3.4, y: 0.7, auto: false, mag: 6, reload: 3.2, shell: true, pellets: 12, spread: 4.6, range: 32, pelletDmg: 0.34, headPelletDmg: 0.6 },
  knife:   { name: 'Knife',   interval: 550, melee: true, auto: true }
};
const CLEAR_SPAWNS = [[-8, -18], [8, -18], [-12, -30], [12, -30], [-8, -42], [8, -42], [0, -35], [0, -48]];

// ---------- scene ----------
// Flat static surfaces that can receive bullet holes / knife slash marks (and also block shots).
const wallSurfaces = [];
// Scene-level box() meshes that never need individual hit-testing are merged into one draw call
// (see flushStaticBatch). markSolid() pulls a mesh back out of the batch so it stays individually raycastable.
const staticBatch = [];
const markSolid = (m, surface = 'concrete') => {
  m.userData.decal = true; m.userData.surface = surface; wallSurfaces.push(m);
  const bi = staticBatch.indexOf(m); if (bi >= 0) staticBatch.splice(bi, 1);
  if (!m.parent) scene.add(m);
  return m;
};
const scene = new THREE.Scene();
// Enclosed indoor training facility: no open sky or clouds.
scene.background = new THREE.Color(0x202a35);
scene.fog = new THREE.Fog(0x202a35, 58, 92);
const camera = new THREE.PerspectiveCamera(80, innerWidth / innerHeight, 0.1, 100);
camera.rotation.order = 'YXZ';
scene.add(camera);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('wrap').appendChild(renderer.domElement);
scene.add(new THREE.AmbientLight(0xcbd8e8, 0.92));   // slightly brighter: the 4 per-lamp point lights were replaced by cheap floor light pools
const facilityLight = new THREE.DirectionalLight(0xfff1dc, 0.72);
facilityLight.position.set(-12, 18, 8);
facilityLight.target.position.set(0, 0, -24);
scene.add(facilityLight.target);
facilityLight.castShadow = true;
facilityLight.shadow.mapSize.set(2048, 2048);
Object.assign(facilityLight.shadow.camera, { left: -28, right: 28, top: 24, bottom: -24, near: 1, far: 90 });
facilityLight.shadow.bias = -0.0005;
scene.add(facilityLight);

// Graphics presets: keep gameplay and assets identical; adjust only rendering cost.
function applyGraphicsQuality(mode) {
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 4;
  const chosen = mode === 'auto' ? ((cores <= 4 || memory <= 4) ? 'low' : (cores <= 6 || memory <= 8 ? 'medium' : 'high')) : mode;
  const settings = {
    low:    { pixel: 0.85, shadows: false, shadowSize: 512 },
    medium: { pixel: 1.0, shadows: true, shadowSize: 1024 },
    high:   { pixel: 1.5, shadows: true, shadowSize: 2048 }
  }[chosen] || { pixel: 1.0, shadows: true, shadowSize: 1024 };
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, settings.pixel));
  renderer.shadowMap.enabled = settings.shadows;
  facilityLight.castShadow = settings.shadows;
  facilityLight.shadow.mapSize.set(settings.shadowSize, settings.shadowSize);
  facilityLight.shadow.map && (facilityLight.shadow.map.dispose(), facilityLight.shadow.map = null);
  facilityLight.shadow.needsUpdate = true;
  renderer.setSize(innerWidth, innerHeight);
  try { localStorage.setItem('vtm3d_graphics', mode); } catch (e) {}
}


function box(w, h, d, color, x, y, z, parent) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
  m.position.set(x, y, z); m.castShadow = m.receiveShadow = true;
  if (parent) parent.add(m); else staticBatch.push(m);   // batched later by flushStaticBatch()
  return m;
}
function flushStaticBatch() {
  if (!staticBatch.length) return;
  const parts = staticBatch.map(m => m.geometry.index ? m.geometry.toNonIndexed() : m.geometry);
  let verts = 0; parts.forEach(g => verts += g.attributes.position.count);
  const pos = new Float32Array(verts * 3), nor = new Float32Array(verts * 3), col = new Float32Array(verts * 3);
  const v = new THREE.Vector3(), nm = new THREE.Matrix3();
  let o = 0;
  staticBatch.forEach((m, i) => {
    m.updateMatrix(); nm.getNormalMatrix(m.matrix);
    const g = parts[i], pa = g.attributes.position, na = g.attributes.normal, c = m.material.color;
    for (let k = 0; k < pa.count; k++, o += 3) {
      v.fromBufferAttribute(pa, k).applyMatrix4(m.matrix); pos[o] = v.x; pos[o + 1] = v.y; pos[o + 2] = v.z;
      v.fromBufferAttribute(na, k).applyMatrix3(nm).normalize(); nor[o] = v.x; nor[o + 1] = v.y; nor[o + 2] = v.z;
      col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b;
    }
    if (g !== m.geometry) g.dispose();
    m.geometry.dispose(); m.material.dispose();
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const merged = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  merged.castShadow = merged.receiveShadow = true; scene.add(merged);
  staticBatch.length = 0;
}
// Procedural worn concrete: mottled aggregate, stains, hairline cracks and subtle grit.
const cv = document.createElement('canvas'); cv.width = cv.height = 512;
const g2 = cv.getContext('2d');
g2.fillStyle = '#737d86'; g2.fillRect(0, 0, 512, 512);
const pixels = g2.createImageData(512, 512);
for (let i = 0; i < pixels.data.length; i += 4) {
  const n = (Math.random() - .5) * 30;
  pixels.data[i] = Math.max(0, Math.min(255, 116 + n));
  pixels.data[i+1] = Math.max(0, Math.min(255, 127 + n));
  pixels.data[i+2] = Math.max(0, Math.min(255, 137 + n));
  pixels.data[i+3] = 255;
}
g2.putImageData(pixels, 0, 0);
for (let i=0;i<95;i++) {
  const x=Math.random()*512, y=Math.random()*512, r=5+Math.random()*34;
  const grad=g2.createRadialGradient(x,y,1,x,y,r);
  grad.addColorStop(0, `rgba(35,42,48,${.025+Math.random()*.055})`); grad.addColorStop(1,'rgba(35,42,48,0)');
  g2.fillStyle=grad; g2.beginPath(); g2.arc(x,y,r,0,Math.PI*2); g2.fill();
}
for(let i=0;i<18;i++) {
  let x=Math.random()*512, y=Math.random()*512; g2.beginPath(); g2.moveTo(x,y);
  for(let j=0;j<3+Math.floor(Math.random()*5);j++){ x+=(Math.random()-.5)*35; y+=Math.random()*22; g2.lineTo(x,y); }
  g2.strokeStyle='rgba(31,39,46,.22)'; g2.lineWidth=.7+Math.random()*1.2; g2.stroke();
}
const tex = new THREE.CanvasTexture(cv); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(2.4, 4.2); tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 70), new THREE.MeshStandardMaterial({ map: tex, bumpMap: tex, bumpScale: 1.4, roughness: .94, metalness: .03 }));   // the concrete colour map doubles as grit/crack bump
floor.receiveShadow = true;
floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, -22);
scene.add(floor); markSolid(floor, 'floor');
// Painted steel-panel wall: 5 m x 10 m tile (512x1024 px) with panels, rivets, seams, grime, rust streaks,
// edge wear and a hazard-striped kick band. A matching height map gives real relief under the lights.
function makeWallArt() {
  const W = 512, H = 1024, R = Math.random;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const bc = document.createElement('canvas'); bc.width = W; bc.height = H;
  const g = c.getContext('2d'), h = bc.getContext('2d');
  const base = g.createLinearGradient(0, 0, 0, H); base.addColorStop(0, '#60728a'); base.addColorStop(1, '#4b5a6e');
  g.fillStyle = base; g.fillRect(0, 0, W, H);
  h.fillStyle = '#7a7a7a'; h.fillRect(0, 0, W, H);
  for (let r = 0; r < 4; r++) for (let q = 0; q < 2; q++) {
    const x = q * 256, y = r * 256, tint = (R() - .5) * .14;
    g.fillStyle = tint > 0 ? 'rgba(255,255,255,' + tint + ')' : 'rgba(0,0,0,' + (-tint) + ')'; g.fillRect(x, y, 256, 256);
    for (let i = 0; i < 38; i++) {                                           // brushed-metal streaks
      g.fillStyle = R() < .5 ? 'rgba(255,255,255,.035)' : 'rgba(0,0,0,.045)';
      g.fillRect(x + R() * 40, y + R() * 256, 110 + R() * 140, 1 + R() * 2);
    }
    g.fillStyle = 'rgba(255,255,255,.10)'; g.fillRect(x + 6, y + 6, 244, 2); g.fillRect(x + 6, y + 6, 2, 244);   // bevel
    g.fillStyle = 'rgba(0,0,0,.20)'; g.fillRect(x + 6, y + 248, 244, 2); g.fillRect(x + 248, y + 6, 2, 244);
    h.fillStyle = '#8c8c8c'; h.fillRect(x + 8, y + 8, 240, 240);            // raised inner panel
    [[20, 20], [236, 20], [20, 236], [236, 236]].forEach(([ox, oy]) => {    // rivets
      const cx = x + ox, cy = y + oy;
      g.fillStyle = 'rgba(16,22,30,.65)'; g.beginPath(); g.arc(cx + 1, cy + 1, 4, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(192,204,218,.8)'; g.beginPath(); g.arc(cx, cy, 3.2, 0, Math.PI * 2); g.fill();
      h.fillStyle = '#e4e4e4'; h.beginPath(); h.arc(cx, cy, 3.8, 0, Math.PI * 2); h.fill();
    });
  }
  g.fillStyle = 'rgba(12,16,22,.88)'; h.fillStyle = '#1e1e1e';              // seams (wrap-safe: x=0 and x=512 meet)
  [0, 256, 512].forEach(x => { g.fillRect(x - 2, 0, 4, H); h.fillRect(x - 2, 0, 4, H); });
  [256, 512, 768].forEach(y => { g.fillRect(0, y - 2, W, 4); h.fillRect(0, y - 2, W, 4); });
  const grime = g.createLinearGradient(0, H - 340, 0, H); grime.addColorStop(0, 'rgba(10,12,16,0)'); grime.addColorStop(1, 'rgba(10,12,16,.45)');
  g.fillStyle = grime; g.fillRect(0, H - 340, W, 340);
  const top = g.createLinearGradient(0, 0, 0, 130); top.addColorStop(0, 'rgba(10,12,16,.28)'); top.addColorStop(1, 'rgba(10,12,16,0)');
  g.fillStyle = top; g.fillRect(0, 0, W, 130);
  for (let i = 0; i < 34; i++) {                                             // water / rust streaks
    const x = 10 + R() * (W - 20), y = R() * H * .7, len = 90 + R() * 260, w = 2 + R() * 5;
    const sg = g.createLinearGradient(0, y, 0, y + len);
    sg.addColorStop(0, 'rgba(80,58,40,0)'); sg.addColorStop(.25, 'rgba(80,58,40,.12)'); sg.addColorStop(1, 'rgba(80,58,40,0)');
    g.fillStyle = sg; g.fillRect(x, y, w, len);
  }
  for (let i = 0; i < 45; i++) {                                             // stains
    const x = 30 + R() * (W - 60), y = R() * H, r = 14 + R() * 60, sg = g.createRadialGradient(x, y, 1, x, y, r);
    sg.addColorStop(0, 'rgba(14,18,24,' + (.03 + R() * .06) + ')'); sg.addColorStop(1, 'rgba(14,18,24,0)');
    g.fillStyle = sg; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  for (let i = 0; i < 170; i++) {                                            // chipped paint along the seams
    const vert = R() < .5, sx = vert ? [0, 256][(R() * 2) | 0] + (R() - .5) * 14 : R() * W, sy = vert ? R() * H : [256, 512, 768][(R() * 3) | 0] + (R() - .5) * 14;
    const cw = 1 + R() * 3, ch = 1 + R() * 3;
    g.fillStyle = 'rgba(206,214,226,.30)'; g.fillRect(sx, sy, cw, ch);
    h.fillStyle = '#5a5a5a'; h.fillRect(sx, sy, cw, ch);
  }
  for (let i = 0; i < 2600; i++) {                                           // speckle
    const x = R() * W, y = R() * H, v = 112 + R() * 40 | 0;
    g.fillStyle = R() < .5 ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.09)'; g.fillRect(x, y, 1, 1);
    h.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')'; h.fillRect(x, y, 1, 1);
  }
  const y0 = H - 44;                                                         // hazard band (period 64 px tiles 8x)
  g.fillStyle = '#b99a2c'; g.fillRect(0, y0, W, 44); g.fillStyle = '#17191d';
  for (let x = -64; x < W + 64; x += 64) { g.beginPath(); g.moveTo(x, H); g.lineTo(x + 32, H); g.lineTo(x + 76, y0); g.lineTo(x + 44, y0); g.closePath(); g.fill(); }
  g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, y0, W, 2);
  h.fillStyle = '#8a8a8a'; h.fillRect(0, y0, W, 44);
  return { color: c, bump: bc };
}
const wallArt = makeWallArt();
const wallTexCache = {};
function wallTextures(rx) {
  if (!wallTexCache[rx]) {
    const mk = cv => { const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, 1); t.anisotropy = renderer.capabilities.getMaxAnisotropy(); return t; };
    wallTexCache[rx] = { map: mk(wallArt.color), bump: mk(wallArt.bump) };
  }
  return wallTexCache[rx];
}
function wbox(w, h, d, x, y, z, rx) {
  const tx = wallTextures(rx);
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ map: tx.map, bumpMap: tx.bump, bumpScale: 2.2, roughness: .9, metalness: .05 }));
  m.position.set(x, y, z); m.receiveShadow = true; scene.add(m); markSolid(m, 'concrete');
}
wbox(40, 10, 1, 0, 5, -56, 8);
wbox(1, 10, 70, -20, 5, -22, 14);
wbox(1, 10, 70, 20, 5, -22, 14);
wbox(40, 10, 1, 0, 5, 13, 8);

// Floor markings: lane edges, centre dashes, start line, distance bars (10-50 M), scuffs and oil stains.
// Drawn once to a transparent overlay (25.6 px/m) - purely visual and useful for judging range.
(function () {
  const ppm = 25.6, W = 1024, H = 1792, R = Math.random;
  const fc = document.createElement('canvas'); fc.width = W; fc.height = H;
  const g = fc.getContext('2d');
  const X = x => (x + 20) * ppm, Y = z => (57 + z) * ppm;
  for (let i = 0; i < 14; i++) {
    const x = R() * W, y = R() * H, r = 20 + R() * 45, sg = g.createRadialGradient(x, y, 1, x, y, r);
    sg.addColorStop(0, 'rgba(14,16,20,.24)'); sg.addColorStop(1, 'rgba(14,16,20,0)');
    g.fillStyle = sg; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  for (let i = 0; i < 90; i++) {
    const x = R() * W, y = R() * H;
    g.strokeStyle = R() < .5 ? 'rgba(18,20,24,.12)' : 'rgba(225,230,238,.07)'; g.lineWidth = 1 + R() * 2;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (R() - .5) * 34, y + (R() - .5) * 10); g.stroke();
  }
  g.fillStyle = 'rgba(232,200,64,.55)';
  [-15, 15].forEach(x => g.fillRect(X(x) - 2, Y(-52), 4, Y(10) - Y(-52)));
  g.fillStyle = 'rgba(232,200,64,.28)';
  for (let z = 9; z > -52; z -= 2.4) g.fillRect(X(0) - 1.5, Y(z - 1.2), 3, 1.2 * ppm);
  g.fillStyle = 'rgba(232,200,64,.7)'; g.fillRect(X(-15), Y(1) - 5, 30 * ppm, 10);
  g.font = 'bold 54px Arial, sans-serif'; g.textAlign = 'center';
  [-10, -20, -30, -40, -50].forEach(z => {
    g.fillStyle = 'rgba(240,244,248,.42)'; g.fillRect(X(-15), Y(z) - 3, 30 * ppm, 6);
    g.fillStyle = 'rgba(240,244,248,.5)';
    g.fillText((-z) + ' M', X(-11), Y(z) + 58); g.fillText((-z) + ' M', X(11), Y(z) + 58);
  });
  const t = new THREE.CanvasTexture(fc); t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const mk = new THREE.Mesh(new THREE.PlaneGeometry(40, 70), new THREE.MeshLambertMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  mk.rotation.x = -Math.PI / 2; mk.position.set(0, .012, -22); mk.receiveShadow = true; mk.renderOrder = 1; scene.add(mk);
})();

// Solid ceiling, support beams and industrial ceiling lights create a covered range.
const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(40, 70), new THREE.MeshLambertMaterial({ color: 0x303b49, side: THREE.DoubleSide }));
ceiling.rotation.x = -Math.PI / 2; ceiling.position.set(0, 14, -21.5); ceiling.receiveShadow = true; scene.add(ceiling);
for (let z = 7; z >= -50; z -= 11) box(40, 0.28, 0.32, 0x1b2531, 0, 13.72, z);
box(0.28, 0.28, 70, 0x1b2531, -19.4, 13.72, -21.5);
box(0.28, 0.28, 70, 0x1b2531, 19.4, 13.72, -21.5);
const lightPoolZ = [];
for (let z = 5; z >= -48; z -= 17) {
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.12, 0.65), new THREE.MeshBasicMaterial({ color: 0xfff0c8 }));
  lamp.position.set(0, 13.78, z); scene.add(lamp);
  lightPoolZ.push(z);
}
// Cheap "fake" lamp light: additive soft pools on the floor instead of real PointLights
// (every real light is evaluated for every lit pixel of every material).
{
  const pc = document.createElement('canvas'); pc.width = pc.height = 128;
  const pg = pc.getContext('2d'), gr = pg.createRadialGradient(64, 64, 2, 64, 64, 62);
  gr.addColorStop(0, 'rgba(255,226,170,.55)'); gr.addColorStop(.45, 'rgba(255,214,150,.18)'); gr.addColorStop(1, 'rgba(255,214,150,0)');
  pg.fillStyle = gr; pg.fillRect(0, 0, 128, 128);
  const poolMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(pc), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const poolGeo = new THREE.PlaneGeometry(17, 17);
  lightPoolZ.forEach(z => {
    const pool = new THREE.Mesh(poolGeo, poolMat);
    pool.rotation.x = -Math.PI / 2; pool.position.set(0, .02, z); pool.renderOrder = 1; scene.add(pool);
  });
}

// Industrial side-wall blocks and mounted cover details. These stay flush to the perimeter
// so they enrich the range without obstructing the central shooting lanes.
for (let z = 4; z >= -52; z -= 8) {
  [-1,1].forEach(side => {
    const x = side * 19.05;
    markSolid(box(0.72, 2.35, 2.15, 0x394858, x, 1.35, z), 'metal');
    markSolid(box(0.16, 1.92, 1.72, 0x617286, x - side*0.40, 1.38, z), 'metal');
    box(0.10, 0.12, 1.82, 0x202b38, x - side*0.49, 2.35, z);
    box(0.10, 0.12, 1.82, 0x202b38, x - side*0.49, 0.42, z);
    // Small recessed blue status strip on each wall module.
    box(0.035, 0.10, 0.72, 0x39a9d6, x - side*0.50, 1.85, z);
  });
}
for (let z = 3; z >= -51; z -= 16) {
  [-1,1].forEach(side => {
    markSolid(box(0.48, 5.8, 0.55, 0x263342, side*19.25, 2.9, z), 'metal');
    box(0.55, 0.18, 0.72, 0x718196, side*19.15, 5.75, z);
  });
}

// Extra ceiling infrastructure: cable trays, ventilation ducts, cross braces and lamps.
box(1.15, 0.42, 62, 0x394858, -7.2, 13.35, -21.5);
box(1.15, 0.42, 62, 0x394858, 7.2, 13.35, -21.5);
for (let z=4; z>=-50; z-=13) {
  box(0.16, 0.16, 0.85, 0x8290a0, -7.2, 13.05, z);
  box(0.16, 0.16, 0.85, 0x8290a0, 7.2, 13.05, z);
  box(13.8, 0.10, 0.12, 0x465566, 0, 13.42, z-3.0);
}
for (let z=0; z>=-48; z-=16) {
  // Recessed ceiling vent panels and their dark slats.
  box(2.8, 0.10, 1.8, 0x263443, -12.0, 13.48, z);
  for (let i=0;i<5;i++) box(2.45, 0.035, 0.07, 0x718093, -12.0, 13.40, z-0.65+i*0.32);
  box(2.8, 0.10, 1.8, 0x263443, 12.0, 13.48, z);
  for (let i=0;i<5;i++) box(2.45, 0.035, 0.07, 0x718093, 12.0, 13.40, z-0.65+i*0.32);
}
// The old orange center obstacles have been removed to keep the shooting lane clear.
const crateGroup = new THREE.Group(); scene.add(crateGroup);
const crateMeshes = [];
const wallGroup = new THREE.Group(); scene.add(wallGroup);
const wallMeshes = [
  box(10, 4, 1, 0x4a6b8a, -9, 2, -12, wallGroup),
  box(10, 4, 1, 0x4a6b8a, 9, 2, -12, wallGroup)
];

// scenery: houses and trees
const decorMeshes = [], solidCircles = [], houseBoxes = [];
function dm(geo, col, x, y, z, rotY) {
  const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: col }));
  m.position.set(x, y, z); if (rotY) m.rotation.y = rotY;
  m.castShadow = m.receiveShadow = true;
  scene.add(m); decorMeshes.push(m); return m;
}
function house(x, z, w, d) {
  dm(new THREE.BoxGeometry(w, 3.4, d), 0xd9c7a3, x, 1.7, z);
  dm(new THREE.ConeGeometry((w + 1) / 1.414, 2.4, 4), 0x8b3a2f, x, 4.6, z, Math.PI / 4);
  const front = z + d / 2 + 0.08;
  dm(new THREE.BoxGeometry(1.35, 2.25, 0.18), 0x4b3024, x, 1.12, front);
  dm(new THREE.BoxGeometry(0.08, 2.2, 0.08), 0x241b17, x - 0.62, 1.12, front + 0.1);
  dm(new THREE.SphereGeometry(0.055, 10, 8), 0xd5b36b, x + 0.42, 1.1, front + 0.13);
  [-1, 1].forEach(sd => {
    dm(new THREE.BoxGeometry(1.18, 1.18, 0.16), 0x263b50, x + sd * w / 3, 2.1, front);
    dm(new THREE.BoxGeometry(0.98, 0.98, 0.06), 0x8bc9e8, x + sd * w / 3, 2.1, front + 0.1);
    dm(new THREE.BoxGeometry(1.3, 0.1, 0.24), 0xf0e5cf, x + sd * w / 3, 2.75, front + 0.04);
  });
  dm(new THREE.BoxGeometry(0.7, 1.8, 0.7), 0x7a6f66, x + w / 3, 5, z - d / 4);
  dm(new THREE.BoxGeometry(w + 0.18, 0.18, 0.18), 0xf0e5cf, x, 0.16, front + 0.08);
  houseBoxes.push([x - w / 2, x + w / 2, z - d / 2, z + d / 2]);
}
house(-16.5, -26, 6, 6);
house(16.5, -46, 6, 6);
function bigHouse(x, z, w, d, wh) {
  const trim = 0xf2ece0, wall = 0xe3d3b0, glass = 0x9ad0ff, roof = 0x7a2f2a;
  dm(new THREE.BoxGeometry(w, wh, d), wall, x, wh / 2, z);
  dm(new THREE.BoxGeometry(w + 0.2, 0.25, d + 0.2), trim, x, wh * 0.5, z).scale.set(1, 0.3, 1);
  const fz = z + d / 2 + 0.06;
  for (let row = 0; row < 2; row++) {
    [-5, -2.7, 2.7, 5].forEach(ox => {
      dm(new THREE.BoxGeometry(1.52, 1.72, 0.16), 0x5b5146, x + ox, 1.9 + row * 3.1, fz);
      dm(new THREE.BoxGeometry(1.28, 1.48, 0.08), glass, x + ox, 1.9 + row * 3.1, fz + 0.1);
      dm(new THREE.BoxGeometry(1.3, 0.07, 0.1), trim, x + ox, 1.9 + row * 3.1, fz + 0.16);
      dm(new THREE.BoxGeometry(0.07, 1.48, 0.1), trim, x + ox, 1.9 + row * 3.1, fz + 0.16);
    });
  }
  dm(new THREE.BoxGeometry(1, 1.3, 0.15), glass, x - 1.2, 4.6, fz);
  dm(new THREE.BoxGeometry(1, 1.3, 0.15), glass, x + 1.2, 4.6, fz);
  dm(new THREE.BoxGeometry(1.95, 2.9, 0.22), 0x493126, x, 1.45, fz + 0.04);
  dm(new THREE.BoxGeometry(1.65, 2.6, 0.08), 0x70442e, x, 1.4, fz + 0.18);
  dm(new THREE.SphereGeometry(0.07, 12, 10), 0xd8b46b, x + 0.62, 1.4, fz + 0.25);
  dm(new THREE.BoxGeometry(14.4, 0.22, 0.24), trim, x, 0.22, fz + 0.12);
  // Front steps and a sign above the entrance.
  dm(new THREE.BoxGeometry(3.2, 0.22, 1.6), 0x8b929a, x, 0.12, fz + 1.15);
  dm(new THREE.BoxGeometry(2.7, 0.16, 0.8), 0xb8bdc3, x, 0.3, fz + 1.45);
  dm(new THREE.BoxGeometry(3.2, 0.42, 0.12), 0x293849, x, 3.45, fz + 0.18);
  dm(new THREE.BoxGeometry(2.9, 0.24, 0.08), 0xd5dce4, x, 3.45, fz + 0.27);
  dm(new THREE.BoxGeometry(4.5, 0.25, 2.2), trim, x, 3.1, fz + 1.0);
  [-2, 2].forEach(ox => dm(new THREE.CylinderGeometry(0.18, 0.18, 3, 12), trim, x + ox, 1.5, fz + 1.9));
  dm(new THREE.BoxGeometry(4.5, 0.2, 2.2), 0x9a9a9a, x, 0.1, fz + 1.0);
  // gable roof
  const half = d / 2 + 0.7, ang = 0.5, rise = half * Math.tan(ang), len = half / Math.cos(ang);
  [1, -1].forEach(sd => {
    const m = dm(new THREE.BoxGeometry(w + 1.2, 0.3, len), roof, x, wh + rise / 2, z + sd * half / 2);
    m.rotation.x = sd * ang;
  });
  const tri = new THREE.Shape(); tri.moveTo(-d / 2, 0); tri.lineTo(d / 2, 0); tri.lineTo(0, rise - 0.3);
  [-1, 1].forEach(sd => {
    const m = new THREE.Mesh(new THREE.ShapeGeometry(tri), new THREE.MeshLambertMaterial({ color: wall, side: THREE.DoubleSide }));
    m.rotation.y = Math.PI / 2; m.position.set(x + sd * (w / 2 + 0.02), wh, z); m.castShadow = true; scene.add(m); decorMeshes.push(m);
  });
  dm(new THREE.BoxGeometry(1.2, 3, 1.2), 0x7a6f66, x + w / 3, wh + 2.2, z - d / 4);
  houseBoxes.push([x - w / 2, x + w / 2, z - d / 2, z + d / 2 + 2.4]);
}
bigHouse(0, -50, 14, 8, 6.5);

// Abandoned range details: bins, litter, broken boards, concrete and scrap.
// Props stay on the outer shoulders so they never obstruct the main shooting lane.
const clutter = new THREE.Group(); scene.add(clutter);
const clutterMat = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.92, metalness: 0.04 });
const clutterMats = {
  bin: clutterMat(0x35434a), binLid: clutterMat(0x202b31), bag: clutterMat(0x252a30),
  paper: clutterMat(0xb7b2a4), cardboard: clutterMat(0x806044), wood: clutterMat(0x594332),
  stone: clutterMat(0x777b7d), metal: clutterMat(0x59636b), bottle: clutterMat(0x587b70)
};
function clutterMesh(geo, mat, x, y, z, rz=0, ry=0) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x,y,z); m.rotation.z=rz; m.rotation.y=ry;
  m.castShadow=true; m.receiveShadow=true; clutter.add(m); return m;
}
const propColliders = [];
function trashBin(x,z,rot=0) {
  const body = clutterMesh(new THREE.CylinderGeometry(0.42,0.34,1.15,12),clutterMats.bin,x,0.58,z,0,rot);
  const lid = clutterMesh(new THREE.CylinderGeometry(0.46,0.46,0.12,12),clutterMats.binLid,x,1.19,z,0,rot);
  clutterMesh(new THREE.BoxGeometry(0.34,0.12,0.04),clutterMats.metal,x,0.92,z+0.35,0,rot);
  [body, lid].forEach(m => { m.userData.surface = 'metal'; decorMeshes.push(m); });   // bullets are blocked by the bin
  propColliders.push({ x, z, r: 0.46, top: 1.25 });                                      // lid top = 1.19 + 0.06
  return body;
}
trashBin(-16,-9,0.18); trashBin(16,-33,-0.25); trashBin(-17,-45,0.1);
const litter = [
  [-14.2,.035,-5.5,'paper'],[-12.8,.025,-12,'cardboard'],[14.5,.03,-15,'bag'],
  [17.2,.03,-20,'paper'],[-16.8,.03,-24,'stone'],[13.8,.03,-28,'bottle'],
  [-14.8,.03,-34,'wood'],[17.1,.03,-39,'cardboard'],[-17.2,.03,-51,'bag'],[14.4,.03,-48,'paper'],
  [-11.7,.025,-17,'paper'],[11.8,.025,-37,'stone'],[16.2,.025,-7,'bottle'],[-16,.025,-39,'cardboard']
];
litter.forEach((a,i)=>{
  const mat=clutterMats[a[3]], x=a[0], y=a[1], z=a[2];
  if(a[3]==='stone') { const sr=.22+(i%3)*.07; const sm=clutterMesh(new THREE.DodecahedronGeometry(sr,0),mat,x,y+.12,z,.1*i,.3*i); sm.userData.surface='concrete'; decorMeshes.push(sm); propColliders.push({ x, z, r: sr*.92, top: y+.12+sr*.85 }); }
  else if(a[3]==='bottle') clutterMesh(new THREE.CylinderGeometry(.07,.09,.34,8),mat,x,y+.17,z,Math.PI/2,.2*i);
  else clutterMesh(new THREE.BoxGeometry(.22+(i%3)*.13,.035,.3+(i%2)*.12),mat,x,y,z,.08*i,.3*i);
});
// A few snapped planks and small rubble piles near the walls.
[[-15.5,-18,.9],[15.4,-42,-.7],[-16.2,-48,.4],[14.8,-11,-.5]].forEach(([x,z,r])=>{
  clutterMesh(new THREE.BoxGeometry(1.15,.09,.18),clutterMats.wood,x,.07,z,r,.25);
  clutterMesh(new THREE.BoxGeometry(.42,.07,.13),clutterMats.wood,x+.48,.12,z+.12,-r,.6);
});


// ---------- Phase 4: prop collision + standable surfaces ----------
// Vertical cylinders {x,z,r,top}: block the player sideways, and can be stood on once the feet are above `top`.
const PLAYER_R = 0.35, STEP_TOL = 0.2, JUMP_SPEED = 8.0, GRAVITY = 22;   // 8.0 m/s -> ~1.45 m jump (trash bin top is 1.25 m)
const _pp = { x: 0, z: 0 };
function pushOutOfProps(p, feet) {
  for (let i = 0; i < propColliders.length; i++) {
    const c = propColliders[i];
    if (feet >= c.top - STEP_TOL) continue;                 // feet are (nearly) above it: it is a floor, not a wall
    const dx = p.x - c.x, dz = p.z - c.z, rr = c.r + PLAYER_R, d2 = dx * dx + dz * dz;
    if (d2 < rr * rr) { const d = Math.sqrt(d2) || 1e-4; p.x = c.x + dx / d * rr; p.z = c.z + dz / d * rr; }
  }
}
function groundHeightAt(x, z, feet) {
  let g = 0;
  for (let i = 0; i < propColliders.length; i++) {
    const c = propColliders[i];
    if (feet < c.top - 0.25 || c.top <= g) continue;        // only support feet that came from above
    const dx = x - c.x, dz = z - c.z, rr = c.r + 0.12;
    if (dx * dx + dz * dz <= rr * rr) g = c.top;
  }
  return g;
}

flushStaticBatch();   // ~190 decorative boxes -> a single mesh / draw call

// gun
const gun = new THREE.Group();
// gunRig sits between the camera and the weapon. All locomotion animation (bob, sway, idle, jump, landing) lives here,
// so the weapon's own animations (recoil, reload, swap, knife, ADS) are untouched and the camera/crosshair never move.
const gunRig = new THREE.Group();
camera.add(gunRig); gunRig.add(gun);
scene.add(camera);
const rig = { phase: 0, move: 0, ads: 0, air: 0, scripted: 1, landY: 0, landV: 0, lagX: 0, lagY: 0, pYaw: 0, pPitch: 0, t: 0 };
let rigSpeed = 0;
function resetGunRig() {
  rig.phase = rig.move = rig.ads = rig.air = rig.landY = rig.landV = rig.lagX = rig.lagY = 0; rig.scripted = 1;
  rig.pYaw = yaw; rig.pPitch = pitch; rigSpeed = 0;
  gunRig.position.set(0, 0, 0); gunRig.rotation.set(0, 0, 0);
}
function updateGunRig(dt) {
  const R = rig, playing = state === 'playing';
  const ease = r => Math.min(1, dt * r), lim = (v, a) => Math.max(-a, Math.min(a, v));
  R.t += dt;
  if (!playing) landImpact = 0;
  R.ads += ((aiming ? 1 : 0) - R.ads) * ease(10);
  R.scripted += (((reloading || knifeAtk || swapPhase > 0) ? 0.35 : 1) - R.scripted) * ease(8);
  const k = (1 - 0.88 * R.ads) * R.scripted;                 // ADS keeps the weapon almost perfectly still
  const crouch = crouching(), walk = walking();
  R.move += ((playing && grounded ? Math.min(1, rigSpeed / 7) : 0) - R.move) * ease(9);   // 0 = still, 1 = full run
  R.air += ((playing && !grounded ? 1 : 0) - R.air) * ease(8);
  if (R.move > 0.02) R.phase += dt * Math.PI * (crouch ? 1.39 : (walk ? 1.79 : 2.33));    // one bob per footstep (matches step audio)
  const s = Math.sin(R.phase), c2 = Math.cos(R.phase * 2), A = R.move * k;
  let x = s * 0.022 * A, y = (c2 * 0.015 - 0.004) * A, z = c2 * 0.005 * A;
  let rx = c2 * 0.012 * A, ry = s * 0.014 * A, rz = -s * 0.026 * A;
  const idle = (1 - R.move) * (1 - R.air) * k;                // subtle breathing while standing still
  y += Math.sin(R.t * 1.7) * 0.0022 * idle; rx += Math.sin(R.t * 1.7 + 0.4) * 0.0035 * idle;
  x += Math.sin(R.t * 0.85) * 0.0012 * idle; rz += Math.sin(R.t * 0.85 + 1) * 0.0025 * idle;
  const air = R.air * k;                                      // jump: weapon floats up and tilts with vertical speed
  y += 0.010 * air; rx += lim(vy * 0.0055, 0.03) * air;
  if (landImpact > 0) { R.landV = -Math.max(0.3, Math.min(1.1, landImpact * 0.15)); landImpact = 0; }
  R.landV += (-120 * R.landY - 14 * R.landV) * dt; R.landY += R.landV * dt;      // damped spring: dip on landing, then settle
  const lk = 1 - 0.7 * R.ads;
  y += R.landY * lk; rx += R.landY * 0.35 * lk;
  if (playing && dt > 0) {                                    // weapon lags slightly behind camera turns
    R.lagY += (lim(-(yaw - R.pYaw) / dt * 0.010, 0.035) - R.lagY) * ease(9);
    R.lagX += (lim(-(pitch - R.pPitch) / dt * 0.010, 0.03) - R.lagX) * ease(9);
  } else { R.lagY *= 1 - ease(10); R.lagX *= 1 - ease(10); }
  R.pYaw = yaw; R.pPitch = pitch;
  const ls = 1 - 0.8 * R.ads;
  gunRig.position.set(x, y, z);
  gunRig.rotation.set(rx + R.lagX * ls, ry + R.lagY * ls, rz);
  // Hands: the grip hand and support hand shift very slightly against the weapon while walking (fingers settling),
  // and the knife's off hand follows the draw/holster dip and pulls back a little on each swing.
  const hm = R.move * (1 - 0.9 * R.ads) * (playing ? 1 : 0), gu = gun.userData;
  if (gu.rh) gu.rh.rotation.set(Math.cos(R.phase * 2) * 0.010 * hm, 0, Math.sin(R.phase) * 0.016 * hm);
  if (gu.lh) { if (reloading) gu.lh.rotation.set(0, 0, 0); else gu.lh.rotation.set(-Math.cos(R.phase * 2) * 0.010 * hm, 0, -Math.sin(R.phase) * 0.014 * hm); }
  const isKnife = gu.kind === 'knife'; offHand.visible = isKnife;
  if (isKnife) {
    const dy = gu.baseY === undefined ? 0 : Math.min(0, gun.position.y - gu.baseY);
    const pull = knifeAtk ? Math.sin(Math.PI * Math.min(1, knifeAtk.t / knifeAtk.a.dur)) : 0;
    offHand.position.set(OFF_BASE.x - 0.02 * pull, OFF_BASE.y + dy - 0.025 * pull, OFF_BASE.z + 0.05 * pull);
    offHand.rotation.set(0, 0, Math.sin(R.t * 1.3) * 0.012 * k);
  }
}
// Magazine meshes share cached geometry/materials, so rebuilding the gun or dropping a magazine
// never allocates new GPU resources.
const magAssetCache = {};
function makeMagGroup(kind) {
  let a = magAssetCache[kind];
  if (!a) {
    const v = kind === 'vandal', op = kind === 'operator', d = v ? [.07, .29, .12] : (op ? [.06, .2, .1] : [.075, .32, .14]);
    a = magAssetCache[kind] = {
      d,
      body: new THREE.BoxGeometry(d[0], d[1], d[2]),
      plate: new THREE.BoxGeometry(d[0] + .012, .028, d[2] + .012),
      round: new THREE.CylinderGeometry(.016, .016, .05, 8),
      bodyMat: new THREE.MeshLambertMaterial({ color: v ? 0x554b78 : (op ? 0x2c343d : 0xa8a2b8) }),
      plateMat: new THREE.MeshLambertMaterial({ color: 0x15161b }),
      roundMat: new THREE.MeshLambertMaterial({ color: 0xc9a24a })
    };
  }
  const g = new THREE.Group();
  const body = new THREE.Mesh(a.body, a.bodyMat);
  const plate = new THREE.Mesh(a.plate, a.plateMat); plate.position.y = -a.d[1] / 2 - .008;
  const round = new THREE.Mesh(a.round, a.roundMat); round.position.y = a.d[1] / 2 + .018;
  g.add(body); g.add(plate); g.add(round);
  return g;
}
// Shared, cached gun materials: specular highlights, brushed-metal and stippled-grip textures (no per-rebuild allocation).
const gunTex = (() => {
  const mkTex = draw => { const c = document.createElement('canvas'); c.width = c.height = 128; draw(c.getContext('2d')); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };
  const brushed = mkTex(g => {
    g.fillStyle = '#dcdce2'; g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 260; i++) {
      g.strokeStyle = 'rgba(' + (Math.random() < .5 ? '255,255,255' : '60,60,70') + ',' + (.05 + Math.random() * .1) + ')';
      const y = Math.random() * 128, x = Math.random() * 128; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 20 + Math.random() * 90, y); g.stroke();
    }
  });
  const stipple = mkTex(g => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, 128, 128); g.fillStyle = '#fff';
    for (let y = 0; y < 128; y += 8) for (let x = 0; x < 128; x += 8) { g.beginPath(); g.arc(x + ((y / 8) % 2) * 4, y + 4, 2.2, 0, 7); g.fill(); }
  });
  brushed.repeat.set(2, 2); stipple.repeat.set(3, 3);
  return { brushed, stipple };
})();
const GUN_METAL = [0xb9b9c9, 0xa8a2b8, 0xd3d7dc, 0xaab0b8, 0xd8d6df, 0xd8dde3];
const GUN_GRIP = [0x171722, 0x16181b, 0x252330, 0x2a2d31];
const gunMatCache = {};
function gunMat(col) {
  let m = gunMatCache[col];
  if (!m) {
    const metal = GUN_METAL.includes(col), grip = GUN_GRIP.includes(col);
    m = gunMatCache[col] = new THREE.MeshPhongMaterial({ color: col, shininess: metal ? 95 : 38, specular: metal ? 0x9a9aa8 : 0x2e2e34,
      map: metal ? gunTex.brushed : null, bumpMap: grip ? gunTex.stipple : null, bumpScale: grip ? 0.9 : 0 });
  }
  return m;
}
// ---------- Realistic first-person hands + knife (shared helpers) ----------
// Hands are built from tapered limb segments and joint balls placed directly on points that wrap the handle/grip,
// so the fingers really curl around the weapon instead of floating next to it. Materials are cached and the
// per-rebuild geometries are disposed on the next rebuild (handSink) so weapon switching never leaks GPU memory.
const HAND_MAT = {
  skin:   new THREE.MeshStandardMaterial({ color: 0xd9a982, roughness: 0.78 }),
  glove:  new THREE.MeshStandardMaterial({ color: 0x2f4552, roughness: 0.60, metalness: 0.08 }),
  gloveD: new THREE.MeshStandardMaterial({ color: 0x1c2a33, roughness: 0.70 }),
  accent: new THREE.MeshStandardMaterial({ color: 0x6ee7cf, roughness: 0.40, emissive: 0x0f5c4d })
};
const KNIFE_MAT = {
  gold:  new THREE.MeshPhongMaterial({ color: 0xcfa93a, shininess: 90,  specular: 0xfff0b0 }),
  steel: new THREE.MeshPhongMaterial({ color: 0xdfe5ea, shininess: 120, specular: 0xffffff }),
  dark:  new THREE.MeshPhongMaterial({ color: 0x1a1d22, shininess: 40 }),
  glow:  new THREE.MeshBasicMaterial({ color: 0x74ffb0 })
};
const handGeo = [];            // geometries of the current weapon's hands/knife (disposed on rebuild)
let handSink = handGeo;
const _UP = new THREE.Vector3(0, 1, 0), _hd = new THREE.Vector3();
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
function hSeg(parent, a, b, r0, r1, mat) {              // tapered cylinder from point a (radius r0) to point b (radius r1)
  _hd.subVectors(b, a); const L = _hd.length(); if (L < 1e-4) return null;
  const g = new THREE.CylinderGeometry(r1, r0, L, 10, 1); handSink.push(g);
  const m = new THREE.Mesh(g, mat);
  m.position.addVectors(a, b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(_UP, _hd.normalize());
  parent.add(m); return m;
}
function hBall(parent, p, r, mat, sx, sy, sz) {         // joint / palm ellipsoid
  const g = new THREE.SphereGeometry(r, 12, 9); handSink.push(g);
  const m = new THREE.Mesh(g, mat); m.position.copy(p);
  if (sx !== undefined) m.scale.set(sx, sy, sz);
  parent.add(m); return m;
}
function hBox(parent, w, h, d, p, mat, rx) {
  const g = new THREE.BoxGeometry(w, h, d); handSink.push(g);
  const m = new THREE.Mesh(g, mat); m.position.copy(p); if (rx) m.rotation.x = rx;
  parent.add(m); return m;
}
// A finger/thumb: segments run through pts; mats[i] colours segment i (glove on the base, bare skin at the tip).
function hChain(parent, pts, radii, mats) {
  for (let i = 0; i < pts.length - 1; i++) hSeg(parent, pts[i], pts[i + 1], radii[i], radii[i + 1], mats[Math.min(i, mats.length - 1)]);
  for (let i = 0; i < pts.length; i++) hBall(parent, pts[i], radii[i] * 1.04, mats[Math.min(Math.max(i - 1, 0), mats.length - 1)]);
}
const FINGER_MATS = [HAND_MAT.glove, HAND_MAT.glove, HAND_MAT.skin];     // fingerless glove: bare fingertips
// Wrist cuff + bare forearm that leaves the screen at the lower edge.
function hForearm(parent, wrist, cuffEnd, elbow) {
  hBall(parent, wrist, 0.042, HAND_MAT.glove);
  hSeg(parent, wrist, cuffEnd, 0.046, 0.05, HAND_MAT.gloveD);
  hSeg(parent, cuffEnd, elbow, 0.045, 0.075, HAND_MAT.skin);
}

// Karambit-style knife (handle along z, blade pointing -z and curving upward) with a ring at the pommel.
function buildKnifeModel(parent) {
  const K = KNIFE_MAT;
  hSeg(parent, V3(0, 0, -0.06), V3(0, 0, 0.15), 0.029, 0.026, K.gold);                  // handle
  [-0.012, 0.038, 0.088].forEach(z => hSeg(parent, V3(0, 0, z - 0.006), V3(0, 0, z + 0.006), 0.0325, 0.0325, K.dark));   // grip bands
  hSeg(parent, V3(0, 0, -0.068), V3(0, 0, -0.082), 0.042, 0.042, K.dark);                // guard
  const rg = new THREE.TorusGeometry(0.034, 0.007, 8, 18); handSink.push(rg);            // finger ring, in the blade plane
  const ring = new THREE.Mesh(rg, K.gold); ring.position.set(0, -0.01, 0.168); ring.rotation.y = Math.PI / 2; parent.add(ring);
  // Curved blade: six tapering segments, each turned a little further upward.
  let p = V3(0, 0.004, -0.082), th = 0;
  for (let i = 0; i < 6; i++) {
    const l = 0.064, h = 0.05 - i * 0.0065, d = V3(0, Math.sin(th), -Math.cos(th));
    const c = p.clone().addScaledVector(d, l * 0.5);
    hBox(parent, 0.009, h, l * 1.08, c, K.steel, th);
    const up = V3(0, Math.cos(th), Math.sin(th));                                        // segment's local "up"
    hBox(parent, 0.0105, 0.0045, l * 0.96, c.clone().addScaledVector(up, h * 0.18), K.glow, th);   // glowing inlay
    p.addScaledVector(d, l); th += 0.17;
  }
}
// Right hand in a forward (hammer) grip: fingers wrap the handle from the right, thumb rests along the spine.
function buildKnifeGripHand(parent) {
  const S = HAND_MAT, R = [0.062, 0.047, 0.044, 0.042], A = [25, -38, -100, -152].map(a => a * Math.PI / 180);
  for (let j = 0; j < 4; j++) {
    const zj = -0.022 + 0.031 * j, pts = A.map((a, k) => V3(R[k] * Math.cos(a), R[k] * Math.sin(a), zj - k * 0.007));
    const s = j === 3 ? 0.9 : 1;
    hChain(parent, pts, [0.0155 * s, 0.0145 * s, 0.0135 * s, 0.0125 * s], FINGER_MATS);
  }
  hBall(parent, V3(0.078, -0.005, 0.05), 0.05, S.glove, 0.52, 1.0, 1.3);                  // palm / back of the hand
  hBox(parent, 0.006, 0.05, 0.06, V3(0.103, 0.0, 0.045), S.accent);                       // glove stripe
  hChain(parent, [V3(0.062, 0.03, 0.115), V3(0.036, 0.048, 0.045), V3(0.018, 0.049, -0.015), V3(0.009, 0.046, -0.062)],
    [0.0185, 0.016, 0.0145, 0.0125], FINGER_MATS);                                         // thumb along the spine
  hForearm(parent, V3(0.105, -0.04, 0.16), V3(0.125, -0.065, 0.215), V3(0.27, -0.24, 0.72));
}
// Vandal: trigger hand (index on the trigger, three fingers around the grip, thumb on the left of the receiver).
function buildVandalGripHand(parent) {
  const S = HAND_MAT, zc = y => 0.13 - (y + 0.13) * 0.29;       // pistol-grip centre line (it leans back toward the bottom)
  const rel = [[0.05, 0.034], [0.058, -0.008], [0.036, -0.048], [-0.004, -0.056]];
  [-0.095, -0.127, -0.159].forEach((y, j) => {
    const s = j === 2 ? 0.92 : 1, pts = rel.map((r, k) => V3(r[0], y - k * 0.0017, zc(y) + r[1]));
    hChain(parent, pts, [0.0165 * s, 0.0155 * s, 0.0145 * s, 0.0135 * s], FINGER_MATS);
  });
  hChain(parent, [V3(0.052, -0.074, 0.16), V3(0.05, -0.077, 0.095), V3(0.03, -0.083, 0.03), V3(0.005, -0.09, -0.012)],
    [0.0155, 0.0145, 0.0135, 0.0122], FINGER_MATS);                                         // trigger finger
  hChain(parent, [V3(-0.01, -0.09, 0.2), V3(-0.058, -0.058, 0.15), V3(-0.066, -0.04, 0.085), V3(-0.064, -0.03, 0.02)],
    [0.018, 0.016, 0.0145, 0.0125], FINGER_MATS);                                           // thumb
  hBall(parent, V3(0.03, -0.118, 0.186), 0.05, S.glove, 0.82, 1.25, 0.95);                  // palm behind the grip
  hBall(parent, V3(0.02, -0.088, 0.2), 0.04, S.glove);                                      // web between thumb and index
  hHandStripe(parent, V3(0.073, -0.12, 0.186));
  hForearm(parent, V3(0.055, -0.15, 0.27), V3(0.075, -0.18, 0.325), V3(0.17, -0.5, 0.8));
}
function hHandStripe(parent, p) { hBox(parent, 0.006, 0.05, 0.05, p, HAND_MAT.accent); }
// Vandal: support hand cups the handguard from below, fingers curl up its right side, thumb along the left.
function buildVandalSupportHand(parent) {
  const S = HAND_MAT, zs = [-0.49, -0.455, -0.42, -0.385];
  zs.forEach((z, j) => {
    const s = j === 3 ? 0.92 : 1;
    hChain(parent, [V3(-0.06, -0.074, z), V3(0.035, -0.075, z), V3(0.064, -0.045, z), V3(0.066, -0.005, z)],
      [0.0155 * s, 0.0148 * s, 0.014 * s, 0.0128 * s], FINGER_MATS);
  });
  hChain(parent, [V3(-0.085, -0.095, -0.36), V3(-0.072, -0.055, -0.43), V3(-0.068, -0.012, -0.5), V3(-0.066, 0.012, -0.56)],
    [0.0175, 0.0155, 0.014, 0.0122], FINGER_MATS);
  hBall(parent, V3(-0.03, -0.092, -0.4), 0.05, S.glove, 1.05, 0.5, 1.45);
  hBox(parent, 0.05, 0.006, 0.06, V3(-0.03, -0.114, -0.4), S.accent);
  hForearm(parent, V3(-0.115, -0.12, -0.31), V3(-0.15, -0.15, -0.26), V3(-0.28, -0.5, 0.3));
}
// Off hand for the knife: relaxed open hand in the lower-left of the view (lives on the gun rig so it bobs with the view).
const offHand = new THREE.Group(); offHand.visible = false; gunRig.add(offHand);
const OFF_BASE = V3(-0.2, -0.22, -0.5);
(function buildOffHand() {
  handSink = [];                                         // permanent geometry: never disposed
  const S = HAND_MAT, g = new THREE.Group(); g.rotation.set(0.42, -0.3, 0.45); offHand.add(g);
  const fan = [0.10, 0.03, -0.04, -0.12], xs = [0.033, 0.011, -0.011, -0.033];
  const lens = [[0.046, 0.03, 0.024], [0.05, 0.033, 0.026], [0.046, 0.03, 0.024], [0.036, 0.024, 0.02]], curl = [0.12, 0.14, 0.16, 0.2];
  for (let i = 0; i < 4; i++) {
    const pts = [V3(xs[i], 0, -0.03)]; let pitch = 0;
    lens[i].forEach(l => { pitch -= curl[i]; const q = pts[pts.length - 1];
      pts.push(V3(q.x + Math.sin(fan[i]) * Math.cos(pitch) * l, q.y + Math.sin(pitch) * l, q.z - Math.cos(fan[i]) * Math.cos(pitch) * l)); });
    const s = i === 3 ? 0.9 : 1;
    hChain(g, pts, [0.0105 * s, 0.0098 * s, 0.009 * s, 0.0082 * s], FINGER_MATS);
  }
  hBall(g, V3(0, 0, 0.035), 0.05, S.glove, 1.05, 0.36, 1.25);
  hBox(g, 0.07, 0.005, 0.05, V3(0, 0.019, 0.0), S.accent);
  hChain(g, [V3(0.05, -0.002, 0.045), V3(0.082, 0, 0.012), V3(0.1, 0.008, -0.022), V3(0.108, 0.018, -0.05)],
    [0.014, 0.0125, 0.011, 0.01], FINGER_MATS);
  hSeg(g, V3(0, 0, 0.1), V3(0, 0, 0.15), 0.043, 0.047, S.gloveD);
  hSeg(g, V3(0, 0, 0.15), V3(0, 0, 0.56), 0.042, 0.07, S.skin);
  handSink = handGeo;
})();
function buildGun(w) {
  while (gun.children.length) gun.remove(gun.children[0]);
  handGeo.forEach(g => g.dispose()); handGeo.length = 0; handSink = handGeo;    // free the previous weapon's hand/knife geometry
  gun.userData.mag = gun.userData.lh = gun.userData.rh = gun.userData.drum = gun.userData.pose = null;
  gun.userData.kind = w.melee ? 'knife' : w.name.toLowerCase();
  gun.rotation.set(0, 0, 0);
  // Removable magazine (rifles) and a grouped support hand that can reach for it during reload.
  const addMag = (kind, x, y, z, rx) => {
    const m = makeMagGroup(kind); m.position.set(x, y, z); m.rotation.x = rx; gun.add(m);
    gun.userData.mag = m; gun.userData.magKind = kind; gun.userData.magHome = m.position.clone(); gun.userData.magRotX = rx;
  };
  const leftHand = fn => {
    const start = gun.children.length; fn();
    const lh = new THREE.Group(); gun.children.slice(start).forEach(c => lh.add(c)); gun.add(lh); gun.userData.lh = lh;
  };
  const rightHand = fn => {
    const start = gun.children.length; fn();
    const rh = new THREE.Group(); gun.children.slice(start).forEach(c => rh.add(c)); gun.add(rh); gun.userData.rh = rh;
  };
  // Static first-person carry pose (cant / toe-in) applied to everything built so far; recoil, reload, swap and knife
  // animations keep driving `gun` itself, so they are unaffected.
  const wrapPose = (rx, ry, rz) => {
    const pose = new THREE.Group(); gun.children.slice().forEach(c => pose.add(c));
    pose.rotation.set(rx, ry, rz); gun.add(pose); gun.userData.pose = pose;
  };
  const mk = (geo, col, x, y, z, rx) => {
    const m = new THREE.Mesh(geo, gunMat(col));
    m.position.set(x, y, z); if (rx) m.rotation.x = rx; gun.add(m); return m;
  };
  const B = (a, b, c) => new THREE.BoxGeometry(a, b, c);
  const C = (r, h) => new THREE.CylinderGeometry(r, r, h, 14);
  const D = 0x2a2d31, K = 0x16181b;
  const SKIN = 0xf0c8a0, SLEEVE = 0x2b3a55;
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xd9a982, roughness: 0.78 });
  const sleeveMat = new THREE.MeshStandardMaterial({ color: 0x263b59, roughness: 0.88 });
  const gloveSeam = new THREE.MeshStandardMaterial({ color: 0x9b765c, roughness: 0.9 });
  const hand = (x, y, z, side=1) => {
    // Palm, raised knuckles, curled fingers and thumb give the grip a more human silhouette.
    const palm = new THREE.Mesh(new THREE.SphereGeometry(0.105,20,16), skinMat);
    palm.position.set(x,y,z); palm.scale.set(1.12,0.82,1.28); gun.add(palm);
    for (let i=0;i<4;i++) {
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.034,12,10), skinMat);
      f.position.set(x+(i-1.5)*0.043,y-0.035,z-0.09); f.scale.set(.78,.78,1.85); f.rotation.x=0.35; f.rotation.z=(i-1.5)*-0.12; gun.add(f);
      const knuckle = new THREE.Mesh(new THREE.SphereGeometry(0.025,10,8), skinMat);
      knuckle.position.set(x+(i-1.5)*0.043,y-0.018,z-0.045); gun.add(knuckle);
    }
    const thumb = new THREE.Mesh(new THREE.SphereGeometry(0.04,12,10), skinMat);
    thumb.position.set(x+side*0.095,y+0.025,z-0.005); thumb.scale.set(.8,1.0,1.8); thumb.rotation.z=side*0.9; thumb.rotation.x=-0.45; gun.add(thumb);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.105,0.115,0.12,14), gloveSeam);
    cuff.rotation.x=Math.PI/2; cuff.position.set(x,y+0.005,z+0.13); gun.add(cuff);
  };
  const arm = (a, b) => {
    const A = new THREE.Vector3(a[0], a[1], a[2]), Bv = new THREE.Vector3(b[0], b[1], b[2]), d = Bv.clone().sub(A);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.115,0.16,d.length(),18), sleeveMat);
    m.position.copy(A.clone().add(Bv).multiplyScalar(0.5));
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.clone().normalize()); gun.add(m);
    const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.14,14,12),sleeveMat); elbow.position.copy(A); gun.add(elbow);
  };
  if (w.melee) {
    buildKnifeModel(gun); buildKnifeGripHand(gun);
    wrapPose(0.40, 0.30, -0.14);                 // blade up and toward the centre, like the reference
    gun.position.set(0.26, -0.25, -0.64);
    return;
  }
  if (w.name === 'Vandal') {
    const violet = 0x28243e, violet2 = 0x554b78, silver = 0xb9b9c9, edge = 0x171722;
    mk(B(.11,.13,.58),violet,0,0,0);                         // sculpted receiver
    mk(B(.085,.035,.58),silver,0,.078,-.015);               // upper receiver rail
    mk(B(.10,.105,.36),violet2,0,-.005,-.43);               // angular handguard
    mk(B(.065,.07,.36),edge,0,-.018,-.75);                   // barrel shroud
    mk(C(.024,.38),silver,0,.012,-.88,Math.PI/2);            // barrel
    mk(C(.043,.12),edge,0,.012,-1.08,Math.PI/2);             // muzzle
    mk(B(.085,.16,.34),violet,0,-.02,.43,.1);                // stock
    mk(B(.09,.025,.28),violet2,0,-.095,.49,.1);              // stock accent
    mk(B(.06,.19,.08),edge,0,-.13,.13,-.28);                // pistol grip
    addMag('vandal',0,-.19,-.12,.38);                        // curved magazine (removable)
    mk(B(.045,.055,.07),silver,0,.13,-.2);                  // sight
    // Silver trim and ornamental panels inspired by the supplied dark-violet rifle reference.
    mk(B(.014,.018,.48),silver,-.058,.055,-.02);
    mk(B(.014,.018,.34),silver,.058,.045,-.42);
    mk(new THREE.OctahedronGeometry(.075,0),violet2,0,.095,.18);
    mk(B(.018,.06,.22),silver,-.052,-.015,.42,.15);
    // --- extra realism: rail ticks, ejection port, trigger group, vents, sights, muzzle grooves, butt pad ---
    for (let i=0;i<9;i++) mk(B(.07,.012,.02),edge,0,.098,-.27+i*.058);   // top-rail ticks
    mk(B(.012,.04,.14),edge,.058,.01,-.05);                              // ejection port
    mk(B(.02,.025,.06),silver,-.062,.04,-.02);                           // charging handle
    mk(B(.012,.045,.012),silver,0,-.095,-.01,.3);                        // trigger blade
    mk(B(.012,.012,.13),edge,0,-.125,.0);                                // trigger guard (bottom)
    mk(B(.012,.05,.012),edge,0,-.1,-.075);                               // trigger guard (front)
    mk(B(.02,.025,.03),silver,.05,-.085,-.1);                            // magazine release
    for (let i=0;i<4;i++) [-1,1].forEach(sd => mk(B(.012,.03,.045),edge,sd*.052,-.005,-.32-i*.075));   // handguard vents
    for (let i=0;i<3;i++) mk(C(.046,.012),silver,0,.012,-1.03-i*.045,Math.PI/2);                         // muzzle grooves
    mk(C(.02,.01),0x000000,0,.012,-1.146,Math.PI/2);                     // bore
    mk(B(.012,.05,.012),edge,0,.055,-1.0);                               // front sight post
    mk(B(.05,.02,.03),edge,0,.095,.15);                                  // rear sight
    mk(B(.012,.012,.012),silver,.057,.03,.2); mk(B(.012,.012,.012),silver,.057,-.03,.2);   // screws
    mk(B(.09,.17,.03),edge,0,-.02,.6,.1);                                // butt pad
    rightHand(() => buildVandalGripHand(gun));
    leftHand(() => buildVandalSupportHand(gun));
    wrapPose(.02, .07, -.04);
    gun.position.set(.3,-.27,-.75); return;
  }
  if (w.name === 'Phantom') {
    const pearl=0xd8d6df, pale=0xa8a2b8, plum=0x62465f, dark=0x252330, pink=0xa96d91;
    mk(B(.12,.14,.62),pearl,0,0,0);
    mk(B(.09,.035,.62),dark,0,.09,-.02);
    mk(B(.12,.11,.4),plum,0,-.005,-.43);
    mk(B(.075,.075,.34),dark,0,0,-.78);
    mk(C(.022,.4),pale,0,.015,-.94,Math.PI/2);
    mk(C(.042,.13),dark,0,.015,-1.14,Math.PI/2);
    mk(B(.09,.16,.36),plum,0,-.015,.46,.08);
    mk(B(.07,.2,.1),dark,0,-.14,.15,-.25);
    addMag('phantom',0,-.2,-.12,.28);                       // Phantom magazine (removable)
    mk(B(.045,.055,.08),dark,0,.14,-.22);
    // Shell-like upper shroud and flowing pale side panels.
    mk(B(.13,.025,.48),pink,0,.105,-.02);
    mk(B(.018,.018,.5),pale,-.066,.045,-.03);
    mk(B(.018,.018,.5),pale,.066,.045,-.03);
    mk(new THREE.TorusGeometry(.13,.018,6,18),pink,0,.085,.18);
    mk(B(.025,.12,.23),plum,-.067,-.015,-.4,.12);
    mk(B(.025,.12,.23),plum,.067,-.015,-.4,-.12);
    // --- extra realism: suppressor baffles, rail ticks, ports, trigger group, sights, butt pad ---
    for (let i=0;i<5;i++) mk(C(.05,.012),pale,0,0,-.66-i*.07,Math.PI/2);  // suppressor baffle rings
    for (let i=0;i<9;i++) mk(B(.08,.012,.02),dark,0,.113,-.27+i*.06);     // rail ticks
    mk(B(.012,.04,.14),dark,.064,.01,-.05);                               // ejection port
    mk(B(.02,.025,.06),pale,-.07,.045,-.02);                              // charging handle
    mk(B(.012,.045,.012),pale,0,-.1,-.01,.3);                             // trigger blade
    mk(B(.012,.012,.13),dark,0,-.13,.0);                                  // trigger guard (bottom)
    mk(B(.012,.05,.012),dark,0,-.105,-.075);                              // trigger guard (front)
    for (let i=0;i<4;i++) [-1,1].forEach(sd => mk(B(.012,.03,.045),dark,sd*.062,-.005,-.32-i*.075));     // handguard vents
    mk(C(.02,.01),0x000000,0,.015,-1.206,Math.PI/2);                      // bore
    mk(B(.012,.012,.012),pale,.062,.03,.2); mk(B(.012,.012,.012),pale,.062,-.03,.2);   // screws
    mk(B(.09,.17,.03),dark,0,-.015,.65,.08);                              // butt pad
    hand(0,-.19,.13,1); arm([0,-.2,.17],[.15,-.5,.75]);
    leftHand(() => { hand(0,-.09,-.42,-1); arm([0,-.1,-.38],[-.28,-.5,.35]); });
    gun.position.set(.3,-.27,-.75); return;
  }
  if (w.name === 'Operator') {
    const steel = 0x1b2026, steel2 = 0x2c343d, trim = 0xb9c2cc, glow = 0x39d6c7, edge = 0x11151a;
    mk(B(.11,.14,.72),steel,0,0,.02);                          // receiver
    mk(B(.085,.03,.70),steel2,0,.085,.02);                     // top rail
    for (let i=0;i<11;i++) mk(B(.075,.012,.02),edge,0,.103,-.30+i*.062);   // rail ticks
    mk(B(.10,.105,.5),steel2,0,-.005,-.52);                    // forend (support hand rests under it)
    mk(B(.014,.02,.46),glow,.058,.0,-.5);                      // forend light strip
    mk(B(.014,.02,.46),glow,-.058,.0,-.5);
    mk(C(.032,.62),steel,0,.012,-1.0,Math.PI/2);               // heavy barrel
    mk(C(.05,.14),steel2,0,.012,-1.36,Math.PI/2);              // muzzle brake
    for (let i=0;i<3;i++) mk(B(.112,.012,.03),edge,0,.012,-1.32-i*.04);    // brake slots
    mk(C(.02,.01),0x000000,0,.012,-1.435,Math.PI/2);           // bore
    mk(B(.09,.17,.45),steel2,0,-.03,.55,.06);                  // thumbhole stock
    mk(B(.085,.07,.32),steel,0,.075,.52);                      // cheek riser
    mk(B(.10,.2,.035),edge,0,-.03,.79,.06);                    // recoil pad
    mk(B(.012,.2,.3),glow,-.047,-.03,.55,.06);                 // stock inlay
    mk(B(.06,.19,.08),edge,0,-.13,.13,-.28);                   // pistol grip
    mk(B(.012,.045,.012),trim,0,-.095,-.01,.3);                // trigger
    mk(B(.012,.012,.13),edge,0,-.125,.0);                      // trigger guard (bottom)
    mk(B(.012,.05,.012),edge,0,-.1,-.075);                     // trigger guard (front)
    mk(B(.012,.04,.14),edge,.058,.01,-.05);                    // ejection port
    // scope
    mk(C(.04,.5),edge,0,.17,-.05,Math.PI/2);                   // tube
    mk(C(.058,.14),steel,0,.17,-.34,Math.PI/2);                // objective bell
    mk(C(.05,.1),steel,0,.17,.24,Math.PI/2);                   // eyepiece
    mk(C(.052,.012),0x4fd6ff,0,.17,-.41,Math.PI/2);            // front lens
    mk(B(.05,.07,.05),trim,0,.12,-.18); mk(B(.05,.07,.05),trim,0,.12,.1);   // mounts
    mk(C(.018,.04),trim,0,.222,-.02);                          // elevation turret
    mk(C(.018,.04),trim,.062,.17,-.02).rotation.z = Math.PI/2; // windage turret
    addMag('operator',0,-.16,-.12,.1);                         // removable magazine
    // bolt handle (animated after every shot)
    const bolt = new THREE.Group(); bolt.position.set(.07,.02,.12); gun.add(bolt);
    gun.userData.bolt = bolt; gun.userData.boltHome = bolt.position.clone();
    const bm = (geo, col, x, y, z, rz) => { const m = new THREE.Mesh(geo, gunMat(col)); m.position.set(x, y, z); if (rz) m.rotation.z = rz; bolt.add(m); };
    bm(B(.03,.05,.1),steel2,0,0,0);                            // bolt body
    bm(C(.011,.09),trim,.05,0,0,Math.PI/2);                    // handle arm
    bm(new THREE.SphereGeometry(.026,12,10),edge,.1,0,0);      // knob
    rightHand(() => buildVandalGripHand(gun));
    leftHand(() => buildVandalSupportHand(gun));
    wrapPose(.02, .07, -.04);
    gun.position.set(.3, -.28, -.8); return;
  }
  if (w.name === 'Shotgun') {
    const poly = 0x23262b, poly2 = 0x343a42, metal = 0x6e7681, amber = 0xe08a3a, edge = 0x14161a, trim = 0xb9b9c9;
    mk(B(.105,.13,.5),poly,0,0,.05);                           // receiver
    mk(B(.08,.03,.5),poly2,0,.08,.05);                         // top rail
    mk(B(.012,.045,.17),edge,.057,.01,.0);                     // ejection port
    for (let i=0;i<6;i++) mk(B(.07,.012,.02),edge,0,.098,-.18+i*.075);      // rail ticks
    mk(C(.03,.95),metal,0,.02,-.75,Math.PI/2);                 // barrel
    mk(C(.036,.62),poly2,0,-.04,-.62,Math.PI/2);               // magazine tube
    mk(C(.04,.05),trim,0,-.04,-.945,Math.PI/2);                // tube cap
    mk(C(.038,.05),edge,0,.02,-1.235,Math.PI/2);               // muzzle ring
    mk(C(.024,.01),0x000000,0,.02,-1.262,Math.PI/2);           // bore
    mk(B(.012,.04,.012),amber,0,.065,-1.2);                    // front bead sight
    mk(B(.04,.012,.04),edge,0,.098,.2);                        // rear sight
    mk(B(.085,.16,.4),poly,0,-.025,.47,.08);                   // stock
    mk(B(.10,.19,.03),edge,0,-.025,.68,.08);                   // recoil pad
    mk(B(.014,.14,.25),amber,-.044,-.025,.47,.08);             // stock accent
    mk(B(.06,.19,.08),edge,0,-.13,.13,-.28);                   // pistol grip
    mk(B(.012,.045,.012),trim,0,-.095,-.01,.3);                // trigger
    mk(B(.012,.012,.13),edge,0,-.125,.0);                      // trigger guard (bottom)
    mk(B(.012,.05,.012),edge,0,-.1,-.075);                     // trigger guard (front)
    for (let i=0;i<4;i++) mk(C(.016,.07),0xc0392b,-.062,.035,-.02+i*.045,Math.PI/2);   // side shell carrier
    // pump forend (slides back and forward after every shot)
    const pump = new THREE.Group(); gun.add(pump); gun.userData.pump = pump;
    const pm = (geo, col, x, y, z) => { const m = new THREE.Mesh(geo, gunMat(col)); m.position.set(x, y, z); pump.add(m); };
    pm(B(.10,.105,.36),poly2,0,-.005,-.43);
    for (let i=0;i<7;i++) pm(B(.104,.108,.008),edge,0,-.005,-.57+i*.05);   // grip grooves
    pm(B(.012,.02,.3),amber,.054,.02,-.43);
    rightHand(() => buildVandalGripHand(gun));
    leftHand(() => buildVandalSupportHand(gun));
    wrapPose(.02, .07, -.04);
    gun.position.set(.3, -.27, -.76); return;
  }
  // Sheriff revolver
  mk(B(0.07, 0.08, 0.36), D, 0, 0.02, -0.17);                  // barrel block
  mk(B(0.05, 0.015, 0.36), 0xd3d7dc, 0, 0.067, -0.17);         // top strip
  gun.userData.drum = mk(C(0.062, 0.1), 0xaab0b8, 0, 0, 0.03, Math.PI / 2);        // cylinder drum
  mk(B(0.075, 0.1, 0.12), K, 0, -0.005, 0.12);                 // frame
  mk(B(0.03, 0.04, 0.04), K, 0, 0.06, 0.17, -0.5);             // hammer
  mk(B(0.065, 0.22, 0.1), K, 0, -0.14, 0.2, -0.4);
  // --- extra realism: cylinder flutes, ejector rod, trigger group, sights, muzzle crown, grip panels ---
  for (let i=0;i<6;i++) { const a=i*Math.PI/3, f=mk(B(.014,.022,.08),K,Math.sin(a)*.062,Math.cos(a)*.062,.03); f.rotation.z=-a; }   // drum flutes
  mk(C(.012,.28),0xd3d7dc,0,-.035,-.2,Math.PI/2);                  // ejector rod
  mk(B(.03,.03,.1),D,0,-.04,-.28);                                 // ejector housing
  mk(B(.012,.05,.012),K,0,-.06,.1,.3);                             // trigger
  mk(B(.012,.012,.1),K,0,-.095,.12);                               // trigger guard (bottom)
  mk(B(.012,.04,.012),K,0,-.075,.07);                              // trigger guard (front)
  mk(B(.012,.025,.02),K,0,.075,-.34);                              // front sight
  mk(B(.03,.015,.02),K,0,.082,.07);                                // rear sight
  mk(C(.04,.02),0xd3d7dc,0,.02,-.355,Math.PI/2);                   // muzzle crown
  mk(C(.018,.01),0x000000,0,.02,-.364,Math.PI/2);                  // bore
  mk(B(.012,.14,.08),0x2a2d31,.034,-.14,.2,-.4); mk(B(.012,.14,.08),0x2a2d31,-.034,-.14,.2,-.4);   // grip panels
  mk(B(.012,.012,.012),0xd3d7dc,.04,-.12,.2); mk(B(.012,.012,.012),0xd3d7dc,-.04,-.12,.2);          // grip screws             // grip
  hand(0.01, -0.2, 0.22); arm([0.01, -0.22, 0.26], [0.15, -0.5, 0.8]);       // right hand
  hand(-0.05, -0.17, 0.2); arm([-0.05, -0.19, 0.24], [-0.22, -0.5, 0.8]);     // left hand
  gun.position.set(0.28, -0.25, -0.6);
}

// ---------- bots ----------
let bots = [];
const flyingParts = [], particles = [];
// Reuse particle geometry AND materials. Per-hit material allocation caused GPU memory growth.
const combatParticleGeometry = new THREE.IcosahedronGeometry(0.045, 0);
const combatParticleMaterials = {
  cyan: new THREE.MeshBasicMaterial({ color: 0x65caff }),
  violet: new THREE.MeshBasicMaterial({ color: 0xb44cff }),
  spark: new THREE.MeshBasicMaterial({ color: 0xffd27a }),
  dust: new THREE.MeshBasicMaterial({ color: 0xb9c0c8 })
};
const MAX_COMBAT_PARTICLES = 48;
const MAX_FLYING_PARTS = 12;
function disposeMeshResources(mesh) {
  if (!mesh || !mesh.isMesh) return;
  if (mesh.geometry) mesh.geometry.dispose();
  if (Array.isArray(mesh.material)) mesh.material.forEach(m => m && m.dispose());
  else if (mesh.material) mesh.material.dispose();
}
function disposeBotResources(bot) {
  bot.traverse(o => { if (o.isMesh) disposeMeshResources(o); });
}
const BOT_SX = 0.74, BOT_SY = 0.82;
function makeBot() {
  const grp = new THREE.Group();
  const limbs = {};
  const add = (geo, col, x, y, z, part, sc, basic, materialOptions) => {
    const mat = basic
      ? new THREE.MeshBasicMaterial({ color: col })
      : new THREE.MeshLambertMaterial(Object.assign({ color: col }, materialOptions || {}));
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.userData.part = part;
    m.botRef = grp;
    m.castShadow = false;
    m.receiveShadow = false;
    if (sc) m.scale.set(sc[0], sc[1], sc[2]);
    grp.add(m);
    return m;
  };
  const cyl = (rt, rb, h, sides=10) => new THREE.CylinderGeometry(rt, rb, h, sides);
  const sph = r => new THREE.SphereGeometry(r, 12, 10);
  const box = (a, b, c) => new THREE.BoxGeometry(a, b, c);
  const G = 0x697887, L = 0x8795a2, DK = 0x202a35, MID = 0x3b4855;
  const BLUE = 0x39baff;

  // Slimmer, more human-proportioned armored torso and chest plate.
  add(box(0.44, 0.66, 0.30), MID, 0, 1.48, 0, 'body');
  add(box(0.35, 0.38, 0.09), G, 0, 1.53, 0.185, 'body');
  add(box(0.19, 0.12, 0.035), DK, 0, 1.52, 0.235, 'body');
  add(box(0.10, 0.07, 0.025), BLUE, 0, 1.52, 0.257, 'body', null, true);
  add(cyl(0.145, 0.16, 0.18), DK, 0, 1.08, 0, 'body');

  // Shoulder armor, articulated arms, forearms and hands.
  // Arms and legs hang from pivot groups (shoulder / hip) so they can swing; the meshes keep their
  // original positions and 'body' hit parts, and hit-testing recurses into the pivots.
  const rig = (pivot, start) => {
    grp.children.slice(start).forEach(m => { m.position.sub(pivot.position); pivot.add(m); });
    grp.add(pivot); return pivot;
  };
  [-1, 1].forEach(side => {
    let n0 = grp.children.length;
    add(sph(0.145), G, side * 0.31, 1.68, 0, 'body', [1.05, 0.9, 1.0]);
    add(box(0.145, 0.34, 0.18), MID, side * 0.35, 1.43, 0, 'body');
    add(sph(0.085), DK, side * 0.35, 1.22, 0, 'body');
    add(box(0.135, 0.28, 0.15), L, side * 0.35, 1.02, 0, 'body');
    add(sph(0.075), DK, side * 0.35, 0.82, 0, 'body');
    const armPv = new THREE.Group(); armPv.position.set(side * 0.33, 1.66, 0);
    limbs[side < 0 ? 'armL' : 'armR'] = rig(armPv, n0);
    n0 = grp.children.length;
    add(box(0.14, 0.38, 0.17), G, side * 0.145, 0.65, 0, 'body');
    add(box(0.16, 0.12, 0.20), DK, side * 0.145, 0.39, 0, 'body');
    add(sph(0.065), L, side * 0.145, 0.29, 0, 'body');
    const legPv = new THREE.Group(); legPv.position.set(side * 0.145, 0.86, 0);
    limbs[side < 0 ? 'legL' : 'legR'] = rig(legPv, n0);
  });

  // Helmet: tapered octagonal shell, raised crown and side modules.
  // It is intentionally neither a sphere nor a plain box.
  add(cyl(0.235, 0.285, 0.43, 8), L, 0, 2.02, 0, 'head');
  add(cyl(0.205, 0.235, 0.10, 8), G, 0, 2.265, 0, 'head');
  add(box(0.24, 0.055, 0.30), DK, 0, 2.30, 0, 'head');
  [-1, 1].forEach(side => {
    add(cyl(0.105, 0.105, 0.10, 10), MID, side * 0.245, 2.02, 0, 'head', null, false);
    add(box(0.075, 0.18, 0.17), DK, side * 0.255, 2.02, 0.015, 'head');
  });
  // Bright blue horizontal visor on the front of the helmet.
  add(box(0.355, 0.105, 0.035), DK, 0, 2.055, 0.226, 'head');
  add(box(0.29, 0.045, 0.025), BLUE, 0, 2.055, 0.249, 'head', null, true);
  add(box(0.075, 0.025, 0.018), 0xcaf2ff, 0, 2.055, 0.265, 'head', null, true);

  // Hidden head hitbox is a little more generous than the visible visor/helmet.
  const hb = new THREE.Mesh(
    new THREE.SphereGeometry(0.31, 10, 8),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  hb.position.set(0, 2.04, 0);
  hb.userData.part = 'head';
  hb.botRef = grp;
  grp.add(hb);

  // (Phase 1) enemies are taller than the player (~1.9 m vs ~1.7 m) while width/depth keep the
  // original slim 0.74 scale. Hitboxes are children of this group, so they scale with the model.
  grp.scale.set(BOT_SX, BOT_SY, BOT_SX);
  grp.userData.limbs = limbs;
  return grp;
}
function addBot(x, z, extra) {
  const b = makeBot();
  b.scale.set(BOT_SX * .55, BOT_SY * .55, BOT_SX * .55);   // grows to full size in animateBot (spawn pop)
  b.position.set(x, 0, z);
  Object.assign(b.userData, { health: 3, hitFlash: 0, stagger: 0 }, extra || {});
  scene.add(b); bots.push(b);
  return b;
}
function removeBot(b) {
  if (!b) return;
  scene.remove(b);
  bots = bots.filter(x => x !== b);
  // Release every remaining robot geometry/material when it despawns or is destroyed.
  disposeBotResources(b);
}
// Killed enemies leave the `bots` list immediately (no hits, no scoring, no spawn-cap use) and play a
// short fall-over animation as non-interactive corpses before being disposed.
const corpses = [], MAX_CORPSES = 6;
function finishCorpse(i) { const c = corpses[i]; scene.remove(c.mesh); disposeBotResources(c.mesh); corpses.splice(i, 1); }
function clearCorpses() { while (corpses.length) finishCorpse(corpses.length - 1); }
function killBot(b) {
  bots = bots.filter(x => x !== b);
  if (corpses.length >= MAX_CORPSES) finishCorpse(0);
  b.scale.set(BOT_SX, BOT_SY, BOT_SX); b.position.y = 0; b.rotation.z = 0;
  corpses.push({ mesh: b, t: 0, vz: 1.1 + Math.random() * .6, roll: (Math.random() - .5) * .5 });
}
function updateCorpses(dt) {
  for (let i = corpses.length - 1; i >= 0; i--) {
    const c = corpses[i], b = c.mesh, L = b.userData.limbs;
    c.t += dt;
    const f = Math.min(1, c.t / .55), e = f * f;
    b.rotation.x = -1.45 * e; b.rotation.z = c.roll * e; b.position.y = .12 * e;      // topples backwards, away from the player
    b.position.z = Math.max(-54, b.position.z - c.vz * dt * (1 - e));
    if (L) { L.armL.rotation.x = L.armR.rotation.x = -1.3 * e; L.legL.rotation.x = .35 * e; L.legR.rotation.x = -.2 * e; L.legL.rotation.z = L.legR.rotation.z = 0; }
    if (c.t > 1.05) {
      const k = 1 - (c.t - 1.05) / .25;
      if (k <= .02) { finishCorpse(i); continue; }
      b.scale.set(BOT_SX * k, BOT_SY * k, BOT_SX * k);
    }
  }
}
// Idle sway, side-step stride (legs/arms/bob follow real lateral speed) and the spawn pop-in.
function animateBot(b, dt) {
  const u = b.userData, L = u.limbs;
  if (!L) return;
  if (u.phase === undefined) { u.phase = Math.random() * 6.28; u.lastX = b.position.x; u.moveK = 0; u.pop = 0; }
  if (u.pop < .2) {
    u.pop += dt;
    if (u.pop >= .2) b.scale.set(BOT_SX, BOT_SY, BOT_SX);
    else { const k = u.pop / .2, sc = .55 + .45 * (1 - Math.pow(1 - k, 3)); b.scale.set(BOT_SX * sc, BOT_SY * sc, BOT_SX * sc); }
  }
  const speed = dt > 0 ? Math.abs(b.position.x - u.lastX) / dt : 0; u.lastX = b.position.x;
  u.moveK += ((speed > .3 ? 1 : 0) - u.moveK) * Math.min(1, dt * 10);
  u.phase += dt * (5 + speed * 1.1);
  const k = u.moveK, sn = Math.sin(u.phase), idle = Math.sin(performance.now() / 600 + u.phase) * .035 * (1 - k);
  L.legL.rotation.z = sn * .30 * k; L.legR.rotation.z = Math.sin(u.phase + 1.9) * .30 * k;
  L.armL.rotation.x = sn * .38 * k + idle; L.armR.rotation.x = -sn * .38 * k - idle;
  b.position.y = Math.abs(sn) * .04 * k;
}
function burstFX(position, color=0x9b55ff, count=12, power=2.6) {
  // Bound active effects so sustained firing cannot overwhelm the browser/GPU.
  const allowed = Math.max(0, Math.min(count, MAX_COMBAT_PARTICLES - particles.length));
  for(let i=0;i<allowed;i++) {
    const mat = color === 0x65caff ? combatParticleMaterials.cyan : color === 0xffd27a ? combatParticleMaterials.spark : color === 0xb9c0c8 ? combatParticleMaterials.dust : combatParticleMaterials.violet;
    const mesh = new THREE.Mesh(combatParticleGeometry, mat);
    mesh.castShadow = false; mesh.frustumCulled = true;
    const size = 0.65 + Math.random() * 1.25;
    mesh.scale.setScalar(size);
    mesh.position.copy(position);
    const dir=new THREE.Vector3(Math.random()*2-1,Math.random()*2-1,Math.random()*2-1).normalize();
    const life=.28+Math.random()*.28;
    particles.push({mesh,vel:dir.multiplyScalar(power*(.35+Math.random())),life,max:life,size});
    scene.add(mesh);
  }
}
function detachPart(mesh, bot, hitPoint) {
  if(!mesh || !mesh.parent || mesh.userData.part==='head' || flyingParts.length >= MAX_FLYING_PARTS) return;
  const piece=mesh.clone();
  piece.geometry = mesh.geometry.clone();
  piece.material=Array.isArray(mesh.material) ? mesh.material.map(m=>m.clone()) : mesh.material.clone();
  mesh.getWorldPosition(piece.position); mesh.getWorldQuaternion(piece.quaternion); piece.scale.copy(mesh.getWorldScale(new THREE.Vector3()));
  piece.castShadow = false; piece.receiveShadow = false;
  scene.add(piece); mesh.parent.remove(mesh);
  disposeMeshResources(mesh);
  const dir=piece.position.clone().sub(hitPoint).add(new THREE.Vector3((Math.random()-.5)*.7,.65,(Math.random()-.5)*.7)).normalize();
  flyingParts.push({mesh:piece,vel:dir.multiplyScalar(1.8+Math.random()*1.8),spin:new THREE.Vector3(Math.random()*5,Math.random()*5,Math.random()*5),life:1.15});
}
function damageBot(bot, hit, headshot, dmg = 1) {
  if(!bot || !bots.includes(bot) || !hit || !hit.point) return;
  const point=hit.point.clone();
  burstFX(point, headshot ? 0xb44cff : 0x65caff, headshot ? 10 : 4, headshot ? 3.5 : 1.5);
  bot.userData.stagger=.22; bot.userData.hitFlash=.18;
  if(headshot) {
    playSfx('headshot', .95); showCombatNotice('headshot','HEADSHOT','PRECISION HIT');
    const headMesh=bot.children.find(o=>o.isMesh && o.userData.part==='head' && o.visible && o.material && o.material.visible !== false && o.geometry && o.geometry.type !== 'SphereGeometry' /* visible helmet shell */);
    if(headMesh && flyingParts.length < MAX_FLYING_PARTS) {
      const detached=headMesh.clone();
      detached.geometry = headMesh.geometry.clone();
      detached.material=Array.isArray(headMesh.material) ? headMesh.material.map(m=>m.clone()) : headMesh.material.clone();
      headMesh.getWorldPosition(detached.position); headMesh.getWorldQuaternion(detached.quaternion); detached.scale.copy(headMesh.getWorldScale(new THREE.Vector3()));
      detached.castShadow = false; detached.receiveShadow = false;
      scene.add(detached); flyingParts.push({mesh:detached,vel:new THREE.Vector3((Math.random()-.5)*1.5,3.2+Math.random()*1.5,-.7),spin:new THREE.Vector3(4,6,2),life:1.25});
    }
    bot.children.forEach(o=>{ if(o.isMesh && o.userData.part==='head') o.visible=false; });
    burstFX(point,0xb44cff,12,3.8); registerElimination(true); killBot(bot); return;
  }
  playSfx('hit', .7); showCombatNotice('hit','HIT','BODY SHOT');
  detachPart(hit.object,bot,point);
  bot.userData.health -= dmg;
  if(bot.userData.health<=0) {
    burstFX(bot.position.clone().add(new THREE.Vector3(0,1,0)),0xb44cff,8,2.8);
    registerElimination(false); killBot(bot);
  }
}
function updateCombatFX(dt) {
  for(let i=particles.length-1;i>=0;i--) {
    const p=particles[i]; p.life-=dt; p.vel.y-=5*dt; p.mesh.position.addScaledVector(p.vel,dt);
    const fade = Math.max(0.08, p.life / p.max); p.mesh.scale.setScalar(p.size * fade);
    if(p.life<=0){scene.remove(p.mesh);particles.splice(i,1);}
  }
  for(let i=flyingParts.length-1;i>=0;i--) {
    const p=flyingParts[i]; p.life-=dt; p.vel.y-=9.8*dt; p.mesh.position.addScaledVector(p.vel,dt);
    p.mesh.rotation.x+=p.spin.x*dt; p.mesh.rotation.y+=p.spin.y*dt; p.mesh.rotation.z+=p.spin.z*dt;
    if(p.mesh.position.y<.06){p.mesh.position.y=.06;p.vel.y=Math.abs(p.vel.y)*.22;p.vel.multiplyScalar(.72);p.spin.multiplyScalar(.65);}
    if(p.life<=0){scene.remove(p.mesh);disposeMeshResources(p.mesh);flyingParts.splice(i,1);}
  }
  bots.forEach(b=>{const u=b.userData;if(u.stagger>0){u.stagger=Math.max(0,u.stagger-dt);b.rotation.z=Math.sin(u.stagger*38)*.10*(u.stagger/.22);}else b.rotation.z*=.75; animateBot(b,dt);});
  updateCorpses(dt);
}
function nearCrate(x, z, r) { return false; }

// ---------- Phase 4: wall impact decals (bullet holes / knife slash marks) ----------
// Large flat boxes of the scenery (house walls, roofs...) also receive decals.
decorMeshes.forEach(m => {
  const g = m.geometry;
  m.userData.surface = m.rotation.x !== 0 ? 'tile' : 'plaster';
  if (g.type !== 'BoxGeometry') return;
  const d = [g.parameters.width * m.scale.x, g.parameters.height * m.scale.y, g.parameters.depth * m.scale.z].sort((a, b) => b - a);
  if (d[1] >= 1.6) m.userData.decal = true;
});
// Everything static that stops bullets/knife strikes (decorMeshes were already blockers before).
const solidTargets = decorMeshes.concat(wallSurfaces);

const MAX_DECALS = 96, DECAL_LIFE = 45, DECAL_FADE = 1.5;
const decalPool = [];            // fixed ring buffer: after warm-up no objects are created or freed
let decalHead = 0, decalSerial = 0;
const decalGeo = new THREE.PlaneGeometry(1, 1);
function jag(g, cx, cy, r, n, jit) {
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2, rr = r * (1 - jit + Math.random() * jit * 2);
    const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
    if (i) g.lineTo(x, y); else g.moveTo(x, y);
  }
  g.closePath(); g.fill();
}
function decalMaterial(canvas) {
  const t = new THREE.CanvasTexture(canvas); t.anisotropy = 4;
  return new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
}
function drawBulletHole() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const halo = g.createRadialGradient(64, 64, 4, 64, 64, 60);
  halo.addColorStop(0, 'rgba(10,10,12,.55)'); halo.addColorStop(.5, 'rgba(20,20,24,.2)'); halo.addColorStop(1, 'rgba(20,20,24,0)');
  g.fillStyle = halo; g.fillRect(0, 0, 128, 128);
  g.fillStyle = 'rgba(190,196,206,.5)'; jag(g, 64, 64, 20, 14, .35);          // chipped plaster ring
  g.fillStyle = 'rgba(28,30,36,.9)'; jag(g, 64, 64, 12.5, 12, .25);           // inner shadow
  g.fillStyle = '#050506'; jag(g, 64, 64, 7.5, 10, .3);                        // crater
  g.strokeStyle = 'rgba(18,20,24,.6)'; g.lineWidth = 1;                        // hairline cracks
  const cracks = 5 + (Math.random() * 3 | 0);
  for (let i = 0; i < cracks; i++) {
    const a = Math.random() * Math.PI * 2, l = 16 + Math.random() * 20, b = (Math.random() - .5) * .6;
    g.beginPath(); g.moveTo(64 + Math.cos(a) * 12, 64 + Math.sin(a) * 12);
    g.lineTo(64 + Math.cos(a + b * .5) * (12 + l * .5), 64 + Math.sin(a + b * .5) * (12 + l * .5));
    g.lineTo(64 + Math.cos(a + b) * (12 + l), 64 + Math.sin(a + b) * (12 + l)); g.stroke();
  }
  g.strokeStyle = 'rgba(225,230,238,.35)'; g.lineWidth = 1.5;                  // lit lower rim
  g.beginPath(); g.arc(64, 64, 9, .2, 1.4); g.stroke();
  return c;
}
function drawSlash(variant) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  const lines = variant
    ? [[10, 62, 246, 70, 4], [34, 80, 214, 84, 2.4], [70, 46, 190, 50, 1.8]]
    : [[14, 56, 242, 74, 3.2], [36, 40, 206, 52, 2.2], [58, 82, 186, 92, 1.6]];
  lines.forEach(([x0, y0, x1, y1, w]) => {
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy), nx = -dy / len, ny = dx / len, steps = 28;
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, half = w * Math.pow(Math.sin(Math.PI * t), .7) / 2 + .2, j = (Math.random() - .5) * .9;
      pts.push([x0 + dx * t, y0 + dy * t + j, half]);
    }
    g.fillStyle = 'rgba(12,14,18,.88)'; g.beginPath();                          // dark gouge
    pts.forEach(q => g.lineTo(q[0] + nx * q[2], q[1] + ny * q[2]));
    for (let i = pts.length - 1; i >= 0; i--) g.lineTo(pts[i][0] - nx * pts[i][2], pts[i][1] - ny * pts[i][2]);
    g.closePath(); g.fill();
    g.strokeStyle = 'rgba(214,222,232,.7)'; g.lineWidth = 1; g.beginPath();    // exposed bright edge
    pts.forEach((q, i) => { const X = q[0] - nx * (q[2] + 1.1), Y = q[1] - ny * (q[2] + 1.1); if (i) g.lineTo(X, Y); else g.moveTo(X, Y); });
    g.stroke();
    g.fillStyle = 'rgba(205,212,222,.55)';                                      // flaked chips
    for (let i = 0; i < 7; i++) { const t = Math.random(); g.fillRect(x0 + dx * t + (Math.random() - .5) * 6, y0 + dy * t + (Math.random() - .5) * 8, 1.6, 1.2); }
  });
  return c;
}
const bulletMats = [drawBulletHole(), drawBulletHole(), drawBulletHole()].map(decalMaterial);
const slashMats = [drawSlash(0), drawSlash(1)].map(decalMaterial);
const _dn = new THREE.Vector3(), _dq = new THREE.Quaternion(), _dqz = new THREE.Quaternion(),
      _dr = new THREE.Vector3(), _du = new THREE.Vector3(), _ds = new THREE.Vector3(), _dx = new THREE.Vector3();
const Z_AXIS = new THREE.Vector3(0, 0, 1);
// type: 'bullet' | 'slashA' | 'slashB'; swipe = [screenX, screenY] direction of the knife swing.
function spawnDecal(hit, rayDir, type, swipe) {
  const obj = hit.object;
  if (!obj.userData.decal || !hit.face) return;
  _dn.copy(hit.face.normal).transformDirection(obj.matrixWorld);
  if (_dn.dot(rayDir) > 0) _dn.negate();
  const slot = decalHead; decalHead = (decalHead + 1) % MAX_DECALS;           // overwrite oldest when full
  let mesh = decalPool[slot];
  if (!mesh) { mesh = new THREE.Mesh(decalGeo, bulletMats[0]); mesh.renderOrder = 2; mesh.castShadow = mesh.receiveShadow = false; scene.add(mesh); decalPool[slot] = mesh; }
  let sx, sy, ang = Math.random() * Math.PI * 2;
  _dq.setFromUnitVectors(Z_AXIS, _dn);
  if (type === 'bullet') {
    mesh.material = bulletMats[(Math.random() * bulletMats.length) | 0];
    sx = sy = .11 + Math.random() * .04;
  } else {
    mesh.material = type === 'slashB' ? slashMats[1] : slashMats[0];
    sx = .85; sy = .425;
    // Rotate the scratch so it runs along the on-screen swing direction projected onto the surface.
    _dr.set(1, 0, 0).applyQuaternion(camera.quaternion); _du.set(0, 1, 0).applyQuaternion(camera.quaternion);
    _ds.copy(_dr).multiplyScalar(swipe[0]).addScaledVector(_du, swipe[1]);
    _ds.addScaledVector(_dn, -_ds.dot(_dn));
    if (_ds.lengthSq() > 1e-4) {
      _ds.normalize(); _dx.set(1, 0, 0).applyQuaternion(_dq);
      ang = Math.atan2(_dr.crossVectors(_dx, _ds).dot(_dn), _dx.dot(_ds)) + (Math.random() - .5) * .25;
    }
  }
  _dqz.setFromAxisAngle(Z_AXIS, ang);
  mesh.quaternion.copy(_dq).multiply(_dqz);
  mesh.position.copy(hit.point).addScaledVector(_dn, .006 + (decalSerial++ % 6) * .0007);
  mesh.scale.set(sx, sy, 1);
  mesh.userData.sx = sx; mesh.userData.sy = sy; mesh.userData.born = performance.now() / 1000;
  mesh.visible = true;
}
function clearDecals() { for (let i = 0; i < decalPool.length; i++) if (decalPool[i]) decalPool[i].visible = false; decalHead = 0; }
function updateDecals(nowSec) {
  for (let i = 0; i < decalPool.length; i++) {
    const m = decalPool[i];
    if (!m || !m.visible) continue;
    const left = DECAL_LIFE - (nowSec - m.userData.born);
    if (left <= 0) { m.visible = false; continue; }
    if (left < DECAL_FADE) { const k = left / DECAL_FADE; m.scale.set(m.userData.sx * k, m.userData.sy * k, 1); }
  }
}
function bulletImpact(worldHit, dir) {
  spawnDecal(worldHit, dir, 'bullet');
  playImpact(worldHit.object.userData.surface, worldHit.point, worldHit.distance);
  burstFX(worldHit.point, 0xb9c0c8, 3, 1.1);
}

// ---------- Phase 3: knife attacks ----------
// Pose keyframes: [timeFraction, pitch, yaw, roll, handOffsetX]. +yaw swings the tip left, +pitch raises it.
const KNIFE_ATTACKS = {
  slash: { dur: .34, hitFrac: .45, sfx: 'knifeSlash', swipe: [-1, -.75], decal: 'slashA',   // "/" from upper-right to lower-left
    keys: [[0, 0, 0, 0, 0], [.30, .50, -.55, .55, .10], [.62, -.55, .75, -.80, -.34], [1, 0, 0, 0, 0]] },
  alt:   { dur: .50, hitFrac: .48, sfx: 'knifeSlashAlt', swipe: [1, -.75], decal: 'slashB',  // "\" backhand from upper-left to lower-right
    keys: [[0, 0, 0, 0, 0], [.34, .45, .65, -.50, -.18], [.62, -.45, -.85, .70, .30], [1, 0, 0, 0, 0]] }
};
let knifeAtk = null;
const smooth = t => t * t * (3 - 2 * t);
function knifeAttack(kind, now) {
  // One swing at a time, honouring the knife cooldown, so attack animations can never overlap.
  if (state !== 'playing' || weapon !== 'knife' || knifeAtk || swapPhase > 0) return false;
  if (now - lastShot < WEAPONS.knife.interval) return false;
  const a = KNIFE_ATTACKS[kind];
  lastShot = lastFire = now; shots++;
  knifeAtk = { a, kind, t: 0, struck: false };
  playSfx(a.sfx, .8);
  return true;
}
function knifeStrike(k) {
  camera.updateMatrixWorld();
  ray.setFromCamera({ x: 0, y: 0 }, camera); ray.far = 3;
  const bh = ray.intersectObjects(bots, true)[0];
  const wh = ray.intersectObjects(solidTargets, false)[0];
  ray.far = Infinity;
  if (bh && bh.object.botRef && (!wh || bh.distance <= wh.distance)) {
    hits++; score += 100;
    damageBot(bh.object.botRef, bh, false);
    if (k.kind === 'alt') burstFX(bh.point, 0xffd27a, 6, 2.2);
    toast('KNIFE +100', 400);
    const h = $('hit'); h.className = 'show'; setTimeout(() => h.className = '', 120);
  } else if (wh) {
    spawnDecal(wh, ray.ray.direction, k.a.decal, k.a.swipe);
    burstFX(wh.point, 0xffd27a, 5, 1.8);
    playSfx('knifeHit', .7);
  }
}
// Returns true while a swing owns the weapon pose.
function updateKnife(dt) {
  if (!knifeAtk) return false;
  if (state !== 'playing') return true;                    // frozen while paused
  const k = knifeAtk, a = k.a;
  k.t += dt;
  const f = Math.min(1, k.t / a.dur);
  if (!k.struck && f >= a.hitFrac) { k.struck = true; knifeStrike(k); }
  const ks = a.keys; let i = 1;
  while (i < ks.length - 1 && f > ks[i][0]) i++;
  const A = ks[i - 1], B = ks[i], u = smooth((f - A[0]) / (B[0] - A[0]));
  const L = n => A[n] + (B[n] - A[n]) * u;
  gun.rotation.set(L(1), L(2), L(3));
  gun.position.x = (gun.userData.baseX ?? 0.3) + L(4);
  if (f >= 1) knifeAtk = null;
  return true;
}

// ---------- Phase 2: reload animation (magazine out, drop, new magazine in) ----------
const RELOAD_OUT = .15, RELOAD_SHOW = .36, RELOAD_SEAT = .66;      // fractions of the reload time
const LH_REST = new THREE.Vector3(0, 0, 0), LH_GRAB = new THREE.Vector3(0, -.12, .30), LH_POUCH = new THREE.Vector3(-.08, -.55, .20);
const droppedMags = [], MAX_DROPPED_MAGS = 6, MAG_LIFE = 4;
const _rv = new THREE.Vector3(), _rh = new THREE.Vector3();
let reloadTotal = 2.5, reloadOutDone = false, reloadSeatDone = false;
function leg(p, a, b, from, to, out) { return out.copy(from).lerp(to, smooth(Math.min(1, Math.max(0, (p - a) / (b - a))))); }
function handPath(p, out) {
  if (p < .10) return leg(p, 0, .10, LH_REST, LH_GRAB, out);
  if (p < .16) return out.copy(LH_GRAB);
  if (p < .34) return leg(p, .16, .34, LH_GRAB, LH_POUCH, out);
  if (p < .46) return out.copy(LH_POUCH);
  if (p < .66) return leg(p, .46, .66, LH_POUCH, LH_GRAB, out);
  if (p < .74) return out.copy(LH_GRAB);
  if (p < .92) return leg(p, .74, .92, LH_GRAB, LH_REST, out);
  return out.copy(LH_REST);
}
function removeDroppedMag(i) { scene.remove(droppedMags[i].mesh); droppedMags.splice(i, 1); }   // geometry/materials are shared: nothing to dispose
function clearDroppedMags() { while (droppedMags.length) removeDroppedMag(droppedMags.length - 1); }
function dropMagazine() {
  const mag = gun.userData.mag;
  if (!mag) return;
  if (droppedMags.length >= MAX_DROPPED_MAGS) removeDroppedMag(0);
  mag.updateWorldMatrix(true, false);
  const g = makeMagGroup(gun.userData.magKind);
  mag.getWorldPosition(g.position); mag.getWorldQuaternion(g.quaternion); mag.getWorldScale(g.scale);
  const vel = new THREE.Vector3(-.35 + (Math.random() - .5) * .3, -.5, .45 + Math.random() * .3).applyQuaternion(camera.quaternion).multiplyScalar(1.5);
  scene.add(g);
  droppedMags.push({ mesh: g, vel, spin: new THREE.Vector3((Math.random() - .5) * 8, (Math.random() - .5) * 8, (Math.random() - .5) * 8),
    age: 0, settled: false, base: g.scale.clone(), lie: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.random() * Math.PI, Math.PI / 2)) });
}
function updateDroppedMags(dt) {
  for (let i = droppedMags.length - 1; i >= 0; i--) {
    const m = droppedMags[i], g = m.mesh;
    m.age += dt;
    if (m.age >= MAG_LIFE) { removeDroppedMag(i); continue; }      // disappears automatically
    if (!m.settled) {
      m.vel.y -= 9.8 * dt; g.position.addScaledVector(m.vel, dt);
      g.rotation.x += m.spin.x * dt; g.rotation.y += m.spin.y * dt; g.rotation.z += m.spin.z * dt;
      g.position.x = Math.max(-19, Math.min(19, g.position.x)); g.position.z = Math.max(-55, Math.min(12, g.position.z));
      if (g.position.y <= .06) {
        g.position.y = .06;
        if (Math.abs(m.vel.y) > .7) { m.vel.y *= -.28; m.vel.x *= .6; m.vel.z *= .6; m.spin.multiplyScalar(.5); }
        else m.settled = true;
      }
    } else {
      g.quaternion.slerp(m.lie, Math.min(1, dt * 10));
      g.position.y += (.04 - g.position.y) * Math.min(1, dt * 10);
    }
    const left = MAG_LIFE - m.age;
    if (left < .5) g.scale.copy(m.base).multiplyScalar(Math.max(.01, left / .5));
  }
}
// Drives the gun's magazine / support hand / cylinder from the real reload timer, and restores the
// resting state whenever no reload is running, so the visible magazine always matches the ammo state.
function updateReloadAnim(dt) {
  const mag = gun.userData.mag, lh = gun.userData.lh, drum = gun.userData.drum;
  if (!reloading) {
    if (mag) { mag.visible = true; mag.position.copy(gun.userData.magHome); mag.rotation.x = gun.userData.magRotX; }
    if (lh) { if (gun.userData.pump) lh.position.set(0, 0, gun.userData.pump.position.z); else lh.position.multiplyScalar(.6); }   // support hand rides the pump
    return;
  }
  const p = Math.max(0, Math.min(1, 1 - reloadLeft / reloadTotal));
  if (drum && p > .15 && p < .85) drum.rotation.y += dt * 16 * Math.sin((p - .15) / .7 * Math.PI);
  if (gun.userData.kind === 'shotgun') {              // shell-by-shell: hand shuttles between the pouch and the loading port
    const tt = reloadTotal - reloadLeft;
    if (lh) { if (tt < .35 || tt > reloadTotal - .45) lh.position.multiplyScalar(.8); else lh.position.copy(handPath(((tt - .35) / .52) % 1, _rh)); }
    return;
  }
  if (!mag) return;
  if (p >= RELOAD_OUT && !reloadOutDone) { reloadOutDone = true; dropMagazine(); playSfx('magOut', .8); }
  if (p >= RELOAD_SEAT && !reloadSeatDone) { reloadSeatDone = true; playSfx('magIn', .85); gun.position.z = (gun.userData.rz ?? gun.position.z) + .05; }
  handPath(p, _rh);
  if (lh) lh.position.copy(_rh);
  if (p < RELOAD_OUT) { mag.visible = true; mag.position.copy(gun.userData.magHome); }
  else if (p < RELOAD_SHOW) mag.visible = false;                    // empty magazine is gone
  else { mag.visible = true; mag.position.copy(gun.userData.magHome).add(_rv.copy(_rh).sub(LH_GRAB)); }   // new magazine rides in the hand
  mag.rotation.x = gun.userData.magRotX;
}

// ---------- state ----------
let state = 'idle', mode = 'range', weapon = 'vandal', level = LEVELS.medium;
let score = 0, shots = 0, hits = 0, heads = 0, wave = 0;
let eyeY = 1.68, jumpY = 0 /* feet height above the floor */, vy = 0, grounded = true, landImpact = 0, infinite = false, slashT = 0, startTime = 0, pauseAt = 0, lastSpawn = 0, lastShot = 0, lastFire = 0;
let yaw = 0, pitch = 0, recP = 0, recY = 0, spray = 0, firing = false, startZ = 0;
let aiming = false, aimFov = 80, swapPhase = 0, swapTarget = 0, swapKey = null;
const keys = {};
const ray = new THREE.Raycaster();
let audio;

// Custom MP3 weapon sounds.
// A small voice pool lets each bullet trigger its own single-shot sound
// without cutting off the previous shot during rapid fire.
function createShotSoundPool(src, voiceCount = 4) {
  const voices = Array.from({ length: voiceCount }, () => {
    const sound = new Audio(src);
    sound.preload = 'auto';
    return sound;
  });
  let nextVoice = 0;

  return function playShot(volume = 0.75) {
    const sound = voices[nextVoice];
    nextVoice = (nextVoice + 1) % voices.length;

    sound.pause();
    sound.currentTime = 0;
    sound.volume = Math.max(0, Math.min(1, volume));

    const playback = sound.play();
    if (playback && typeof playback.catch === 'function') {
      playback.catch(error => {
        console.warn('Gunshot audio failed:', error);
      });
    }
  };
}

const customKnifeSwitchSound = createShotSoundPool('Assets/sounds/knife-switch.mp3', 2);

const customGunSounds = {
  vandal: createShotSoundPool('Assets/sounds/vandal.mp3', 4),
  phantom: createShotSoundPool('Assets/sounds/phantom.mp3', 5),
  operator: createShotSoundPool('Assets/sounds/operator.mp3', 3)
};

let killCount = 0, noticeTimer = null, hitTimer = null, playerStepClock = 0, enemyStepClock = 0, masterVolume = 0.75;
function ensureAudio() {
  audio = audio || new (window.AudioContext || window.webkitAudioContext)();
  if (audio.state === 'suspended') audio.resume();
  return audio;
}
function playSfx(kind, volume=1) {
  try {
    if (MECH_KINDS.has(kind)) { playMech(kind, volume); return; }
    const ctx = ensureAudio(), t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.setValueAtTime(Math.max(.001, volume * masterVolume * 1.45), t);
    out.gain.exponentialRampToValueAtTime(.001, t + (kind==='footstep'||kind==='enemyStep' ? .18 : .62));
    out.connect(ctx.destination);

    const tone = (type, f1, f2, dur, level=.25, delay=0) => {
      const o=ctx.createOscillator(), g=ctx.createGain();
      o.type=type; o.frequency.setValueAtTime(f1,t+delay);
      o.frequency.exponentialRampToValueAtTime(Math.max(1,f2),t+delay+dur);
      g.gain.setValueAtTime(.001,t+delay); g.gain.linearRampToValueAtTime(level,t+delay+.008);
      g.gain.exponentialRampToValueAtTime(.001,t+delay+dur);
      o.connect(g); g.connect(out); o.start(t+delay); o.stop(t+delay+dur+.01);
    };
    const noise = (dur, level, low, high, delay=0) => {
      const n=Math.max(1,Math.floor(ctx.sampleRate*dur));
      const b=ctx.createBuffer(1,n,ctx.sampleRate), d=b.getChannelData(0);
      for(let i=0;i<n;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/n,1.7);
      const src=ctx.createBufferSource(); src.buffer=b;
      const filter=ctx.createBiquadFilter(); filter.type='bandpass';
      filter.frequency.value=(low+high)/2; filter.Q.value=Math.max(.2,(low+high)/(high-low));
      const g=ctx.createGain(); g.gain.setValueAtTime(level,t+delay);
      g.gain.exponentialRampToValueAtTime(.001,t+delay+dur);
      src.connect(filter); filter.connect(g); g.connect(out); src.start(t+delay); src.stop(t+delay+dur);
    };

    if(kind==='switch') {
      // Mechanical holster/weapon handling with a crisp latch and short cloth movement.
      noise(.16,.30,450,2600);
      tone('triangle',680,210,.16,.22,.025);
      tone('square',145,72,.075,.13,.09);
      tone('triangle',1050,520,.07,.10,.20);
    } else if(kind==='knifeSwitch') {
      // Blade draw: airy blade movement, metal ring and a firm handle catch.
      noise(.34,.42,900,7200);
      tone('sawtooth',1250,390,.25,.16,.015);
      tone('triangle',1850,720,.20,.20,.10);
      tone('square',190,82,.10,.20,.30);
      tone('sine',620,430,.28,.09,.12);
    } else if(kind==='reload') {
      noise(.10,.22,500,2400);
      tone('square',310,175,.11,.20,.05);
      tone('triangle',920,480,.14,.18,.19);
      tone('square',155,95,.09,.16,.34);
    } else if(kind==='hit') {
      tone('triangle',920,390,.13,.28);
      noise(.06,.12,1300,5000,.01);
    } else if(kind==='headshot') {
      tone('triangle',1180,380,.28,.32);
      tone('sine',1760,760,.22,.22,.035);
      noise(.08,.13,1800,6200);
    } else if(kind==='eliminate') {
      // Punchy low impact followed by a short metallic confirmation tail (not two beeps).
      noise(.20,.38,90,850);
      tone('sine',125,48,.34,.42);
      tone('triangle',540,210,.38,.25,.055);
      tone('sine',880,520,.42,.12,.10);
    } else if(kind==='footstep') {
      noise(.10,.20,75,330); tone('sine',92,42,.12,.22);
    } else if(kind==='enemyStep') {
      noise(.10,.13,65,250); tone('sine',78,38,.13,.14);
    } else if(kind==='knife') {
      noise(.20,.30,700,5000); tone('sawtooth',520,120,.18,.20);
    } else if(kind==='knifeSlash') {
      // Left click: broad, lower whoosh.
      noise(.17,.34,1100,6500); tone('sawtooth',880,250,.15,.10);
    } else if(kind==='knifeSlashAlt') {
      // Right click: higher, faster slice with a metallic shing.
      noise(.24,.36,2400,9500); tone('triangle',1550,520,.17,.12); tone('sine',2500,1350,.14,.07,.05);
    } else if(kind==='knifeHit') {
      noise(.08,.30,2500,9000); tone('triangle',2200,900,.10,.20); tone('square',380,160,.05,.12);
    } else if(kind==='magOut') {
      noise(.05,.22,800,4000); tone('square',230,120,.07,.18); tone('triangle',700,360,.06,.10,.04);
    } else if(kind==='magIn') {
      tone('square',180,90,.08,.20); noise(.06,.24,600,3200); tone('triangle',1100,600,.07,.14,.06);
    }
  } catch(e) {}
}
function showCombatNotice(type, title, subtitle='') {
  const el=$('combatNotice'); if(!el) return;
  el.className=''; el.innerHTML='<span class="notice-main"></span><span class="notice-sub"></span>';
  el.querySelector('.notice-main').textContent=title;
  el.querySelector('.notice-sub').textContent=subtitle;
  void el.offsetWidth; el.className='show '+type;
  if(noticeTimer) clearTimeout(noticeTimer);
  noticeTimer=setTimeout(()=>{el.className='';},760);
}
const killAudio = new Audio('Assets/sounds/kill.mp3');
killAudio.preload = 'auto';
function playKillSound() {
  const a = killAudio.cloneNode();            // para pwedeng magpatong ang sunod-sunod na kill
  a.volume = Math.min(1, typeof masterVolume === 'number' ? masterVolume : 1);
  a.play().catch(() => {});
}
function registerElimination(headshot) {
  killCount++;
  const k=$('kills'); if(k){k.textContent=killCount; k.classList.remove('bump'); void k.offsetWidth; k.classList.add('bump');}
  if(headshot) setTimeout(()=>showCombatNotice('eliminated','ELIMINATED','HEADSHOT CONFIRMED'),650);
  else showCombatNotice('eliminated','ELIMINATED','TARGET DOWN');
  playKillSound();
}
// Shared room reverb + 1 s noise buffer, built once with the AudioContext.
let roomVerb = null, noiseBuf = null, lastImpactSfx = 0;
function audioExtras() {
  const ctx = ensureAudio();
  if (roomVerb) return;
  const len = Math.floor(ctx.sampleRate * .9), ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
  const conv = ctx.createConvolver(); conv.buffer = ir;
  const wet = ctx.createGain(); wet.gain.value = .55; conv.connect(wet); wet.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const nd = noiseBuf.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  roomVerb = conv;
}
// ---------- Phase 3: firearm audio ----------
// Every report is built from layers: transient click, high crack, mid "bang" body, low thump, decaying tail and room reverb.
// A shared soft-clip + compressor bus keeps loud weapons punchy without harsh distortion, and a voice limiter stops
// full-auto fire from stacking into noise (when 4+ shots overlap, the newest shots drop their tail/reverb layers).
let gunBus = null, gunShaper = null, longVerb = null; const gunVoices = [];
function gunAudio() {
  const ctx = ensureAudio(); audioExtras();
  if (gunBus) return;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.knee.value = 8; comp.ratio.value = 10; comp.attack.value = .002; comp.release.value = .18;
  comp.connect(ctx.destination);
  gunBus = ctx.createGain(); gunBus.connect(comp);
  const n = 1024, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; curve[i] = Math.tanh(x * 1.8) / Math.tanh(1.8); }
  gunShaper = ctx.createWaveShaper(); gunShaper.curve = curve; gunShaper.oversample = '2x'; gunShaper.connect(gunBus);
  const len = Math.floor(ctx.sampleRate * 2.2), ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2) * (i < ctx.sampleRate * .04 ? .4 : 1); }
  longVerb = ctx.createConvolver(); longVerb.buffer = ir;
  const lw = ctx.createGain(); lw.gain.value = .7; longVerb.connect(lw); lw.connect(gunBus);
}
function gNoise(ctx, dest, t, dur, lvl, type, f0, f1, q) {
  const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = dur > .9; s.playbackRate.value = .9 + Math.random() * .2;
  const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q || .8; f.frequency.setValueAtTime(f0, t);
  if (f1) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(Math.max(.0001, lvl), t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(dest); s.start(t, Math.random() * .4); s.stop(t + dur + .03);
}
function gThump(ctx, dest, t, f0, f1, lvl, dur) {
  const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine';
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(18, f1), t + dur);
  g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(lvl, t + .004); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
  o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + .02);
}
const GUN_SOUND = {
  vandal:   { vol: 1.0,  click: .9, crack: [1800, .85, .09],  bang: [3200, 300, 1.0, .17],  thump: [130, 42, 1.0, .20],  tail: [900, 200, .35, .55],  verb: .35, long: 0 },
  phantom:  { vol: .75,  click: .5, crack: [900,  .35, .06],  bang: [1400, 250, .75, .13],  thump: [110, 48, .7, .15],   tail: [700, 220, .18, .35],  verb: .22, long: 0, thip: true },
  sheriff:  { vol: 1.1,  click: 1,  crack: [1500, 1.0, .12],  bang: [2600, 180, 1.1, .26],  thump: [95, 32, 1.2, .32],    tail: [800, 160, .45, .85],  verb: .45, long: .1, ring: true },
  operator: { vol: 1.35, click: 1,  crack: [1200, 1.1, .16],  bang: [2200, 90, 1.35, .5],   thump: [75, 24, 1.5, .6],     tail: [700, 90, .6, 1.6],    verb: .5,  long: .85, sub: true },
  shotgun:  { vol: 1.3,  click: 1,  crack: [800,  1.2, .14],  bang: [2800, 120, 1.5, .34],  thump: [85, 26, 1.5, .5],     tail: [800, 110, .5, 1.0],   verb: .5,  long: .35, sub: true }
};
function playGunshot() {
  const playCustomShot = customGunSounds[weapon];
  if (playCustomShot) {
    playCustomShot(masterVolume);
    return;
  }

  try {
    const ctx = ensureAudio(); gunAudio();
    const p = GUN_SOUND[weapon] || GUN_SOUND.vandal, t = ctx.currentTime, pv = 1 + (Math.random() - .5) * .06;
    for (let i = gunVoices.length - 1; i >= 0; i--) if (gunVoices[i] < t) gunVoices.splice(i, 1);
    const crowded = gunVoices.length >= 4;
    gunVoices.push(t + (crowded ? .25 : p.tail[3]));
    const out = ctx.createGain(); out.gain.setValueAtTime(p.vol * masterVolume * 1.2, t); out.connect(gunShaper);
    if (!crowded) {
      const rv = ctx.createGain(); rv.gain.value = p.verb; out.connect(rv); rv.connect(roomVerb);
      if (p.long) { const lv = ctx.createGain(); lv.gain.value = p.long; out.connect(lv); lv.connect(longVerb); }
    }
    gNoise(ctx, out, t, .006, p.click, 'highpass', 4500, 0, .7);                        // transient click
    gNoise(ctx, out, t, p.crack[2], p.crack[1], 'highpass', p.crack[0], 0, .8);         // crack
    gNoise(ctx, out, t, p.bang[3], p.bang[2], 'lowpass', p.bang[0], p.bang[1], .9);     // body bang
    gThump(ctx, out, t, p.thump[0] * pv, p.thump[1], p.thump[2], p.thump[3]);           // low thump
    if (p.sub) gThump(ctx, out, t, 52 * pv, 20, p.thump[2] * .8, p.thump[3] + .15);      // sub-bass for the big guns
    if (!crowded) gNoise(ctx, out, t + .02, p.tail[3], p.tail[2], 'lowpass', p.tail[0], p.tail[1], .7);   // tail
    if (p.thip) { gNoise(ctx, out, t + .012, .05, .3, 'bandpass', 1800, 900, 3); }       // suppressor puff
    if (p.ring) gThump(ctx, out, t + .02, 1450 * pv, 1380, .07, .6);                     // revolver ring-out
  } catch (e) {}
}
// Reload / handling sounds: filtered-noise clicks and clacks plus short low thunks (no electronic beeps).
const MECH_KINDS = new Set(['switch', 'reload', 'magOut', 'magIn', 'boltBack', 'boltFwd', 'shellIn', 'shellStart', 'pump', 'chamber', 'scope']);
function playMech(kind, volume = 1) {
  const ctx = ensureAudio(); audioExtras();
  const t0 = ctx.currentTime, out = ctx.createGain();
  out.gain.value = Math.max(.001, volume * masterVolume * 1.5); out.connect(ctx.destination);
  const send = ctx.createGain(); send.gain.value = .18; out.connect(send); send.connect(roomVerb);
  const nz = (dur, lvl, type, f0, f1, q, at = 0) => gNoise(ctx, out, t0 + at, dur, lvl, type, f0, f1, q);
  const th = (f0, f1, dur, lvl, at = 0) => gThump(ctx, out, t0 + at, f0, f1, lvl, dur);
  const click = (at, lvl = 1, f = 3200) => { nz(.012, .55 * lvl, 'highpass', f, 0, .8, at); nz(.05, .28 * lvl, 'bandpass', f * .5, f * .35, 3, at); th(260, 120, .05, .22 * lvl, at); };
  const clack = (at, lvl = 1) => { nz(.03, .5 * lvl, 'bandpass', 1800, 900, 2.5, at); th(180, 70, .09, .5 * lvl, at); nz(.09, .16 * lvl, 'bandpass', 900, 500, 1.2, at + .01); };
  switch (kind) {
    case 'switch': nz(.14, .12, 'bandpass', 800, 3000, 1, 0); click(.07, .6); clack(.16, .5); break;
    case 'reload': click(0, .8); nz(.1, .1, 'bandpass', 1200, 500, 1.2, .03); break;
    case 'magOut': click(0, .9); nz(.12, .18, 'bandpass', 1200, 400, 1.2, .02); th(200, 90, .08, .4, .1); break;
    case 'magIn': nz(.09, .2, 'bandpass', 500, 1500, 1.2, 0); clack(.09, 1); click(.16, .6); break;
    case 'chamber': clack(0, 1); clack(.11, .8); break;
    case 'boltBack': nz(.07, .3, 'bandpass', 900, 2200, 1.5, 0); clack(.06, .7); break;
    case 'boltFwd': clack(0, 1); click(.05, .6); break;
    case 'shellIn': nz(.025, .4, 'bandpass', 2400, 1200, 3, 0); th(300, 150, .05, .3, 0); click(.05, .5, 2500); break;
    case 'shellStart': click(0, .8); nz(.1, .1, 'bandpass', 1000, 500, 1.2, .03); break;
    case 'pump': clack(0, 1); nz(.06, .18, 'bandpass', 700, 1800, 1.2, .08); clack(.17, 1.1); break;
    case 'scope': click(0, .5, 2600); nz(.14, .12, 'bandpass', 1500, 3200, 1.2, .02); break;
  }
}
// Surface-aware bullet impact: pitch/material depends on what was hit, volume falls with distance,
// panned by direction, rate-limited so full-auto fire can't flood the audio graph.
const _ip = new THREE.Vector3(), _pr = new THREE.Vector3();
function playImpact(surface, point, dist) {
  const nt = performance.now(); if (nt - lastImpactSfx < 55) return; lastImpactSfx = nt;
  try {
    const ctx = ensureAudio(); audioExtras();
    const t = ctx.currentTime, out = ctx.createGain();
    out.gain.value = Math.max(.001, Math.min(1, .6 / (1 + dist * .1)) * masterVolume * 1.5);
    let node = out;
    if (ctx.createStereoPanner) {
      _ip.copy(point).sub(camera.position).normalize(); _pr.set(1, 0, 0).applyQuaternion(camera.quaternion);
      const pn = ctx.createStereoPanner(); pn.pan.value = Math.max(-1, Math.min(1, _ip.dot(_pr) * .9));
      out.connect(pn); node = pn;
    }
    node.connect(ctx.destination);
    const send = ctx.createGain(); send.gain.value = .25; node.connect(send); send.connect(roomVerb);
    const burst = (dur, lvl, f, q, type = 'bandpass') => {
      const sN = ctx.createBufferSource(); sN.buffer = noiseBuf;
      const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
      const g = ctx.createGain(); g.gain.setValueAtTime(lvl, t); g.gain.exponentialRampToValueAtTime(.001, t + dur);
      sN.connect(fl); fl.connect(g); g.connect(out); sN.start(t, Math.random() * .5); sN.stop(t + dur + .02);
    };
    const tn = (type, f1, f2, dur, lvl, delay = 0) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(f1, t + delay); o.frequency.exponentialRampToValueAtTime(Math.max(1, f2), t + delay + dur);
      g.gain.setValueAtTime(lvl, t + delay); g.gain.exponentialRampToValueAtTime(.001, t + delay + dur);
      o.connect(g); g.connect(out); o.start(t + delay); o.stop(t + delay + dur + .01);
    };
    if (surface === 'metal') { tn('sine', 2700, 2100, .28, .16); burst(.05, .3, 4200, .8, 'highpass'); if (Math.random() < .4) tn('sawtooth', 3400, 900, .24, .05, .02); }
    else if (surface === 'floor') { burst(.10, .34, 800, .9); tn('sine', 118, 55, .10, .24); }
    else if (surface === 'plaster') { burst(.07, .28, 1200, .9); tn('triangle', 240, 110, .07, .16); }
    else if (surface === 'tile') { burst(.07, .30, 2300, 1.2); tn('triangle', 620, 300, .07, .14); }
    else { burst(.09, .38, 1700, 1.1); tn('sine', 150, 65, .08, .22); }
  } catch (e) {}
}

function toast(t, ms) { const el=$('toast'); el.textContent=t; if(noticeTimer) clearTimeout(noticeTimer); noticeTimer=setTimeout(()=>{if(el.textContent===t)el.textContent='';},ms||500); }
function bestKey() { return 'vtm3d_best_range_' + $('difficulty').value; }
function loadBest() { try { $('best').textContent = localStorage.getItem(bestKey()) || 0; } catch (e) { $('best').textContent = 0; } }
function saveBest() {
  try { if (score > Number(localStorage.getItem(bestKey()) || 0)) localStorage.setItem(bestKey(), score); } catch (e) {}
  loadBest();
}
function drawWorldTimer(left) {
  const timer = $('worldTimer');
  if (!timer) return;
  // Show the large countdown only during an active round and anchor it
  // to a point just above the central building in the 3D scene.
  if (state !== 'playing') {
    timer.classList.remove('visible', 'urgent');
    return;
  }
  const seconds = Math.max(0, Math.ceil(Number(left) || 0));
  timer.textContent = infinite ? '\u221E' : seconds;           // infinity sign instead of a countdown
  timer.classList.add('visible');
  timer.classList.toggle('urgent', !infinite && seconds <= 5);
  const anchor = new THREE.Vector3(0, 8.9, -49.5).project(camera);
  const x = (anchor.x * 0.5 + 0.5) * innerWidth;
  const y = (-anchor.y * 0.5 + 0.5) * innerHeight;
  if (anchor.z > 1 || !Number.isFinite(x) || !Number.isFinite(y)) {
    timer.style.left = '50%';
    timer.style.top = '38%';
  } else {
    timer.style.left = x + 'px';
    timer.style.top = y + 'px';
  }
}

function hud(left) {
  drawWorldTimer(left);
  $('score').textContent = score;
  $('acc').textContent = (shots ? Math.round(hits / shots * 100) : 0) + '%';
}
function beep(f, d) {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator(), v = audio.createGain();
    o.frequency.value = f; o.type = 'square'; v.gain.value = 0.04;
    o.connect(v); v.connect(audio.destination); o.start(); o.stop(audio.currentTime + d);
  } catch (e) {}
}
// ---------- weapon slots / loadout ----------
// Slot 1 = the selected primary (Vandal, Phantom, Operator or Shotgun), slot 2 = Sheriff, slot 3 = Knife.
// Slot 1 remembers the primary the player picked, so Knife -> Key 1 brings back that same weapon (never a forced Vandal).
const PRIMARY_WEAPONS = ['vandal', 'phantom', 'operator', 'shotgun'];
const loadout = { primary: 'vandal' };
try { const sp0 = localStorage.getItem('vtm3d_primary'); if (PRIMARY_WEAPONS.includes(sp0)) loadout.primary = sp0; } catch (e) {}
const slotWeapon = n => n === 1 ? loadout.primary : (n === 2 ? 'sheriff' : 'knife');
function equipSlot(n) { setWeapon(slotWeapon(n)); }
const gunScale = k => ({ vandal: .78, phantom: .78, sheriff: .82, knife: .85, operator: .7, shotgun: .78 }[k] || .78);
function setWeapon(k) {
  if(!WEAPONS[k]) return;
  if(weapon===k && gun.children.length) return;
  const changingWeapon = weapon !== k && gun.children.length > 0;
  if(changingWeapon) {
    if (k === 'knife' || weapon === 'knife') customKnifeSwitchSound(masterVolume);
    else playSfx('switch', 1);
  }
  setAiming(false);
  weapon=k; reloading=false; knifeAtk=null;
  if (PRIMARY_WEAPONS.includes(k)) { loadout.primary = k; try { localStorage.setItem('vtm3d_primary', k); } catch (e) {} }
  $('wep').textContent=WEAPONS[k].name;
  if(!gun.children.length) {
    buildGun(WEAPONS[k]);
    gun.scale.setScalar(gunScale(k));
    gun.userData.baseX=gun.position.x; gun.userData.baseY=gun.position.y; gun.userData.baseZ=gun.position.z; gun.userData.rz=gun.position.z;
    swapPhase=0; swapKey=null;
    return;
  }
  // If another swap is already in progress, the latest requested weapon wins.
  swapKey=k; swapPhase=1;
}

function applyMode() {
  mode = 'range';
  crateGroup.visible = false;
  wallGroup.visible = false;
  startZ = 0;
}

// ---------- leaderboard ----------
const lbKey = () => 'range-' + $('difficulty').value;
async function lbGet() {
  if (SUPABASE_URL) {
    try {
      const r = await fetch(SUPABASE_URL + '/rest/v1/leaderboard?mode=eq.' + lbKey() + '&select=name,score,acc&order=score.desc&limit=10',
        { headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY } });
      if (r.ok) return await r.json();
    } catch (e) {}
  }
  try { return JSON.parse(localStorage.getItem('vtm3d_lb_' + lbKey()) || '[]'); } catch (e) { return []; }
}
async function lbPost(row) {
  if (SUPABASE_URL) {
    try {
      const r = await fetch(SUPABASE_URL + '/rest/v1/leaderboard', {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ mode: lbKey(), name: row.name, score: row.score, acc: row.acc })
      });
      if (r.ok) return;
    } catch (e) {}
  }
  try {
    const k = 'vtm3d_lb_' + lbKey();
    const list = JSON.parse(localStorage.getItem(k) || '[]');
    list.push(row); list.sort((a, b) => b.score - a.score);
    localStorage.setItem(k, JSON.stringify(list.slice(0, 10)));
  } catch (e) {}
}
async function renderLb() {
  const list = await lbGet(), ol = $('lb');
  ol.innerHTML = '';
  if (!list.length) { const li = document.createElement('li'); li.textContent = 'No scores yet'; ol.appendChild(li); return; }
  list.slice(0, 5).forEach(r => {
    const li = document.createElement('li');
    li.textContent = r.name + ' - ' + r.score + ' (' + r.acc + '%)';
    ol.appendChild(li);
  });
}

// ---------- settings ----------
let sens = 0.4;
try { sens = Number(localStorage.getItem('vtm3d_sens')) || 0.4; } catch (e) {}
function setSens(v) {
  v = Math.min(2, Math.max(0.05, Number(v) || 0.4));
  sens = v; $('sensRange').value = v; $('sensNum').value = v;
  try { localStorage.setItem('vtm3d_sens', v); } catch (e) {}
}
setSens(sens);
try { $('name').value = localStorage.getItem('vtm3d_name') || 'Player'; } catch (e) {}
$('sensRange').addEventListener('input', e => setSens(e.target.value));
$('sensNum').addEventListener('change', e => setSens(e.target.value));
$('difficulty').addEventListener('change', () => { loadBest(); renderLb(); });
document.querySelectorAll('[data-weapon]').forEach(button => {
  button.addEventListener('click', () => {
    setWeapon(button.dataset.weapon);
    $('weaponPicker').hidden = true;
    if (state === 'paused') tryResume();
  });
});

const xh = { color: '#00ff9c', len: 8, thick: 2, gap: 4, dot: true, fov: 80 };
try { Object.assign(xh, JSON.parse(localStorage.getItem('vtm3d_xh') || '{}')); } catch (e) {}
function drawXh() {
  const box = $('crosshair'); box.innerHTML = '';
  const bar = (x, y, w, h) => {
    const d = document.createElement('i');
    d.style.cssText = 'left:' + x + 'px;top:' + y + 'px;width:' + w + 'px;height:' + h + 'px;background:' + xh.color + ';box-shadow:0 0 0 1px rgba(0,0,0,.8)';
    box.appendChild(d);
  };
  const t = xh.thick, gp = xh.gap, ln = xh.len;
  if (ln > 0) { bar(-t / 2, -gp - ln, t, ln); bar(-t / 2, gp, t, ln); bar(-gp - ln, -t / 2, ln, t); bar(gp, -t / 2, ln, t); }
  if (xh.dot) bar(-t / 2, -t / 2, t, t);
  if (scopeLevel) aimFov = scopeFov(scopeLevel); else if(!aiming) aimFov=xh.fov;
  camera.fov = xh.fov; camera.updateProjectionMatrix();
  $('fovv').textContent = xh.fov;
  try { localStorage.setItem('vtm3d_xh', JSON.stringify(xh)); } catch (e) {}
}
[['fov', 'fov'], ['xhLen', 'len'], ['xhThick', 'thick'], ['xhGap', 'gap']].forEach(p => {
  $(p[0]).value = xh[p[1]];
  $(p[0]).addEventListener('input', e => { xh[p[1]] = Number(e.target.value); drawXh(); });
});
$('xhColor').value = xh.color; $('xhDot').checked = xh.dot;
$('xhColor').addEventListener('input', e => { xh.color = e.target.value; drawXh(); });
$('xhDot').addEventListener('change', e => { xh.dot = e.target.checked; drawXh(); });
$('lbh').textContent = 'Leaderboard (' + (SUPABASE_URL ? 'online' : 'local') + ')';

function startGame() {
  DURATION = Number($('duration').value) || 0;
  infinite = Number($('duration').value) === 0;
  bots.slice().forEach(removeBot);
  applyMode();
  score = shots = hits = heads = wave = 0; killCount = 0; $('kills').textContent = '0'; ammo.vandal = MAG.vandal; ammo.phantom = MAG.phantom; ammo.sheriff = MAG.sheriff; ammo.operator = MAG.operator; ammo.shotgun = MAG.shotgun; shellState = null; reloading = false; knifeAtk = null; clearDecals(); clearDroppedMags(); clearCorpses(); yaw = pitch = recP = recY = spray = 0;
  camera.position.set(0, 1.68, startZ); eyeY = 1.68; jumpY = 0; vy = 0; grounded = true; landImpact = 0; resetGunRig();
  level = LEVELS[$('difficulty').value];
  try { localStorage.setItem('vtm3d_name', $('name').value); } catch (e) {}
  startTime = performance.now(); lastSpawn = 0; state = 'playing'; showShortcutTip();
  $('mainMenu').hidden = true;
  hud(DURATION);
}

// ---------- input ----------
const el = renderer.domElement;
$('settingsToggle').addEventListener('click', () => {
  const panel = $('settingsPanel');
  $('weaponPicker').hidden = true;
  panel.hidden = !panel.hidden;
  $('settingsToggle').setAttribute('aria-expanded', String(!panel.hidden));
  $('settingsToggle').textContent = panel.hidden ? 'SETTINGS' : 'CLOSE SETTINGS';
});
const graphicsControl = $('graphicsQuality');
try { graphicsControl.value = localStorage.getItem('vtm3d_graphics') || 'auto'; } catch (e) {}
graphicsControl.addEventListener('change', e => applyGraphicsQuality(e.target.value));
applyGraphicsQuality(graphicsControl.value);

$('play').addEventListener('click', () => {
  $('settingsPanel').hidden = true;
  $('weaponPicker').hidden = true;
  $('settingsToggle').setAttribute('aria-expanded', 'false');
  $('settingsToggle').textContent = 'SETTINGS';
  if (state === 'over') {
    // First return to the start screen; the next click begins a fresh session.
    state = 'idle';
    $('title').textContent = 'Start Training Aim';
    $('info').textContent = 'Choose your training time and settings, then start aiming!';
    $('play').textContent = 'Start Training Aim';
    $('restart').hidden = true;
    loadBest();
    return;
  }
  el.requestPointerLock();
});
$('restart').addEventListener('click', () => { state = 'idle'; el.requestPointerLock(); });
function returnToMenu() {
  state = 'idle'; firing = false; setAiming(false);
  bots.slice().forEach(removeBot); clearCorpses(); clearDecals(); clearDroppedMags();
  reloading = false; knifeAtk = null;
  $('title').textContent = 'Start Training Aim';
  $('info').textContent = 'Choose your training time and settings, then start aiming!';
  $('play').textContent = 'Start Training Aim'; $('play').disabled = false;
  $('restart').hidden = true; $('mainMenu').hidden = true;
  $('overlay').classList.remove('hidden');
  drawWorldTimer(DURATION); loadBest();
}
$('mainMenu').addEventListener('click', returnToMenu);
try { $('duration').value = localStorage.getItem('vtm3d_duration') || '30'; } catch (e) {}
function syncDuration() {
  try { localStorage.setItem('vtm3d_duration', $('duration').value); } catch (e) {}
}
$('duration').addEventListener('change', syncDuration); syncDuration();
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === el;
  $('overlay').classList.toggle('hidden', locked);
  if (locked && document.activeElement) document.activeElement.blur();
  if (locked) {
    if (state === 'paused') {
      const wantInf = Number($('duration').value) === 0;                    // the setting may have been changed while paused
      if (infinite && !wantInf) { DURATION = Number($('duration').value) || 30; startTime = performance.now(); }   // infinite -> timed: fresh timer
      else startTime += performance.now() - pauseAt;
      infinite = wantInf; state = 'playing';
      $('play').hidden = false;
      $('title').textContent = 'Training';
    }
    else startGame();
  } else {
    firing = false;
    for (const k in keys) keys[k] = false;
    if (state === 'playing') {
      state = 'paused'; pauseAt = performance.now();
      if ($('weaponPicker').hidden) {
        $('title').textContent = 'Settings';
        $('info').textContent = 'Adjust your settings, then press ESC again to return to training.';
        $('settingsPanel').hidden = false;
      }
      $('play').hidden = true;
      $('restart').hidden = false;
      $('mainMenu').hidden = false;
    }
  }
});
document.addEventListener('mousemove', e => {
  if (document.pointerLockElement !== el) return;
  const k = sens * 0.07 * RAD * (scopeLevel ? Math.tan(camera.fov * RAD / 2) / Math.tan(xh.fov * RAD / 2) : 1);   // sensitivity follows the zoom
  yaw -= e.movementX * k;
  pitch = Math.max(-1.5, Math.min(1.5, pitch - e.movementY * k));
});
function tryResume() {
  try { const p = el.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) {}
}
document.addEventListener('pointerlockerror', () => {
  $('info').textContent = 'Hindi ma-lock ang mouse. I-click ang RESUME para bumalik.';
});
document.addEventListener('keyup', e => { if (e.code === 'Space' && document.pointerLockElement === el) e.preventDefault(); });
// Browser shortcuts that a page is ALLOWED to cancel (Ctrl/Cmd+D bookmark, +S save, +F find, +G, +P print, +U source).
// Only cancelled while a run is active, and only the default browser action is cancelled - the key still reaches the
// game (keys[] below), so Ctrl-crouch + D/S strafing keeps working. Ctrl+W/T/N are reserved by the browser: see guard below.
const BROWSER_SHORTCUT_KEYS = new Set(['KeyD', 'KeyS', 'KeyF', 'KeyG', 'KeyP', 'KeyU']);
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && BROWSER_SHORTCUT_KEYS.has(e.code) && (state === 'playing' || document.pointerLockElement === el)) e.preventDefault();
  if (e.code === 'Space' && document.pointerLockElement === el) e.preventDefault();
  if (e.code === 'Escape' && !e.repeat && state === 'paused' && document.pointerLockElement !== el) {
    e.preventDefault();
    $('weaponPicker').hidden = true;
    $('settingsPanel').hidden = true;
    tryResume();
  }
  if (e.code === 'KeyB' && !e.repeat && state === 'playing' && document.pointerLockElement === el) {
    e.preventDefault();
    $('weaponPicker').hidden = false;
    $('settingsPanel').hidden = true;
    $('title').textContent = 'Choose Your Weapon';
    $('info').textContent = 'Select a loadout. Press ESC to return to training.';
    try { document.exitPointerLock(); } catch (err) {}
  }
  keys[e.code] = true;
  if (e.code === 'Digit1') equipSlot(1);
  if (e.code === 'Digit2') equipSlot(2);
  if (e.code === 'Digit3') equipSlot(3);
  if (e.code === 'KeyR' && state === 'playing') startReload();
});
document.addEventListener('keyup', e => { keys[e.code] = false; });
// ---------- Operator scope: right click toggles, mouse wheel switches between two magnifications ----------
const SCOPE_MAG = [1, 2.5, 5];                       // level 0 = off, 1 = standard zoom, 2 = high zoom
let scopeLevel = 0, scopeBlend = 0;
const scopeFov = level => 2 * Math.atan(Math.tan(xh.fov * RAD / 2) / SCOPE_MAG[level]) / RAD;
function setScope(level) {
  if (level && !(weapon === 'operator' && state === 'playing' && !reloading && swapPhase === 0)) level = 0;
  if (level === scopeLevel) return;
  const was = scopeLevel; scopeLevel = level;
  $('scopeOverlay').classList.toggle('active', level > 0);
  $('crosshair').style.opacity = level ? '0' : '1';
  if (level) { aimFov = scopeFov(level); $('scopeMag').textContent = '\u00D7' + SCOPE_MAG[level]; if (!was) playSfx('scope', .6); }
  else aimFov = xh.fov;
}
document.addEventListener('wheel', e => {
  if (document.pointerLockElement !== el || weapon !== 'operator' || !scopeLevel) return;
  e.preventDefault(); setScope(e.deltaY < 0 ? 2 : 1);
}, { passive: false });
function setAiming(on) {
  if (!on) setScope(0);
  const canAim = weapon==='vandal' || weapon==='phantom';
  aiming = !!on && canAim && state==='playing';
  aimFov = aiming ? 48 : xh.fov;
  $('adsOverlay').classList.toggle('active',aiming);
  $('crosshair').style.opacity=aiming?'0':'1';
}
document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('mousedown', e => {
  if(e.button===2 && document.pointerLockElement===el){
    if(weapon==='knife'){knifeAttack('alt',performance.now());return;}   // right click: alternate knife attack
    if (weapon === 'operator') { if (state === 'playing' && swapPhase === 0) setScope(scopeLevel ? 0 : 1); return; }
    setAiming(true);return;
  }
  if (e.button !== 0 || document.pointerLockElement !== el) return;
  firing = true;
  const w = WEAPONS[weapon], now = performance.now();
  if (w.auto === false && state === 'playing' && now - lastShot >= w.interval) fire(now);
});
document.addEventListener('mouseup', e => { if (e.button === 0) firing = false; if(e.button===2 && weapon !== 'operator') setAiming(false); });
document.addEventListener('pointerlockchange',()=>{if(document.pointerLockElement!==el)setAiming(false);});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const crouching = () => keys.ControlLeft || keys.ControlRight || keys.KeyC;
const walking = () => keys.ShiftLeft || keys.ShiftRight;
const MAG = { vandal: 25, phantom: 30, sheriff: 6, operator: 5, shotgun: 6 };
const ammo = { vandal: 25, phantom: 30, sheriff: 6, operator: 5, shotgun: 6 };
let reloading = false, reloadLeft = 0;
let infiniteAmmo = false, shellState = null, pumpAt = -1e9;
try { infiniteAmmo = localStorage.getItem('vtm3d_infAmmo') === '1'; $('infAmmo').checked = infiniteAmmo; } catch (e) {}
$('infAmmo').addEventListener('change', e => { infiniteAmmo = e.target.checked; try { localStorage.setItem('vtm3d_infAmmo', infiniteAmmo ? '1' : '0'); } catch (err) {} });
function cancelReload() { reloading = false; reloadLeft = 0; shellState = null; }
function startReload() {
  const w = WEAPONS[weapon];
  // With Infinite Ammo the magazine never drops, but R still plays the full reload animation.
  if (w.melee || reloading || (!infiniteAmmo && ammo[weapon] >= MAG[weapon])) return;
  setScope(0);
  reloading = true; reloadOutDone = reloadSeatDone = false;
  if (w.shell) {                                    // shell by shell: 0.35 s prep + 0.52 s per shell + 0.45 s pump
    shellState = { need: Math.max(1, MAG[weapon] - ammo[weapon]), done: 0 };
    reloadLeft = reloadTotal = .35 + shellState.need * .52 + .45; playSfx('shellStart', .8);
  } else { reloadLeft = reloadTotal = w.reload; playSfx('reload', .8); }
  toast('RELOADING', reloadTotal * 1000);
}
// Per-shot mechanical sounds: Operator bolt cycle, shotgun pump.
function weaponCycleSfx(w) {
  if (w.sniper) setTimeout(() => { if (weapon === 'operator' && state === 'playing') { playSfx('boltBack', .9); setTimeout(() => { if (weapon === 'operator' && state === 'playing') playSfx('boltFwd', .9); }, 330); } }, 420);
  else if (w.pellets) setTimeout(() => { if (weapon === 'shotgun' && state === 'playing') playSfx('pump', 1); }, 260);
}
function postShot(w) {
  recP += w.p * RAD; recY += (Math.random() - .5) * w.y * RAD; spray++;
  gun.position.z = gun.userData.rz + 0.16;
  if (ammo[weapon] <= 0) startReload();
}
// Shotgun: 12 independent pellets in a cone. Each pellet is ray-cast on its own (walls and cover stop it, range is limited).
// Damage is summed per target, so it kills at close range and falls off with distance. Scoring is per trigger pull.
function fireShotgun(w) {
  const moving = ((keys.KeyW || keys.KeyA || keys.KeyS || keys.KeyD) && !walking() && !crouching()) || !grounded;
  let spread = w.spread * (moving ? 1.25 : 1); if (crouching() && !moving) spread *= .8;
  const t = Math.tan(camera.fov / 2 * RAD), perBot = new Map();
  let impacts = 0;
  ray.far = w.range;
  try {
    for (let i = 0; i < w.pellets; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread * RAD;
      ray.setFromCamera({ x: Math.cos(a) * r / (t * camera.aspect), y: Math.sin(a) * r / t }, camera);
      const botHit = ray.intersectObjects(bots, true)[0];
      const worldHit = ray.intersectObjects(solidTargets, false)[0];
      if (worldHit && (!botHit || worldHit.distance < botHit.distance)) { if (impacts++ < 4) bulletImpact(worldHit, ray.ray.direction); continue; }
      if (botHit && botHit.object.botRef) {
        const head = botHit.object.userData.part === 'head', bot = botHit.object.botRef;
        const e = perBot.get(bot) || { dmg: 0, hit: botHit, head: false };
        e.dmg += head ? w.headPelletDmg : w.pelletDmg;
        if (head && !e.head) { e.head = true; e.hit = botHit; }
        perBot.set(bot, e);
      }
    }
  } finally { ray.far = Infinity; }
  let anyHit = false, anyHead = false;
  perBot.forEach((e, bot) => { anyHit = true; if (e.head) anyHead = true; damageBot(bot, e.hit, false, e.dmg); });
  if (anyHit) {
    hits++; score += anyHead ? 150 : 50; if (anyHead) heads++;
    const h = $('hit'); h.className = 'show' + (anyHead ? ' head' : ''); setTimeout(() => h.className = '', 120);
    if (anyHead) toast('HEADSHOT', 400);
  }
  postShot(w);
}
// Bolt handle (Operator) and pump forend (Shotgun) animation, driven by the time since the last shot.
function updateWeaponAnim(now) {
  const gu = gun.userData;
  if (gu.bolt) {
    const u = Math.max(0, Math.min(1, (now - lastFire - 200) / 650)), sb = Math.sin(u * Math.PI);
    gu.bolt.position.z = gu.boltHome.z + sb * .14; gu.bolt.rotation.z = sb * 1.1;
  }
  if (gu.pump) {
    const t0 = Math.max(lastFire + 230, pumpAt), u = Math.max(0, Math.min(1, (now - t0) / 340));
    gu.pump.position.z = Math.sin(u * Math.PI) * .11;
  }
}
function fire(now) {
  const w = WEAPONS[weapon];
  if (w.melee) { knifeAttack('slash', now); return; }       // left click: normal slash
  if (reloading) { if (w.shell && ammo[weapon] > 0) cancelReload(); else return; }     // shotguns can be fired mid-reload
  if (ammo[weapon] <= 0) { startReload(); return; }
  if (!infiniteAmmo) ammo[weapon]--;
  lastShot = lastFire = now; shots++; playGunshot(); weaponCycleSfx(w);
  if (w.pellets) { fireShotgun(w); return; }
  const moving = ((keys.KeyW || keys.KeyA || keys.KeyS || keys.KeyD) && !walking() && !crouching()) || !grounded;
  let sp = moving ? 0.9 : (spray > 2 ? Math.min(0.45, (spray - 2) * 0.06) : 0);
  if(aiming) sp*=.38;
  if (crouching() && !moving) sp *= 0.5;
  if (w.sniper) sp = scopeLevel ? (moving ? 1.1 : 0) : w.hipSpread * (moving ? 1.25 : 1);   // Operator: pin-point when scoped, wild from the hip
  const t = Math.tan(camera.fov / 2 * RAD);
  const ox = (Math.random() - 0.5) * 2 * sp * RAD / (t * camera.aspect);
  const oy = (Math.random() - 0.5) * 2 * sp * RAD / t;
  ray.setFromCamera({ x: ox, y: oy }, camera);
  const botHit = ray.intersectObjects(bots, true)[0];
  const worldHit = ray.intersectObjects(solidTargets, false)[0];
  const worldFirst = worldHit && (!botHit || worldHit.distance < botHit.distance);
  const hit = worldFirst ? null : botHit;
  if (worldFirst) bulletImpact(worldHit, ray.ray.direction);
  if (hit && hit.object.botRef) {
    const head = hit.object.userData.part === 'head';
    hits++; score += head ? 150 : 50; if (head) heads++;
    damageBot(hit.object.botRef,hit,head,w.bodyDmg||1);
    const h = $('hit'); h.className = 'show' + (head ? ' head' : '');
    setTimeout(() => h.className = '', 120);
    if (head) toast('HEADSHOT', 400);
  }
  // recoil
  recP += (spray < 10 ? w.p : w.p * 0.2) * RAD * ((aiming||scopeLevel)?.62:1);
  recY += Math.sin(spray * 0.8) * w.y * Math.min(1, spray / 5) * RAD;
  spray++;
  gun.position.z = gun.userData.rz + 0.12;
  if (ammo[weapon] <= 0) startReload();
}

// ---------- mode logic ----------
function updateRange(now) {
  bots.slice().forEach(b => {
    if (now - b.userData.born > b.userData.life) { removeBot(b); return; }
  });
  bots.forEach(b => { b.position.x += b.userData.vx * 0.016; if (Math.abs(b.position.x) > 14) b.userData.vx *= -1; });
  if (bots.length < level.max && now - lastSpawn > level.gap) {
    let x, z, n = 0;
    do { x = (Math.random() - 0.5) * 24; z = -(8 + Math.random() * 30); n++; } while (nearCrate(x, z, 2.8) && n < 20);
    const v = level.move ? (Math.random() < 0.5 ? -1 : 1) * level.move * (0.5 + Math.random() * 0.5) : 0;
    addBot(x, z, { born: now, life: level.life, vx: v });
    lastSpawn = now;
  }
}
function updateClear(now) {
  if (!bots.length) {
    if (wave > 0) { score += 300; toast('SITE CLEARED +300', 900); }
    wave++;
    const spots = [];
    CLEAR_SPAWNS.forEach(c => spots.push([c[0], c[1]]));
    spots.sort(() => Math.random() - 0.5).slice(0, 8).forEach(s => {
      const v = level.move ? (Math.random() < 0.5 ? -1 : 1) * level.move * 0.4 : 0;
      addBot(s[0], s[1], { cx: s[0], vx: v });
    });
  }
  bots.forEach(b => {
    const u = b.userData;
    if (!u.vx) return;
    b.position.x += u.vx * 0.016;
    if (Math.abs(b.position.x - u.cx) > 1) u.vx *= -1;
  });
}
function updateHold(now, dt) {
  bots.slice().forEach(b => {
    const p = b.userData.peek;
    if (p.ph === 'wait') { p.t -= dt; if (p.t <= 0) p.ph = 'out'; }
    else if (p.ph === 'out') {
      b.position.x += Math.sign(p.ex - b.position.x) * level.speed * dt;
      if (Math.abs(b.position.x - p.ex) < 0.2) { p.ph = 'hold'; p.t = level.hold * (0.7 + Math.random() * 0.6); }
    } else if (p.ph === 'hold') {
      p.t -= dt; b.position.x = p.ex + Math.sin(now / 120) * 0.6 * level.strafe;
      if (p.t <= 0) p.ph = 'back';
    } else {
      b.position.x += Math.sign(p.hx - b.position.x) * level.speed * dt;
      if (Math.abs(b.position.x - p.hx) < 0.3) removeBot(b);
    }
  });
  if (bots.length < level.hmax && now - lastSpawn > level.hgap) {
    const side = Math.random() < 0.5 ? -1 : 1;
    addBot(side * 9, -15, { peek: { ph: 'wait', t: Math.random() * 0.5, hx: side * 9, ex: side * (0.5 + Math.random() * 3) } });
    lastSpawn = now;
  }
}

function endGame() {
  state = 'over'; saveBest();
  const acc = shots ? Math.round(hits / shots * 100) : 0;
  $('title').textContent = 'Training Complete!';
  $('info').textContent = 'Score: ' + score + ' | Accuracy: ' + acc + '% | Headshots: ' + heads + ' | Best: ' + $('best').textContent;
  $('play').textContent = 'Back to Start';
  $('restart').hidden = true; $('mainMenu').hidden = true;
  firing = false; setAiming(false);
  document.exitPointerLock();
  const name = ($('name').value.trim() || 'Player').slice(0, 16);
  lbPost({ name, score, acc }).then(renderLb);
}

// ---------- loop ----------
let prev = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - prev) / 1000); prev = now;
  // Smooth weapon draw / holster transition; rebuild only at the lowered midpoint.
  if(swapPhase>0) {
    if(swapPhase===1){ gun.position.y += (-.98-gun.position.y)*Math.min(1,dt*16); if(gun.position.y<-.82){ if(swapKey){buildGun(WEAPONS[swapKey]);swapKey=null;gun.scale.setScalar(gunScale(weapon));gun.userData.baseX=gun.position.x;gun.userData.baseY=gun.position.y;gun.userData.baseZ=gun.position.z;gun.userData.rz=gun.position.z;gun.position.y=-.98;} swapPhase=2; } }
    else { gun.position.y += ((gun.userData.baseY??-.27)-gun.position.y)*Math.min(1,dt*13); if(Math.abs(gun.position.y-(gun.userData.baseY??-.27))<.018) swapPhase=0; }
  }
  gun.position.z += (gun.userData.rz - gun.position.z) * 0.3;
  camera.fov += (aimFov-camera.fov)*Math.min(1,dt*10); camera.updateProjectionMatrix();
  scopeBlend += ((scopeLevel ? 1 : 0) - scopeBlend) * Math.min(1, dt * 10); gunRig.visible = scopeBlend < .5;   // weapon model is hidden behind the scope
  updateCombatFX(dt);
  if (!updateKnife(dt)) {
    gun.rotation.x += ((reloading ? 0.9 : 0) - gun.rotation.x) * 0.2; gun.rotation.z *= 0.7; gun.rotation.y *= 0.7;
    if (weapon === 'knife' && gun.userData.baseX !== undefined) gun.position.x += (gun.userData.baseX - gun.position.x) * 0.3;
  }
  updateWeaponAnim(now); updateReloadAnim(dt); updateDroppedMags(dt); updateDecals(now / 1000);

  $('ammo').textContent = WEAPONS[weapon].melee ? '' : (reloading ? 'Reloading' : (infiniteAmmo ? '\u221E' : ammo[weapon] + '/' + MAG[weapon]));
  if (state === 'playing') {
    if (reloading) {
      reloadLeft -= dt;
      if (shellState && WEAPONS[weapon].shell) {
        const due = Math.min(shellState.need, Math.max(0, Math.floor((reloadTotal - reloadLeft - .35) / .52 + .34)));
        while (shellState.done < due) { shellState.done++; ammo[weapon] = Math.min(MAG[weapon], ammo[weapon] + 1); playSfx('shellIn', .85); }
        if (reloadLeft <= 0) { ammo[weapon] = MAG[weapon]; shellState = null; reloading = false; pumpAt = performance.now(); playSfx('pump', 1); }
      } else if (reloadLeft <= 0) { reloading = false; ammo[weapon] = MAG[weapon]; }
    }
    if (firing && WEAPONS[weapon].auto !== false && now - lastShot >= WEAPONS[weapon].interval) fire(now);
    if (now - lastFire > 250) {
      spray = 0;
      const d = Math.min(1, dt * 7);
      recP -= recP * d; recY -= recY * d;
    }
    const crouch = crouching();
    const sp = (crouch ? 2.2 : (walking() ? 3 : (weapon === 'knife' ? 8 : 7))) * dt;
    const fx = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0), fz = (keys.KeyS ? 1 : 0) - (keys.KeyW ? 1 : 0);
    let nx = camera.position.x + (fx * Math.cos(yaw) + fz * Math.sin(yaw)) * sp;
    let nz = camera.position.z + (-fx * Math.sin(yaw) + fz * Math.cos(yaw)) * sp;
    nx = Math.max(-17, Math.min(17, nx));
    nz = Math.max(-52, Math.min(12, nz));
    if (!grounded && jumpY > 0.4) {   // airborne right above a standable prop: damp the drift so a full-speed jump can really land on it
      for (let i = 0; i < propColliders.length; i++) {
        const c = propColliders[i];
        if (jumpY < c.top - 0.05 || jumpY > c.top + 0.7) continue;
        const ddx = camera.position.x - c.x, ddz = camera.position.z - c.z, rr = c.r + 0.12;
        if (ddx * ddx + ddz * ddz <= rr * rr) { nx = camera.position.x + (nx - camera.position.x) * 0.35; nz = camera.position.z + (nz - camera.position.z) * 0.35; break; }
      }
    }
    _pp.x = nx; _pp.z = nz; pushOutOfProps(_pp, jumpY); nx = _pp.x; nz = _pp.z;
    {
      houseBoxes.forEach(h => {
        const p = 0.5;
        if (nx > h[0] - p && nx < h[1] + p && nz > h[2] - p && nz < h[3] + p) {
          const dl = nx - (h[0] - p), dr = (h[1] + p) - nx, dt2 = nz - (h[2] - p), db = (h[3] + p) - nz, m = Math.min(dl, dr, dt2, db);
          if (m === dl) nx = h[0] - p; else if (m === dr) nx = h[1] + p; else if (m === dt2) nz = h[2] - p; else nz = h[3] + p;
        }
      });
    }
    _pp.x = nx; _pp.z = nz; pushOutOfProps(_pp, jumpY); nx = _pp.x; nz = _pp.z;   // second pass: buildings may have pushed us into a prop
    rigSpeed = Math.hypot(nx - camera.position.x, nz - camera.position.z) / Math.max(dt, 1e-3);
    camera.position.x = nx; camera.position.z = nz;
    const isMoving = (Math.abs(fx)+Math.abs(fz)) > 0 && grounded;
    if(isMoving) { playerStepClock += dt; const stepRate = walking() ? .56 : (crouch ? .72 : .43); if(playerStepClock >= stepRate){ playSfx('footstep', crouch?.18:.34); playerStepClock=0; } }
    else playerStepClock = Math.min(playerStepClock, .12);
    eyeY += ((crouch ? 1.05 : 1.6) - eyeY) * Math.min(1, dt * 12);
    const prevFeet = jumpY;
    if (keys.Space && grounded && !crouch) { vy = JUMP_SPEED; grounded = false; }
    vy -= GRAVITY * dt;
    jumpY += vy * dt;
    const gTop = groundHeightAt(nx, nz, prevFeet);        // floor (0) or the top of a prop under the player
    if (jumpY <= gTop && vy <= 0) {
      if (!grounded && vy < -3) { landImpact = -vy; playSfx('footstep', Math.min(.6, .2 - vy * .04)); }
      jumpY = gTop; vy = 0; grounded = true;
    } else grounded = false;
    camera.position.y = eyeY + jumpY;

    updateRange(now);
    if(bots.some(b=>Math.abs(b.userData.vx||0)>.15)) { enemyStepClock += dt; if(enemyStepClock >= .72){ playSfx('enemyStep',.20); enemyStepClock=0; } }

    const left = infinite ? Infinity : DURATION - (now - startTime) / 1000;
    hud(left);
    if (!infinite && left <= 0) endGame();   // Infinite Training never ends on its own
  }
  updateGunRig(dt);
  camera.rotation.y = yaw + recY; camera.rotation.x = Math.max(-1.55, Math.min(1.55, pitch + recP));
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
camera.position.set(0, 1.68, 0);
drawWorldTimer(DURATION);
setWeapon(loadout.primary);
if (soundVolumeControl) { try { const sv = localStorage.getItem('vtm3d_vol'); if (sv !== null) soundVolumeControl.value = sv; } catch (e) {} masterVolume = Number(soundVolumeControl.value); }
applyMode();
loadBest();
renderLb();
drawXh();
requestAnimationFrame(loop);

// ---------- Reserved browser shortcuts (Ctrl+W closes the tab) ----------
// Browsers do not let a normal page cancel Ctrl+W / Ctrl+T / Ctrl+N. Instead of fragile hacks we use the two supported tools:
//  1) a standard "Leave site?" confirmation while a run is active, so an accidental Ctrl+W can be cancelled, and
//  2) the Keyboard Lock API (Chromium only, requires fullscreen), which routes those combos to the game.
addEventListener('beforeunload', e => {
  if (state === 'playing' || state === 'paused') { e.preventDefault(); e.returnValue = ''; return ''; }
});
const KEY_LOCK_LIST = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyC', 'KeyR', 'ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'Space', 'Digit1', 'Digit2', 'Digit3'];
function lockGameKeys() {
  try { if (navigator.keyboard && navigator.keyboard.lock && document.fullscreenElement) { const p = navigator.keyboard.lock(KEY_LOCK_LIST); if (p && p.catch) p.catch(() => {}); } } catch (e) {}
}
function unlockGameKeys() { try { if (navigator.keyboard && navigator.keyboard.unlock) navigator.keyboard.unlock(); } catch (e) {} }
document.addEventListener('fullscreenchange', () => {
  const fs = !!document.fullscreenElement;
  $('fsBtn').textContent = fs ? 'EXIT FULLSCREEN' : 'FULLSCREEN';
  if (fs) lockGameKeys(); else unlockGameKeys();
});
if (!document.fullscreenEnabled) $('fsBtn').hidden = true;
$('fsBtn').addEventListener('click', () => {
  try {
    if (document.fullscreenElement) { const r = document.exitFullscreen(); if (r && r.catch) r.catch(() => {}); }
    else { const r = document.documentElement.requestFullscreen(); if (r && r.catch) r.catch(() => {}); }
  } catch (e) {}
});
let shortcutTipShown = false;
function showShortcutTip() {
  if (shortcutTipShown) return; shortcutTipShown = true;
  toast('Tip: Ctrl+W closes the tab - crouch with C, or use Fullscreen', 4500);
}
