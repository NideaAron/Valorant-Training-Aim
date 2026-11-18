const $ = id => document.getElementById(id);
const DURATION = 60;
const LEVELS = {
  easy:   { life: 3200, gap: 700, max: 3, move: 0 },
  medium: { life: 2400, gap: 500, max: 4, move: 1.5 },
  hard:   { life: 1600, gap: 350, max: 5, move: 3.2 }
};

// ---------- scene ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fd3ff);
scene.fog = new THREE.Fog(0x8fd3ff, 30, 70);
const camera = new THREE.PerspectiveCamera(80, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 1.6, 0);
camera.rotation.order = 'YXZ';
scene.add(camera);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
$('wrap').appendChild(renderer.domElement);
scene.add(new THREE.AmbientLight(0xffffff, 0.75));
const sun = new THREE.DirectionalLight(0xffffff, 0.6);
sun.position.set(5, 10, 5);
scene.add(sun);

function box(w, h, d, color, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
  m.position.set(x, y, z);
  scene.add(m);
  return m;
}
// checker floor
const c = document.createElement('canvas'); c.width = c.height = 64;
const g = c.getContext('2d');
g.fillStyle = '#7a8794'; g.fillRect(0, 0, 64, 64);
g.fillStyle = '#6a7683'; g.fillRect(0, 0, 32, 32); g.fillRect(32, 32, 32, 32);
const tex = new THREE.CanvasTexture(c);
tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(20, 30); tex.magFilter = THREE.NearestFilter;
const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 60), new THREE.MeshLambertMaterial({ map: tex }));
floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, -25);
scene.add(floor);
box(40, 10, 1, 0x3b4a5c, 0, 5, -55);      // back wall
box(1, 10, 60, 0x4a5b70, -20, 5, -25);    // left wall
box(1, 10, 60, 0x4a5b70, 20, 5, -25);     // right wall
box(1, 10, 10, 0x4a5b70, 0, 5, 5);        // behind player
[[-6, -14], [7, -20], [-10, -30], [11, -36], [0, -42]].forEach(p => box(2, 2, 2, 0xe08a2e, p[0], 1, p[1]));
box(6, 0.2, 0.2, 0xff4655, 0, 0.1, -3); // start line

// gun (blocky)
const gun = new THREE.Group();
const gb = (w, h, d, col, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color: col })); m.position.set(x, y, z); gun.add(m); };
gb(0.12, 0.14, 0.6, 0x222222, 0, 0, 0);
gb(0.1, 0.22, 0.12, 0x222222, 0, -0.17, 0.15);
gb(0.14, 0.16, 0.2, 0xff4655, 0, 0.02, -0.1);
gun.position.set(0.35, -0.3, -0.7);
camera.add(gun);

// ---------- bots ----------
let bots = [];
function makeBot() {
  const grp = new THREE.Group();
  const mk = (w, h, d, col, x, y, part) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color: col }));
    m.position.set(x, y, 0); m.userData.part = part; m.userData.bot = grp; grp.add(m);
  };
  mk(0.35, 0.8, 0.3, 0x2b3a55, -0.18, 0.4, 'body');
  mk(0.35, 0.8, 0.3, 0x2b3a55, 0.18, 0.4, 'body');
  mk(0.75, 0.8, 0.4, 0xff4655, 0, 1.2, 'body');
  mk(0.3, 0.8, 0.3, 0xff4655, -0.55, 1.2, 'body');
  mk(0.3, 0.8, 0.3, 0xff4655, 0.55, 1.2, 'body');
  mk(0.5, 0.5, 0.5, 0xffd23f, 0, 1.85, 'head');
  return grp;
}
function spawnBot(now, L) {
  const b = makeBot();
  b.position.set((Math.random() - 0.5) * 24, 0, -(8 + Math.random() * 30));
  b.userData.born = now;
  b.userData.life = L.life;
  b.userData.vx = L.move ? (Math.random() < 0.5 ? -1 : 1) * L.move * (0.5 + Math.random() * 0.5) : 0;
  scene.add(b); bots.push(b);
}
function removeBot(b) { scene.remove(b); bots = bots.filter(x => x !== b); }

// ---------- state ----------
let state = 'idle', score = 0, shots = 0, hits = 0, heads = 0;
let startTime = 0, pauseAt = 0, lastSpawn = 0, lastShot = 0, yaw = 0, pitch = 0;
let level = LEVELS.medium;
const keys = {};
const ray = new THREE.Raycaster();
let audio;

