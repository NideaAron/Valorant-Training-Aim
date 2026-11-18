const $ = id => document.getElementById(id);
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
  knife:   { name: 'Knife',   interval: 550, melee: true, auto: true }
};
const CLEAR_SPAWNS = [[-8, -18], [8, -18], [-12, -30], [12, -30], [-8, -42], [8, -42], [0, -35], [0, -48]];

// ---------- scene ----------
const scene = new THREE.Scene();
// Enclosed indoor training facility: no open sky or clouds.
scene.background = new THREE.Color(0x202a35);
scene.fog = new THREE.Fog(0x202a35, 58, 92);
const camera = new THREE.PerspectiveCamera(80, innerWidth / innerHeight, 0.1, 100);
camera.rotation.order = 'YXZ';
scene.add(camera);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('wrap').appendChild(renderer.domElement);
scene.add(new THREE.AmbientLight(0xcbd8e8, 0.78));
const facilityLight = new THREE.DirectionalLight(0xfff1dc, 0.72);
facilityLight.position.set(-12, 18, 8);
facilityLight.target.position.set(0, 0, -24);
scene.add(facilityLight.target);
facilityLight.castShadow = true;
facilityLight.shadow.mapSize.set(2048, 2048);
Object.assign(facilityLight.shadow.camera, { left: -28, right: 28, top: 24, bottom: -24, near: 1, far: 90 });
facilityLight.shadow.bias = -0.0005;
scene.add(facilityLight);

function box(w, h, d, color, x, y, z, parent) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
  m.position.set(x, y, z); m.castShadow = m.receiveShadow = true;
  (parent || scene).add(m);
  return m;
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
const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 70), new THREE.MeshStandardMaterial({ map: tex, roughness: .96, metalness: .02 }));
floor.receiveShadow = true;
floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, -22);
scene.add(floor);
const wc = document.createElement('canvas'); wc.width = wc.height = 128;
const wg = wc.getContext('2d');
wg.fillStyle = '#5b6d84'; wg.fillRect(0, 0, 128, 128);
wg.strokeStyle = '#46566a'; wg.lineWidth = 3;
wg.strokeRect(2, 2, 124, 124); wg.beginPath(); wg.moveTo(64, 2); wg.lineTo(64, 126); wg.stroke();
wg.fillStyle = '#6b7d95'; wg.fillRect(8, 8, 48, 8); wg.fillRect(72, 70, 48, 8);
const wallTex = new THREE.CanvasTexture(wc);
function wbox(w, h, d, x, y, z, rx, ry) {
  const t = wallTex.clone(); t.needsUpdate = true; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry);
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ map: t }));
  m.position.set(x, y, z); m.receiveShadow = true; scene.add(m);
}
wbox(40, 10, 1, 0, 5, -56, 8, 2);
wbox(1, 10, 70, -20, 5, -22, 14, 2);
wbox(1, 10, 70, 20, 5, -22, 14, 2);
wbox(40, 10, 1, 0, 5, 13, 8, 2);

