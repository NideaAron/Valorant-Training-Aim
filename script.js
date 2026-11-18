const cv = document.getElementById('game');
const ctx = cv.getContext('2d');
const W = cv.width, H = cv.height;
const $ = id => document.getElementById(id);
const LEVELS = {
  easy:   { life: 2200, gap: 800, max: 2, size: 1.2 },
  medium: { life: 1500, gap: 550, max: 3, size: 1.0 },
  hard:   { life: 1000, gap: 380, max: 4, size: 0.8 }
};
const DURATION = 60;
let state = 'idle', bots = [], mouse = { x: W / 2, y: H / 2 };
let score = 0, shots = 0, hits = 0, heads = 0, startTime = 0, lastSpawn = 0, flashes = [];

function bestKey() { return 'vtm_best_' + $('difficulty').value; }
function loadBest() {
  try { $('best').textContent = localStorage.getItem(bestKey()) || 0; }
  catch (e) { $('best').textContent = 0; }
}
function saveBest() {
  try {
    const old = Number(localStorage.getItem(bestKey()) || 0);
    if (score > old) localStorage.setItem(bestKey(), score);
  } catch (e) {}
  loadBest();
}

function start() {
  score = shots = hits = heads = 0; bots = []; flashes = [];
  startTime = performance.now(); lastSpawn = 0; state = 'playing';
  updateHud(DURATION);
}

function spawn(now) {
  const L = LEVELS[$('difficulty').value];
  const s = 40 * L.size;
  bots.push({
    x: 80 + Math.random() * (W - 160),
    y: 90 + Math.random() * (H - 150),
    s, born: now, life: L.life
  });
}

function updateHud(left) {
  $('time').textContent = Math.max(0, Math.ceil(left));
  $('score').textContent = score;
  $('acc').textContent = (shots ? Math.round(hits / shots * 100) : 0) + '%';
}

function hitTest(b, x, y) {
  const hx = b.x, hy = b.y - b.s * 1.45, hr = b.s * 0.38;
  if (Math.hypot(x - hx, y - hy) <= hr) return 'head';
  if (Math.abs(x - b.x) <= b.s * 0.6 && y >= b.y - b.s * 1.05 && y <= b.y + b.s * 0.9) return 'body';
  return null;
}

function shoot() {
  if (state !== 'playing') { start(); return; }
  shots++;
  for (let i = bots.length - 1; i >= 0; i--) {
    const r = hitTest(bots[i], mouse.x, mouse.y);
    if (r) {
      hits++;
      if (r === 'head') { score += 150; heads++; } else { score += 50; }
      flashes.push({ x: mouse.x, y: mouse.y, t: performance.now(), head: r === 'head' });
      bots.splice(i, 1);
      return;
    }
  }
}

function drawBot(b, now) {
  const age = (now - b.born) / b.life;
  ctx.globalAlpha = 1 - Math.max(0, age - 0.7) * 2;
  ctx.fillStyle = '#ff4655';
  ctx.fillRect(b.x - b.s * 0.6, b.y - b.s * 1.05, b.s * 1.2, b.s * 1.95);
  ctx.fillStyle = '#ece8e1';
  ctx.beginPath(); ctx.arc(b.x, b.y - b.s * 1.45, b.s * 0.38, 0, 7); ctx.fill();
  ctx.globalAlpha = 1;
}

function drawCrosshair() {
  const { x, y } = mouse;
  ctx.strokeStyle = '#00ff9c'; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - 14, y); ctx.lineTo(x - 5, y);
  ctx.moveTo(x + 5, y); ctx.lineTo(x + 14, y);
  ctx.moveTo(x, y - 14); ctx.lineTo(x, y - 5);
  ctx.moveTo(x, y + 5); ctx.lineTo(x, y + 14);
  ctx.stroke();
}

function centerText(lines) {
  ctx.fillStyle = 'rgba(15,25,35,.85)'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#ece8e1'; ctx.textAlign = 'center';
  lines.forEach((l, i) => {
    ctx.font = (i === 0 ? 'bold 40px' : '22px') + ' Arial';
    ctx.fillStyle = i === 0 ? '#ff4655' : '#ece8e1';
    ctx.fillText(l, W / 2, H / 2 - 50 + i * 40);
  });
}

function frame(now) {
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = '#1f2d3a'; ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 60) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 60) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  if (state === 'playing') {
    const left = DURATION - (now - startTime) / 1000;
    const L = LEVELS[$('difficulty').value];
    bots = bots.filter(b => now - b.born < b.life);
    if (bots.length < L.max && now - lastSpawn > L.gap) { spawn(now); lastSpawn = now; }
    bots.forEach(b => drawBot(b, now));
    flashes = flashes.filter(f => now - f.t < 300);
    flashes.forEach(f => {
      ctx.fillStyle = f.head ? '#ffd23f' : '#ece8e1'; ctx.font = 'bold 20px Arial'; ctx.textAlign = 'center';
      ctx.fillText(f.head ? 'HEADSHOT +150' : '+50', f.x, f.y - 20 - (now - f.t) / 15);
    });
    updateHud(left);
    if (left <= 0) { state = 'over'; saveBest(); }
  } else if (state === 'idle') {
    centerText(['Click to start', 'Shoot the bots. Aim for the head.']);
  } else {
    const acc = shots ? Math.round(hits / shots * 100) : 0;
    centerText(['Time is up', 'Score: ' + score, 'Accuracy: ' + acc + '%   Headshots: ' + heads, 'Click to play again']);
  }
  drawCrosshair();
  requestAnimationFrame(frame);
}

function pos(e) {
  const r = cv.getBoundingClientRect();
  mouse.x = (e.clientX - r.left) * W / r.width;
  mouse.y = (e.clientY - r.top) * H / r.height;
}
cv.addEventListener('mousemove', pos);
cv.addEventListener('pointerdown', e => { pos(e); shoot(); });
$('difficulty').addEventListener('change', () => { state = 'idle'; bots = []; loadBest(); updateHud(DURATION); });
loadBest();
requestAnimationFrame(frame);