function bestKey() { return 'vtm3d_best_' + $('difficulty').value; }
function loadBest() { try { $('best').textContent = localStorage.getItem(bestKey()) || 0; } catch (e) { $('best').textContent = 0; } }
function saveBest() {
  try { if (score > Number(localStorage.getItem(bestKey()) || 0)) localStorage.setItem(bestKey(), score); } catch (e) {}
  loadBest();
}
function hud(left) {
  $('time').textContent = Math.max(0, Math.ceil(left));
  $('score').textContent = score;
  $('acc').textContent = (shots ? Math.round(hits / shots * 100) : 0) + '%';
}
function beep(f, d) {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator(), v = audio.createGain();
    o.frequency.value = f; o.type = 'square'; v.gain.value = 0.05;
    o.connect(v); v.connect(audio.destination); o.start(); o.stop(audio.currentTime + d);
  } catch (e) {}
}
function startGame() {
  bots.slice().forEach(removeBot);
  score = shots = hits = heads = 0; yaw = pitch = 0;
  camera.position.set(0, 1.6, 0);
  level = LEVELS[$('difficulty').value];
  startTime = performance.now(); lastSpawn = 0; state = 'playing';
  hud(DURATION);
}

// ---------- sensitivity ----------
let sens = 0.4;
try { sens = Number(localStorage.getItem('vtm3d_sens')) || 0.4; } catch (e) {}
function setSens(v) {
  v = Math.min(2, Math.max(0.05, Number(v) || 0.4));
  sens = v; $('sensRange').value = v; $('sensNum').value = v;
  try { localStorage.setItem('vtm3d_sens', v); } catch (e) {}
}
setSens(sens);
$('sensRange').addEventListener('input', e => setSens(e.target.value));
$('sensNum').addEventListener('change', e => setSens(e.target.value));
$('difficulty').addEventListener('change', loadBest);

// ---------- input ----------
const el = renderer.domElement;
$('play').addEventListener('click', () => el.requestPointerLock());
$('restart').addEventListener('click', () => { state = 'idle'; el.requestPointerLock(); });
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === el;
  $('overlay').classList.toggle('hidden', locked);
  if (locked) {
    if (state === 'paused') { startTime += performance.now() - pauseAt; state = 'playing'; }
    else startGame();
  } else if (state === 'playing') {
    state = 'paused'; pauseAt = performance.now();
    $('title').textContent = 'Paused';
    $('info').textContent = 'Change your sensitivity here, then resume.';
    $('play').textContent = 'Resume';
    $('restart').hidden = false;
  }
});
document.addEventListener('mousemove', e => {
  if (document.pointerLockElement !== el) return;
  const k = sens * 0.07 * Math.PI / 180;
  yaw -= e.movementX * k;
  pitch = Math.max(-1.5, Math.min(1.5, pitch - e.movementY * k));
});
document.addEventListener('keydown', e => { keys[e.code] = true; });
document.addEventListener('keyup', e => { keys[e.code] = false; });
document.addEventListener('mousedown', e => {
  if (e.button !== 0 || state !== 'playing' || document.pointerLockElement !== el) return;
  const now = performance.now();
  if (now - lastShot < 90) return;
  lastShot = now; shots++; beep(180, 0.06);
  gun.position.z = -0.55;
  ray.setFromCamera({ x: 0, y: 0 }, camera);
  const hit = ray.intersectObjects(bots, true)[0];
  if (hit && hit.object.userData.bot) {
    const head = hit.object.userData.part === 'head';
    hits++; score += head ? 150 : 50; if (head) heads++;
    removeBot(hit.object.userData.bot);
    beep(head ? 900 : 500, 0.08);
    const h = $('hit'); h.className = 'show' + (head ? ' head' : '');
    setTimeout(() => h.className = '', 120);
    if (head) { $('toast').textContent = 'HEADSHOT'; setTimeout(() => $('toast').textContent = '', 400); }
  }
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- loop ----------
let prev = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - prev) / 1000); prev = now;
  gun.position.z += (-0.7 - gun.position.z) * 0.3;
  camera.rotation.y = yaw; camera.rotation.x = pitch;

  if (state === 'playing') {
    const sp = 5 * dt;
    const fx = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0), fz = (keys.KeyS ? 1 : 0) - (keys.KeyW ? 1 : 0);
    camera.position.x = Math.max(-9, Math.min(9, camera.position.x + (fx * Math.cos(yaw) + fz * Math.sin(yaw)) * sp));
    camera.position.z = Math.max(-3, Math.min(3, camera.position.z + (-fx * Math.sin(yaw) + fz * Math.cos(yaw)) * sp));

    bots.slice().forEach(b => {
      if (now - b.userData.born > b.userData.life) { removeBot(b); return; }
      b.position.x += b.userData.vx * dt;
      if (Math.abs(b.position.x) > 14) b.userData.vx *= -1;
    });
    if (bots.length < level.max && now - lastSpawn > level.gap) { spawnBot(now, level); lastSpawn = now; }

    const left = DURATION - (now - startTime) / 1000;
    hud(left);
    if (left <= 0) {
      state = 'over'; saveBest();
      const acc = shots ? Math.round(hits / shots * 100) : 0;
      $('title').textContent = 'Time is up';
      $('info').textContent = 'Score ' + score + ' | Accuracy ' + acc + '% | Headshots ' + heads;
      $('play').textContent = 'Play again';
      $('restart').hidden = true;
      document.exitPointerLock();
    }
  }
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
loadBest();
requestAnimationFrame(loop);