// Solid ceiling, support beams and industrial ceiling lights create a covered range.
const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(40, 70), new THREE.MeshLambertMaterial({ color: 0x303b49, side: THREE.DoubleSide }));
ceiling.rotation.x = -Math.PI / 2; ceiling.position.set(0, 14, -21.5); ceiling.receiveShadow = true; scene.add(ceiling);
for (let z = 7; z >= -50; z -= 11) box(40, 0.28, 0.32, 0x1b2531, 0, 13.72, z);
box(0.28, 0.28, 70, 0x1b2531, -19.4, 13.72, -21.5);
box(0.28, 0.28, 70, 0x1b2531, 19.4, 13.72, -21.5);
for (let z = 5; z >= -48; z -= 17) {
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.12, 0.65), new THREE.MeshBasicMaterial({ color: 0xfff0c8 }));
  lamp.position.set(0, 13.78, z); scene.add(lamp);
  const glow = new THREE.PointLight(0xffe6bd, 0.65, 23, 2);
  glow.position.set(0, 12.8, z); scene.add(glow);
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
function trashBin(x,z,rot=0) {
  const body = clutterMesh(new THREE.CylinderGeometry(0.42,0.34,1.15,12),clutterMats.bin,x,0.58,z,0,rot);
  clutterMesh(new THREE.CylinderGeometry(0.46,0.46,0.12,12),clutterMats.binLid,x,1.19,z,0,rot);
  clutterMesh(new THREE.BoxGeometry(0.34,0.12,0.04),clutterMats.metal,x,0.92,z+0.35,0,rot);
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
  if(a[3]==='stone') clutterMesh(new THREE.DodecahedronGeometry(.22+(i%3)*.07,0),mat,x,y+.12,z,.1*i,.3*i);
  else if(a[3]==='bottle') clutterMesh(new THREE.CylinderGeometry(.07,.09,.34,8),mat,x,y+.17,z,Math.PI/2,.2*i);
  else clutterMesh(new THREE.BoxGeometry(.22+(i%3)*.13,.035,.3+(i%2)*.12),mat,x,y,z,.08*i,.3*i);
});
// A few snapped planks and small rubble piles near the walls.
[[-15.5,-18,.9],[15.4,-42,-.7],[-16.2,-48,.4],[14.8,-11,-.5]].forEach(([x,z,r])=>{
  clutterMesh(new THREE.BoxGeometry(1.15,.09,.18),clutterMats.wood,x,.07,z,r,.25);
  clutterMesh(new THREE.BoxGeometry(.42,.07,.13),clutterMats.wood,x+.48,.12,z+.12,-r,.6);
});

// gun
const gun = new THREE.Group();
camera.add(gun);
scene.add(camera);
function buildGun(w) {
  while (gun.children.length) gun.remove(gun.children[0]);
  const mk = (geo, col, x, y, z, rx) => {
    const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: col }));
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
    const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.05, 0.5, 4), new THREE.MeshLambertMaterial({ color: 0xd8dde3 }));
    blade.rotation.x = -Math.PI / 2; blade.scale.x = 0.3; blade.position.set(0, 0, -0.3); gun.add(blade);
    mk(C(0.035, 0.22), 0x222222, 0, 0, 0.05, Math.PI / 2);
    mk(C(0.06, 0.03), 0xff4655, 0, 0, -0.07, Math.PI / 2);
    hand(0, -0.01, 0.05); arm([0, -0.02, 0.1], [0.15, -0.35, 0.7]);
    gun.position.set(0.3, -0.28, -0.6);
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
    mk(B(.07,.29,.12),violet2,0,-.19,-.12,.38);             // curved magazine
    mk(B(.045,.055,.07),silver,0,.13,-.2);                  // sight
    // Silver trim and ornamental panels inspired by the supplied dark-violet rifle reference.
    mk(B(.014,.018,.48),silver,-.058,.055,-.02);
    mk(B(.014,.018,.34),silver,.058,.045,-.42);
    mk(new THREE.OctahedronGeometry(.075,0),violet2,0,.095,.18);
    mk(B(.018,.06,.22),silver,-.052,-.015,.42,.15);
    hand(0,-.19,.13,1); arm([0,-.2,.17],[.15,-.5,.75]);
    hand(0,-.09,-.42,-1); arm([0,-.1,-.38],[-.28,-.5,.35]);
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
    mk(B(.075,.32,.14),pale,0,-.2,-.12,.28);               // Phantom magazine
    mk(B(.045,.055,.08),dark,0,.14,-.22);
    // Shell-like upper shroud and flowing pale side panels.
    mk(B(.13,.025,.48),pink,0,.105,-.02);
    mk(B(.018,.018,.5),pale,-.066,.045,-.03);
    mk(B(.018,.018,.5),pale,.066,.045,-.03);
    mk(new THREE.TorusGeometry(.13,.018,6,18),pink,0,.085,.18);
    mk(B(.025,.12,.23),plum,-.067,-.015,-.4,.12);
    mk(B(.025,.12,.23),plum,.067,-.015,-.4,-.12);
    hand(0,-.19,.13,1); arm([0,-.2,.17],[.15,-.5,.75]);
    hand(0,-.09,-.42,-1); arm([0,-.1,-.38],[-.28,-.5,.35]);
    gun.position.set(.3,-.27,-.75); return;
  }
  // Sheriff revolver
  mk(B(0.07, 0.08, 0.36), D, 0, 0.02, -0.17);                  // barrel block
  mk(B(0.05, 0.015, 0.36), 0xd3d7dc, 0, 0.067, -0.17);         // top strip
  mk(C(0.062, 0.1), 0xaab0b8, 0, 0, 0.03, Math.PI / 2);        // cylinder drum
  mk(B(0.075, 0.1, 0.12), K, 0, -0.005, 0.12);                 // frame
  mk(B(0.03, 0.04, 0.04), K, 0, 0.06, 0.17, -0.5);             // hammer
  mk(B(0.065, 0.22, 0.1), K, 0, -0.14, 0.2, -0.4);             // grip
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
  violet: new THREE.MeshBasicMaterial({ color: 0xb44cff })
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
function makeBot() {
  const grp = new THREE.Group();
  const add = (geo, col, x, y, z, part, sc, basic) => {
    const m = new THREE.Mesh(geo, basic ? new THREE.MeshBasicMaterial({ color: col }) : new THREE.MeshLambertMaterial({ color: col }));
    m.position.set(x, y, z); m.userData.part = part; m.botRef = grp; m.castShadow = false; m.receiveShadow = false;
    if (sc) m.scale.set(sc[0], sc[1], sc[2]);
    grp.add(m); return m;
  };
  const cyl = (rt, rb, h) => new THREE.CylinderGeometry(rt, rb, h, 12);
  const sph = r => new THREE.SphereGeometry(r, 14, 12);
  const box = (a, b, c) => new THREE.BoxGeometry(a, b, c);
  const G = 0x4a5568, L = 0x5d6b80, DK = 0x2d3440, OR = 0xd9742b, BL = 0x39a7ff;
  [-1, 1].forEach(sd => {
    add(box(0.17, 0.1, 0.3), DK, sd * 0.17, 0.05, 0.05, 'body');
    add(cyl(0.065, 0.075, 0.42), G, sd * 0.17, 0.3, 0, 'body');
    add(sph(0.085), DK, sd * 0.17, 0.52, 0, 'body');
    add(cyl(0.1, 0.085, 0.45), L, sd * 0.17, 0.76, 0, 'body');
    add(sph(0.125), L, sd * 0.37, 1.6, 0, 'body');
    add(cyl(0.065, 0.06, 0.32), G, sd * 0.41, 1.4, 0, 'body');
    add(sph(0.07), DK, sd * 0.41, 1.22, 0, 'body');
    add(cyl(0.06, 0.05, 0.3), L, sd * 0.42, 1.04, 0, 'body');
    add(sph(0.065), DK, sd * 0.42, 0.85, 0, 'body');
  });
  add(cyl(0.2, 0.17, 0.2), G, 0, 1.03, 0, 'body');
  add(cyl(0.1, 0.1, 0.14), DK, 0, 1.18, 0, 'body');
  add(cyl(0.27, 0.2, 0.5), L, 0, 1.5, 0, 'body');
  add(box(0.3, 0.2, 0.08), 0x7a8aa0, 0, 1.58, 0.2, 'body');
  add(sph(0.04), BL, 0, 1.58, 0.25, 'body', null, true);
  add(cyl(0.05, 0.05, 0.12), OR, 0, 1.78, 0, 'body');
  add(sph(0.17), 0xcfd4da, 0, 1.92, 0, 'head', [0.9, 1.15, 0.95]);
  add(sph(0.09), BL, 0, 1.93, 0.13, 'head', [1, 0.8, 0.5], true);
  const hb = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
  hb.position.set(0, 1.92, 0); hb.userData.part = 'head'; hb.botRef = grp; grp.add(hb);
  return grp;
}
function addBot(x, z, extra) {
  const b = makeBot();
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
function burstFX(position, color=0x9b55ff, count=12, power=2.6) {
  // Bound active effects so sustained firing cannot overwhelm the browser/GPU.
  const allowed = Math.max(0, Math.min(count, MAX_COMBAT_PARTICLES - particles.length));
  for(let i=0;i<allowed;i++) {
    const mat = color === 0x65caff ? combatParticleMaterials.cyan : combatParticleMaterials.violet;
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
function damageBot(bot, hit, headshot) {
  if(!bot || !bots.includes(bot) || !hit || !hit.point) return;
  const point=hit.point.clone();
  burstFX(point, headshot ? 0xb44cff : 0x65caff, headshot ? 10 : 4, headshot ? 3.5 : 1.5);
  bot.userData.stagger=.22; bot.userData.hitFlash=.18;
  if(headshot) {
    const headMesh=bot.children.find(o=>o.isMesh && o.userData.part==='head' && o.geometry && o.geometry.type==='SphereGeometry' && Math.abs(o.geometry.parameters.radius-.17)<.001);
    if(headMesh && flyingParts.length < MAX_FLYING_PARTS) {
      const detached=headMesh.clone();
      detached.geometry = headMesh.geometry.clone();
      detached.material=Array.isArray(headMesh.material) ? headMesh.material.map(m=>m.clone()) : headMesh.material.clone();
      headMesh.getWorldPosition(detached.position); headMesh.getWorldQuaternion(detached.quaternion); detached.scale.copy(headMesh.getWorldScale(new THREE.Vector3()));
      detached.castShadow = false; detached.receiveShadow = false;
      scene.add(detached); flyingParts.push({mesh:detached,vel:new THREE.Vector3((Math.random()-.5)*1.5,3.2+Math.random()*1.5,-.7),spin:new THREE.Vector3(4,6,2),life:1.25});
    }
    bot.children.forEach(o=>{ if(o.isMesh && o.userData.part==='head') o.visible=false; });
    burstFX(point,0xb44cff,12,3.8); removeBot(bot); return;
  }
  detachPart(hit.object,bot,point);
  bot.userData.health--;
  if(bot.userData.health<=0) {
    burstFX(bot.position.clone().add(new THREE.Vector3(0,1,0)),0xb44cff,8,2.8);
    removeBot(bot);
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
  bots.forEach(b=>{const u=b.userData;if(u.stagger>0){u.stagger=Math.max(0,u.stagger-dt);b.rotation.z=Math.sin(u.stagger*38)*.10*(u.stagger/.22);}else b.rotation.z*=.75;});
}
function nearCrate(x, z, r) { return false; }

// ---------- state ----------
let state = 'idle', mode = 'range', weapon = 'vandal', level = LEVELS.medium;
let score = 0, shots = 0, hits = 0, heads = 0, wave = 0;
let eyeY = 1.6, jumpY = 0, vy = 0, slashT = 0, startTime = 0, pauseAt = 0, lastSpawn = 0, lastShot = 0, lastFire = 0;
let yaw = 0, pitch = 0, recP = 0, recY = 0, spray = 0, firing = false, startZ = 0;
let aiming = false, aimFov = 80, swapPhase = 0, swapTarget = 0, swapKey = null;
const keys = {};
const ray = new THREE.Raycaster();
let audio;
// Layered FPS rifle report: sharp powder crack, deep thump and short metallic room tail.
function playGunshot() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    const t = audio.currentTime;
    const master = audio.createGain(); master.gain.setValueAtTime(0.85,t); master.gain.exponentialRampToValueAtTime(.001,t+.72); master.connect(audio.destination);
    const noiseBuffer = audio.createBuffer(1, Math.floor(audio.sampleRate*.24), audio.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for(let i=0;i<data.length;i++) data[i]=(Math.random()*2-1)*Math.pow(1-i/data.length,2.4);
    const crack = audio.createBufferSource(); crack.buffer=noiseBuffer;
    const hp = audio.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=900;
    const crackGain=audio.createGain(); crackGain.gain.setValueAtTime(.72,t); crackGain.gain.exponentialRampToValueAtTime(.001,t+.13);
    crack.connect(hp); hp.connect(crackGain); crackGain.connect(master); crack.start(t);
    const thud=audio.createOscillator(), low=audio.createBiquadFilter(), thudGain=audio.createGain();
    thud.type='sine'; thud.frequency.setValueAtTime(105,t); thud.frequency.exponentialRampToValueAtTime(42,t+.19);
    low.type='lowpass'; low.frequency.value=180;
    thudGain.gain.setValueAtTime(.85,t); thudGain.gain.exponentialRampToValueAtTime(.001,t+.24);
    thud.connect(low); low.connect(thudGain); thudGain.connect(master); thud.start(t); thud.stop(t+.25);
    const tail=audio.createOscillator(), tailGain=audio.createGain(), band=audio.createBiquadFilter();
    tail.type='triangle'; tail.frequency.setValueAtTime(620,t+.025); tail.frequency.exponentialRampToValueAtTime(190,t+.48);
    band.type='bandpass'; band.frequency.value=520; band.Q.value=.7;
    tailGain.gain.setValueAtTime(.16,t+.025); tailGain.gain.exponentialRampToValueAtTime(.001,t+.5);
    tail.connect(band); band.connect(tailGain); tailGain.connect(master); tail.start(t+.025); tail.stop(t+.52);
  } catch (e) {}
}

function toast(t, ms) { $('toast').textContent = t; setTimeout(() => { if ($('toast').textContent === t) $('toast').textContent = ''; }, ms || 500); }
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
  timer.textContent = seconds;
  timer.classList.add('visible');
  timer.classList.toggle('urgent', seconds <= 5);
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
function setWeapon(k) {
  if(!WEAPONS[k]) return;
  if(weapon===k && gun.children.length) return;
  setAiming(false);
  weapon=k; reloading=false;
  if(k==='vandal'||k==='phantom') $('weapon').value=k;
  $('wep').textContent=WEAPONS[k].name;
  if(!gun.children.length) {
    buildGun(WEAPONS[k]);
    gun.scale.setScalar({vandal:.78,phantom:.78,sheriff:.82,knife:.85}[k]||.78);
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
$('weapon').addEventListener('change', e => setWeapon(e.target.value));

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
  if(!aiming) aimFov=xh.fov;
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
  DURATION = Number($('duration').value) || 30;
  bots.slice().forEach(removeBot);
  applyMode();
  score = shots = hits = heads = wave = 0; ammo.vandal = MAG.vandal; ammo.phantom = MAG.phantom; ammo.sheriff = MAG.sheriff; reloading = false; yaw = pitch = recP = recY = spray = 0;
  camera.position.set(0, 1.6, startZ); eyeY = 1.6; jumpY = 0; vy = 0;
  level = LEVELS[$('difficulty').value];
  try { localStorage.setItem('vtm3d_name', $('name').value); } catch (e) {}
  startTime = performance.now(); lastSpawn = 0; state = 'playing';
  hud(DURATION);
}

// ---------- input ----------
const el = renderer.domElement;
$('play').addEventListener('click', () => {
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
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === el;
  $('overlay').classList.toggle('hidden', locked);
  if (locked && document.activeElement) document.activeElement.blur();
  if (locked) {
    if (state === 'paused') { startTime += performance.now() - pauseAt; state = 'playing'; }
    else startGame();
  } else {
    firing = false;
    for (const k in keys) keys[k] = false;
    if (state === 'playing') {
      state = 'paused'; pauseAt = performance.now();
      $('title').textContent = 'Paused';
      $('info').textContent = 'Paused. Press Esc ulit o i-click ang Resume.';
      $('play').disabled = true; setTimeout(() => { $('play').disabled = false; }, 1300);
      $('play').textContent = 'Resume';
      $('restart').hidden = false;
    }
  }
});
document.addEventListener('mousemove', e => {
  if (document.pointerLockElement !== el) return;
  const k = sens * 0.07 * RAD;
  yaw -= e.movementX * k;
  pitch = Math.max(-1.5, Math.min(1.5, pitch - e.movementY * k));
});
function tryResume() {
  const wait = Math.max(0, 1300 - (performance.now() - pauseAt));
  setTimeout(() => {
    try { const p = el.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) {}
  }, wait);
}
document.addEventListener('pointerlockerror', () => {
  $('info').textContent = 'Hindi pa pwede mag-resume. Maghintay saglit, tapos i-click ang Resume.';
});
document.addEventListener('keyup', e => { if (e.code === 'Space' && document.pointerLockElement === el) e.preventDefault(); });
document.addEventListener('keydown', e => {
  if (e.code === 'Space' && document.pointerLockElement === el) e.preventDefault();
  if (e.code === 'Escape' && !e.repeat && state === 'paused' && document.pointerLockElement !== el) tryResume();
  keys[e.code] = true;
  if (e.code === 'Digit1') setWeapon('vandal');
  if (e.code === 'Digit2') setWeapon('sheriff');
  if (e.code === 'Digit3') setWeapon('knife');
  if (e.code === 'KeyR' && state === 'playing') startReload();
});
document.addEventListener('keyup', e => { keys[e.code] = false; });
function setAiming(on) {
  const canAim = weapon==='vandal' || weapon==='phantom';
  aiming = !!on && canAim && state==='playing';
  aimFov = aiming ? 48 : xh.fov;
  $('adsOverlay').classList.toggle('active',aiming);
  $('crosshair').style.opacity=aiming?'0':'1';
}
document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('mousedown', e => {
  if(e.button===2 && document.pointerLockElement===el){setAiming(true);return;}
  if (e.button !== 0 || document.pointerLockElement !== el) return;
  firing = true;
  const w = WEAPONS[weapon], now = performance.now();
  if (w.auto === false && state === 'playing' && now - lastShot >= w.interval) fire(now);
});
document.addEventListener('mouseup', e => { if (e.button === 0) firing = false; if(e.button===2) setAiming(false); });
document.addEventListener('pointerlockchange',()=>{if(document.pointerLockElement!==el)setAiming(false);});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const crouching = () => keys.ControlLeft || keys.ControlRight || keys.KeyC;
const walking = () => keys.ShiftLeft || keys.ShiftRight;
const MAG = { vandal: 25, phantom: 30, sheriff: 6 };
const ammo = { vandal: 25, phantom: 30, sheriff: 6 };
let reloading = false, reloadLeft = 0;
function startReload() {
  const w = WEAPONS[weapon];
  if (w.melee || reloading || ammo[weapon] >= MAG[weapon]) return;
  reloading = true; reloadLeft = w.reload; beep(250, 0.05); toast('RELOADING', w.reload * 1000);
}
function fire(now) {
  const w = WEAPONS[weapon];
  if (w.melee) {
    lastShot = lastFire = now; shots++; slashT = 0.2; beep(300, 0.05);
    ray.setFromCamera({ x: 0, y: 0 }, camera); ray.far = 3;
    const kh = ray.intersectObjects(bots, true)[0]; ray.far = Infinity;
    if (kh && kh.object.botRef) {
      hits++; score += 100; damageBot(kh.object.botRef,kh,false); beep(400, 0.1); toast('KNIFE +100', 400);
      const h = $('hit'); h.className = 'show'; setTimeout(() => h.className = '', 120);
    }
    return;
  }
  if (reloading) return;
  if (ammo[weapon] <= 0) { startReload(); return; }
  ammo[weapon]--;
  lastShot = lastFire = now; shots++; playGunshot();
  const moving = ((keys.KeyW || keys.KeyA || keys.KeyS || keys.KeyD) && !walking() && !crouching()) || jumpY > 0.02;
  let sp = moving ? 0.9 : (spray > 2 ? Math.min(0.45, (spray - 2) * 0.06) : 0);
  if(aiming) sp*=.38;
  if (crouching() && !moving) sp *= 0.5;
  const t = Math.tan(camera.fov / 2 * RAD);
  const ox = (Math.random() - 0.5) * 2 * sp * RAD / (t * camera.aspect);
  const oy = (Math.random() - 0.5) * 2 * sp * RAD / t;
  ray.setFromCamera({ x: ox, y: oy }, camera);
  const blockers = decorMeshes;
  const hit = ray.intersectObjects(bots.concat(blockers), true)[0];
  if (hit && hit.object.botRef) {
    const head = hit.object.userData.part === 'head';
    hits++; score += head ? 150 : 50; if (head) heads++;
    damageBot(hit.object.botRef,hit,head);
    beep(head ? 900 : 500, 0.08);
    const h = $('hit'); h.className = 'show' + (head ? ' head' : '');
    setTimeout(() => h.className = '', 120);
    if (head) toast('HEADSHOT', 400);
  }
  // recoil
  recP += (spray < 10 ? w.p : w.p * 0.2) * RAD * (aiming?.62:1);
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
  $('restart').hidden = true;
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
    if(swapPhase===1){ gun.position.y += (-.98-gun.position.y)*Math.min(1,dt*16); if(gun.position.y<-.82){ if(swapKey){buildGun(WEAPONS[swapKey]);swapKey=null;gun.scale.setScalar({vandal:.78,phantom:.78,sheriff:.82,knife:.85}[weapon]||.78);gun.userData.baseX=gun.position.x;gun.userData.baseY=gun.position.y;gun.userData.baseZ=gun.position.z;gun.userData.rz=gun.position.z;gun.position.y=-.98;} swapPhase=2; } }
    else { gun.position.y += ((gun.userData.baseY??-.27)-gun.position.y)*Math.min(1,dt*13); if(Math.abs(gun.position.y-(gun.userData.baseY??-.27))<.018) swapPhase=0; }
  }
  gun.position.z += (gun.userData.rz - gun.position.z) * 0.3;
  camera.fov += (aimFov-camera.fov)*Math.min(1,dt*10); camera.updateProjectionMatrix();
  updateCombatFX(dt);
  if (slashT > 0) {
    slashT -= dt; const k = Math.sin((1 - Math.max(0, slashT) / 0.2) * Math.PI);
    gun.rotation.x = -0.9 * k; gun.rotation.z = -0.7 * k;
  } else { gun.rotation.x += ((reloading ? 0.9 : 0) - gun.rotation.x) * 0.2; gun.rotation.z *= 0.7; }

  $('ammo').textContent = WEAPONS[weapon].melee ? '' : (reloading ? 'Reloading' : ammo[weapon] + '/' + MAG[weapon]);
  if (state === 'playing') {
    if (reloading) { reloadLeft -= dt; if (reloadLeft <= 0) { reloading = false; ammo[weapon] = MAG[weapon]; } }
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
    {
      houseBoxes.forEach(h => {
        const p = 0.5;
        if (nx > h[0] - p && nx < h[1] + p && nz > h[2] - p && nz < h[3] + p) {
          const dl = nx - (h[0] - p), dr = (h[1] + p) - nx, dt2 = nz - (h[2] - p), db = (h[3] + p) - nz, m = Math.min(dl, dr, dt2, db);
          if (m === dl) nx = h[0] - p; else if (m === dr) nx = h[1] + p; else if (m === dt2) nz = h[2] - p; else nz = h[3] + p;
        }
      });
    }
    camera.position.x = nx; camera.position.z = nz;
    eyeY += ((crouch ? 1.05 : 1.6) - eyeY) * Math.min(1, dt * 12);
    if (keys.Space && jumpY <= 0.001 && !crouch) vy = 7;
    vy -= 22 * dt; jumpY = Math.max(0, jumpY + vy * dt);
    if (jumpY === 0 && vy < 0) vy = 0;
    camera.position.y = eyeY + jumpY;

    updateRange(now);

    const left = DURATION - (now - startTime) / 1000;
    hud(left);
    if (left <= 0) endGame();
  }
  camera.rotation.y = yaw + recY; camera.rotation.x = Math.max(-1.55, Math.min(1.55, pitch + recP));
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
camera.position.set(0, 1.6, 0);
drawWorldTimer(DURATION);
setWeapon('vandal');
applyMode();
loadBest();
renderLb();
drawXh();
requestAnimationFrame(loop);
