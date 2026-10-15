import * as THREE from 'three';

// Isolated planet experiment: no imports, saves, WebSockets or assets from the main RPG.
const R = 87.0;
const WALK_SPEED = 4.05;
const TAU = Math.PI * 2;
const NAMES = ['Степь Рассвета', 'Шепчущий лес', 'Янтарные пустоши', 'Каменные высоты'];
const LABELS = ['ЛУГА И ПЕРВЫЙ ЛАГЕРЬ', 'ДРЕВНИЕ ДЕРЕВЬЯ', 'ПЕСКИ И УТЁСЫ', 'ГОРЫ И ХОЛОДНЫЕ ВЕТРА'];
const COLORS = [new THREE.Color('#86a969'), new THREE.Color('#4d825d'), new THREE.Color('#bc9a5e'), new THREE.Color('#849088')];
const $ = id => document.getElementById(id);
const viewport = $('viewport');
const progressEl = $('progress');
const distanceEl = $('distance');
const zoneName = $('zoneName');
const zoneLabel = $('zoneLabel');
const loading = $('loading');
const failure = $('failure');
const clamp = THREE.MathUtils.clamp;
const yAxis = new THREE.Vector3(0, 1, 0);
const v = (x, y, z) => new THREE.Vector3(x, y, z);
let seed = 562143;
const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const smooth = (a, b, n) => { const t = clamp((n - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const wrap = x => (x % TAU + TAU) % TAU;
const angleDelta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const unitAt = (lon, lat) => v(Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon));
function sectorIndex(lon) { return Math.floor(wrap(lon + Math.PI / 4) / (Math.PI / 2)) % 4; }
function biomeWeights(lon) {
  const w = [];
  for (let i = 0; i < 4; i++) {
    const d = angleDelta(lon, i * Math.PI / 2);
    w.push(Math.exp(-Math.pow(d / .80, 4)));
  }
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map(x => x / sum);
}
function heightAt(n) {
  const lon = Math.atan2(n.x, n.z);
  const b = biomeWeights(lon);
  const undulations = Math.sin(n.x * 21 + n.z * 7) * Math.cos(n.y * 27 - n.z * 18) * .58
    + Math.sin(n.z * 14 + n.y * 11) * .68;
  const ridge = Math.pow(Math.abs(Math.sin(n.x * 28 + n.z * 13) * Math.cos(n.y * 12 + n.x * 5)), 1.6);
  const mountain = b[3] * (ridge * 8.5 + 1.2 * Math.sin(n.z * 8));
  const dunes = b[2] * (1.5 * Math.cos(n.x * 23 + n.z * 18) + .5);
  const ice = smooth(.78, .94, Math.abs(n.y)) * 2.5;
  return undulations + mountain + dunes + ice;
}
function colorAt(n, h) {
  const weights = biomeWeights(Math.atan2(n.x, n.z));
  const color = new THREE.Color(0x000000);
  for (let i = 0; i < 4; i++) { color.r += COLORS[i].r * weights[i]; color.g += COLORS[i].g * weights[i]; color.b += COLORS[i].b * weights[i]; }
  const grain = Math.sin(n.x * 101 + n.z * 67) * Math.cos(n.y * 91 - n.x * 54) * .055;
  color.offsetHSL(0, 0, grain - Math.max(0, h) * .002);
  const polar = smooth(.78, .98, Math.abs(n.y));
  if (polar > 0) color.lerp(new THREE.Color('#e5e5d6'), polar);
  return color;
}

try {
  const scene = new THREE.Scene();
  const skyDay = new THREE.Color('#97c6d1');
  const skyNight = new THREE.Color('#101c32');
  scene.background = skyDay;
  const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, .1, 900);
  const renderer = new THREE.WebGLRenderer({antialias: true, powerPreference: 'default'});
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.45));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  viewport.appendChild(renderer.domElement);
  const canvas = renderer.domElement;
  scene.add(new THREE.HemisphereLight('#f5e7c3', '#4c7475', 2.25));
  const sun = new THREE.DirectionalLight('#fff0bd', 2.25);
  sun.position.set(130, 225, 155);
  scene.add(sun);
  const fill = new THREE.DirectionalLight('#b6e7f6', .62);
  fill.position.set(-100, -40, -150);
  scene.add(fill);

  // Build a genuine closed triangulated sphere, rather than a flat wrapping map.
  const groundGeo = new THREE.SphereGeometry(R, 180, 112);
  const pos = groundGeo.attributes.position;
  const colorData = new Float32Array(pos.count * 3);
  const n0 = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    n0.fromBufferAttribute(pos, i).normalize();
    const h = heightAt(n0);
    pos.setXYZ(i, n0.x * (R + h), n0.y * (R + h), n0.z * (R + h));
    const c = colorAt(n0, h);
    colorData[i * 3] = c.r; colorData[i * 3 + 1] = c.g; colorData[i * 3 + 2] = c.b;
  }
  groundGeo.setAttribute('color', new THREE.BufferAttribute(colorData, 3));
  groundGeo.computeVertexNormals();
  const ground = new THREE.Mesh(groundGeo, new THREE.MeshStandardMaterial({vertexColors: true, roughness: 1, flatShading: false}));
  scene.add(ground);
  // Atmosphere is intentionally subtle; it only appears in orbital view.
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(R + 12, 60, 36),
    new THREE.MeshBasicMaterial({color: '#bde9eb', side: THREE.BackSide, transparent: true, opacity: .10, depthWrite: false})
  );
  scene.add(atmosphere);
  atmosphere.visible = false;

  const starsGeo = new THREE.BufferGeometry();
  const starPoints = [];
  for (let i = 0; i < 480; i++) {
    const z = random() * 2 - 1;
    const a = random() * TAU;
    const r = Math.sqrt(1 - z * z);
    starPoints.push(Math.cos(a) * r * 650, Math.sin(a) * r * 650, z * 650);
  }
  starsGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPoints, 3));
  const stars = new THREE.Points(starsGeo, new THREE.PointsMaterial({color: '#fff8de', size: 1.9, sizeAttenuation: false, transparent: true, opacity: .8}));
  scene.add(stars);
  stars.visible = false;

  const trunkData = [], foliageData = [], pineData = [], rockData = [], cactusData = [], flowerData = [];
  const chance = p => random() < p;
  for (let i = 0; i < 1020; i++) {
    const lon = random() * TAU;
    const lat = (random() - .5) * 1.48;
    const b = sectorIndex(lon);
    // Keep the starting village clear.
    if (Math.abs(angleDelta(lon, 0)) < .13 && Math.abs(lat) < .12) continue;
    const scale = .7 + random() * .8;
    const p = {lon, lat, scale, spin: random() * TAU, tint: random()};
    if (b === 0 && chance(.23) || b === 1 && chance(.83) || b === 3 && chance(.38)) {
      trunkData.push(p);
      (b === 3 || b === 1 && chance(.65) ? pineData : foliageData).push(p);
    } else if (b === 2 && chance(.42)) cactusData.push(p);
    else if (chance(.52)) rockData.push(p);
    else flowerData.push(p);
  }
  // All foliage uses instancing, keeping draw calls low on iPhone.
  function instances(points, geo, material, centerY, dimensions, tintFn) {
    if (!points.length) return null;
    const mesh = new THREE.InstancedMesh(geo, material, points.length);
    const matrix = new THREE.Object3D();
    const q = new THREE.Quaternion();
    for (let i = 0; i < points.length; i++) {
      const p = points[i], normal = unitAt(p.lon, p.lat);
      const alt = R + heightAt(normal);
      matrix.position.copy(normal).multiplyScalar(alt + centerY * p.scale);
      q.setFromUnitVectors(yAxis, normal);
      matrix.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(yAxis, p.spin));
      matrix.scale.set(dimensions[0] * p.scale, dimensions[1] * p.scale, dimensions[2] * p.scale);
      matrix.updateMatrix();
      mesh.setMatrixAt(i, matrix.matrix);
      if (tintFn) mesh.setColorAt(i, new THREE.Color(tintFn(p)));
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false; // Globe wraps: avoid incorrect culling of an entire instanced forest.
    scene.add(mesh);
    return mesh;
  }
  instances(trunkData, new THREE.CylinderGeometry(.18, .27, 1.55, 6), new THREE.MeshStandardMaterial({color: '#65472e', roughness: 1}), .78, [1, 1, 1]);
  instances(foliageData, new THREE.DodecahedronGeometry(1, 1), new THREE.MeshStandardMaterial({color: '#ffffff', roughness: 1, flatShading: true}), 2.46, [1.55, 1.65, 1.55], p => p.tint > .6 ? '#89a65b' : '#5e934c');
  instances(pineData, new THREE.ConeGeometry(1.1, 3.5, 7), new THREE.MeshStandardMaterial({color: '#ffffff', roughness: 1, flatShading: true}), 2.38, [1, 1, 1], p => p.tint > .5 ? '#3e6f56' : '#57876a');
  instances(rockData, new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({color: '#ffffff', roughness: 1, flatShading: true}), .50, [.7, .48, .8], p => p.tint > .5 ? '#a8a28e' : '#8b8772');
  instances(cactusData, new THREE.CylinderGeometry(.33, .45, 2.5, 7), new THREE.MeshStandardMaterial({color: '#427761', roughness: 1}), 1.25, [1, 1, 1]);
  instances(flowerData, new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({color: '#ffffff', roughness: 1, flatShading: true}), .18, [.34, .32, .34], p => p.tint > .6 ? '#e7ca76' : '#acc485');

  const material = c => new THREE.MeshStandardMaterial({color: c, roughness: 1, flatShading: true});
  const matWood = material('#705039'), matCanvas = material('#c99761'), matRoof = material('#97644b');
  const matFire = new THREE.MeshBasicMaterial({color: '#ffb357'});
  function addShape(parent, geo, mat, x, y, z) {
    const mesh = new THREE.Mesh(geo, mat); mesh.position.set(x, y, z); parent.add(mesh); return mesh;
  }
  function setLocalAnchor(group, lon, lat) {
    const n = unitAt(lon, lat);
    group.position.copy(n).multiplyScalar(R + heightAt(n));
    group.quaternion.setFromUnitVectors(yAxis, n);
    scene.add(group);
    return group;
  }
  // A tiny camp inspired by the role of our existing starting village;
  // its geometry is entirely separate from the real game.
  for (const [lon, lat, size] of [[-.045, .021, 1], [.047, .028, 1.15], [-.02, -.05, .88]]) {
    const hut = setLocalAnchor(new THREE.Group(), lon, lat);
    hut.rotateY(random() * TAU);
    addShape(hut, new THREE.CylinderGeometry(2.0 * size, 2.25 * size, 1.5 * size, 9), matWood, 0, .75 * size, 0);
    addShape(hut, new THREE.ConeGeometry(2.75 * size, 3.55 * size, 9), matCanvas, 0, 2.75 * size, 0);
    addShape(hut, new THREE.BoxGeometry(.9 * size, 1.3 * size, .22), matRoof, 0, .73 * size, 2.08 * size);
  }
  const fire = setLocalAnchor(new THREE.Group(), .004, -.006);
  addShape(fire, new THREE.CylinderGeometry(.92, 1.14, .22, 9), material('#4b4135'), 0, .12, 0);
  const flame = addShape(fire, new THREE.ConeGeometry(.5, 1.6, 7), matFire, 0, .87, 0);
  const fireLight = new THREE.PointLight('#ffa552', 1.35, 18);
  fireLight.position.set(0, 1.7, 0); fire.add(fireLight);
  const standard = setLocalAnchor(new THREE.Group(), -.002, -.025);
  addShape(standard, new THREE.CylinderGeometry(.12, .17, 5.3, 7), matWood, 0, 2.65, 0);
  const banner = addShape(standard, new THREE.PlaneGeometry(2.1, 2.45), material('#b06c48'), 1.1, 3.9, 0);
  banner.material.side = THREE.DoubleSide;
  const torches = [[.045, -.031], [-.047, -.018], [.002, .045]];
  for (const [lon, lat] of torches) {
    const t = setLocalAnchor(new THREE.Group(), lon, lat);
    addShape(t, new THREE.CylinderGeometry(.10, .17, 3.4, 6), matWood, 0, 1.7, 0);
    addShape(t, new THREE.ConeGeometry(.32, .9, 6), matFire, 0, 3.75, 0);
  }

  // Small original playable adventurer with radial gravity.
  const actor = new THREE.Group();
  const torso = addShape(actor, new THREE.CylinderGeometry(.58, .72, 1.45, 9), material('#85654c'), 0, 1.40, 0);
  const cloak = addShape(actor, new THREE.ConeGeometry(.8, 1.65, 7), material('#3f6b67'), 0, .97, .34);
  cloak.rotation.x = -.13;
  addShape(actor, new THREE.SphereGeometry(.48, 12, 9), material('#a98969'), 0, 2.47, -.10);
  const muzzle = addShape(actor, new THREE.SphereGeometry(.31, 10, 8), material('#bc9977'), 0, 2.31, -.48);
  muzzle.scale.set(1.1, .63, 1);
  const hornMat = material('#e1d3ad');
  for (const s of [-1, 1]) {
    const horn = addShape(actor, new THREE.ConeGeometry(.18, .82, 7), hornMat, s * .48, 2.83, -.08);
    horn.rotation.z = s * .78;
    addShape(actor, new THREE.SphereGeometry(.09, 6, 6), material('#281f1c'), s * .18, 2.50, -.50);
  }
  const limbs = [];
  for (const s of [-1, 1]) {
    const legPivot = new THREE.Group(); legPivot.position.set(s * .32, .89, 0); actor.add(legPivot);
    addShape(legPivot, new THREE.CylinderGeometry(.2, .19, .89, 7), material('#4a3931'), 0, -.45, 0);
    const hoof = addShape(legPivot, new THREE.BoxGeometry(.48, .29, .67), material('#282725'), 0, -.89, -.14);
    limbs.push(legPivot);
    const armPivot = new THREE.Group(); armPivot.position.set(s * .72, 1.98, 0); actor.add(armPivot);
    addShape(armPivot, new THREE.CylinderGeometry(.18, .23, .91, 7), material('#967450'), 0, -.45, 0);
    limbs.push(armPivot);
  }
  scene.add(actor);
  const state = {normal: unitAt(0, 0), lonUnwrapped: 0, meters: 0, heading: 0, cameraHeading: 0, cameraPitch: .36, zoom: 13, orbit: false, orbitAngle: .45, legCycle: 0};
  let prevHeading = 0;
  const cameraGoal = new THREE.Vector3();
  const focus = new THREE.Vector3();
  const camForward = new THREE.Vector3();
  const tangentEast = new THREE.Vector3();
  const tangentNorth = new THREE.Vector3();
  const axis = new THREE.Vector3();
  const right = new THREE.Vector3();
  const travel = new THREE.Vector3();
  const orientation = new THREE.Matrix4();
  function tangentBasis(normal) {
    const longitude = Math.atan2(normal.x, normal.z);
    tangentEast.set(Math.cos(longitude), 0, -Math.sin(longitude)).normalize();
    tangentNorth.crossVectors(normal, tangentEast).normalize();
  }
  function updateActor() {
    const normal = state.normal;
    tangentBasis(normal);
    const position = R + heightAt(normal);
    actor.position.copy(normal).multiplyScalar(position + .06);
    const fwd = tangentEast.clone().multiplyScalar(Math.cos(state.heading))
      .addScaledVector(tangentNorth, Math.sin(state.heading)).normalize();
    right.crossVectors(fwd, normal).normalize();
    const back = new THREE.Vector3().crossVectors(right, normal).normalize();
    orientation.makeBasis(right, normal, back);
    actor.quaternion.setFromRotationMatrix(orientation);
  }
  function doReset() {
    state.normal.copy(unitAt(0, 0));
    state.lonUnwrapped = 0; state.meters = 0; state.heading = 0; state.cameraHeading = 0;
    state.cameraPitch = .36; state.legCycle = 0;
    updateActor(); updateHUD(true);
  }
  function updateHUD(force = false) {
    const completed = Math.floor(Math.abs(state.lonUnwrapped) / TAU);
    const percent = Math.floor((Math.abs(state.lonUnwrapped) / TAU - completed) * 100);
    progressEl.textContent = (completed > 0 && percent === 0 ? 100 : percent) + '%';
    distanceEl.textContent = Math.round(state.meters) + ' м · оборотов: ' + completed;
    const b = sectorIndex(Math.atan2(state.normal.x, state.normal.z));
    if (force || zoneName.textContent !== NAMES[b]) {
      zoneName.textContent = NAMES[b];
      zoneLabel.textContent = LABELS[b];
    }
    drawGlobe();
  }

  const joystick = {x: 0, y: 0, pointer: null};
  const base = $('stickBase'), thumb = $('stickThumb');
  function updateStick(e) {
    const rect = base.getBoundingClientRect();
    const dx = e.clientX - rect.left - rect.width / 2;
    const dy = e.clientY - rect.top - rect.height / 2;
    const len = Math.max(1, Math.hypot(dx, dy));
    const cap = rect.width * .32;
    joystick.x = clamp(dx / cap, -1, 1); joystick.y = clamp(dy / cap, -1, 1);
    if (len > cap) {joystick.x = dx / len; joystick.y = dy / len;}
    thumb.style.transform = 'translate(' + (joystick.x * cap) + 'px,' + (joystick.y * cap) + 'px)';
  }
  function releaseStick() {
    joystick.pointer = null; joystick.x = joystick.y = 0;
    thumb.style.transform = 'translate(0,0)';
  }
  base.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (joystick.pointer !== null) return;
    joystick.pointer = e.pointerId; base.setPointerCapture(e.pointerId); updateStick(e);
  });
  base.addEventListener('pointermove', e => {if (joystick.pointer === e.pointerId) {e.preventDefault(); updateStick(e);}});
  base.addEventListener('pointerup', e => {if (joystick.pointer === e.pointerId) releaseStick();});
  base.addEventListener('pointercancel', e => {if (joystick.pointer === e.pointerId) releaseStick();});
  base.addEventListener('lostpointercapture', e => {if (joystick.pointer === e.pointerId) releaseStick();});

  const keys = new Set();
  window.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    if (['arrowup','arrowdown','arrowleft','arrowright','w','a','s','d'].includes(k)) {e.preventDefault(); keys.add(k);}
  });
  window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => {keys.clear(); releaseStick();});

  const touches = new Map();
  let lastPinch = 0;
  canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    touches.set(e.pointerId, {x:e.clientX,y:e.clientY});
    lastPinch = 0;
  });
  canvas.addEventListener('pointermove', e => {
    if (!touches.has(e.pointerId)) return;
    e.preventDefault();
    const last = touches.get(e.pointerId);
    if (touches.size === 1 && !state.orbit) {
      state.cameraHeading -= (e.clientX - last.x) * .007;
      state.cameraPitch = clamp(state.cameraPitch + (e.clientY - last.y) * .005, -.15, 1.22);
    }
    touches.set(e.pointerId, {x:e.clientX,y:e.clientY});
    if (touches.size === 2 && !state.orbit) {
      const p = [...touches.values()];
      const d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      if (lastPinch) state.zoom = clamp(state.zoom * lastPinch / Math.max(d, 2), 6, 32);
      lastPinch = d;
      updateZoomLabel();
    }
  });
  function untrack(e) { touches.delete(e.pointerId); lastPinch = 0; }
  canvas.addEventListener('pointerup', untrack);
  canvas.addEventListener('pointercancel', untrack);
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    if (!state.orbit) {state.zoom = clamp(state.zoom + e.deltaY * .015, 6, 32); updateZoomLabel();}
  }, {passive:false});
  const orbitButton = $('orbitButton');
  orbitButton.addEventListener('click', () => {
    state.orbit = !state.orbit;
    orbitButton.setAttribute('aria-pressed', String(state.orbit));
    orbitButton.textContent = state.orbit ? '⤺ К персонажу' : '🌍 Вся планета';
    stars.visible = state.orbit;
    atmosphere.visible = state.orbit;
    scene.background = state.orbit ? skyNight : skyDay;
    cameraSnap = true;
  });
  const zoomButton = $('zoomButton');
  function updateZoomLabel() {zoomButton.textContent = '🔭 Камера: ' + (state.zoom > 19 ? 'далеко' : 'близко');}
  zoomButton.addEventListener('click', () => {
    state.zoom = state.zoom > 19 ? 13 : 27;
    updateZoomLabel();
  });
  $('resetButton').addEventListener('click', () => {doReset(); cameraSnap = true;});

  const globeCanvas = $('miniglobe');
  const gctx = globeCanvas.getContext('2d');
  function drawGlobe() {
    if (!gctx) return;
    const c = gctx, s = globeCanvas.width, center = s/2, radius = 87;
    c.clearRect(0,0,s,s);
    c.save(); c.translate(center,center);
    c.fillStyle='rgba(15,40,44,.72)'; c.beginPath();c.arc(0,0,107,0,TAU);c.fill();
    const arcColors = ['#86ae79','#367b60','#d1ac6b','#8493a0'];
    for (let i=0;i<4;i++) {
      c.beginPath();c.moveTo(0,0);
      c.arc(0,0,radius,i*Math.PI/2-Math.PI/4,i*Math.PI/2+Math.PI/4);
      c.closePath();c.fillStyle=arcColors[i];c.fill();
    }
    c.strokeStyle='#f6e7b6';c.lineWidth=2;c.beginPath();c.arc(0,0,radius,0,TAU);c.stroke();
    c.strokeStyle='rgba(255,255,255,.25)';c.lineWidth=1;
    c.beginPath();c.ellipse(0,0,80,28,0,0,TAU);c.stroke();
    const lon = Math.atan2(state.normal.x,state.normal.z);
    const x = radius*.84*Math.cos(lon), y = radius*.84*Math.sin(lon);
    c.fillStyle='#fff7e7';c.strokeStyle='#29413f';c.lineWidth=4;
    c.beginPath();c.arc(x,y,8,0,TAU);c.fill();c.stroke();
    c.fillStyle='#fae4a3';c.font='bold 15px system-ui';c.textAlign='center';
    c.fillText('N',0,-92);
    c.restore();
  }

  let cameraSnap = true;
  const clock = new THREE.Clock();
  let elapsed = 0, uiClock = 0, introClock = 0;
  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), .05);
    elapsed += dt; uiClock += dt; introClock += dt;
    if (introClock > 7) $('instruction').style.opacity = '0';

    let horizontal = joystick.x + Number(keys.has('d') || keys.has('arrowright')) - Number(keys.has('a') || keys.has('arrowleft'));
    let forward = -joystick.y + Number(keys.has('w') || keys.has('arrowup')) - Number(keys.has('s') || keys.has('arrowdown'));
    let power = clamp(Math.hypot(horizontal,forward), 0, 1);
    if (power < .11 || state.orbit) power = 0;
    if (power > 0) {
      const inputLength = Math.hypot(horizontal, forward);
      horizontal /= inputLength;
      forward /= inputLength;
      tangentBasis(state.normal);
      camForward.copy(tangentEast).multiplyScalar(Math.cos(state.cameraHeading)).addScaledVector(tangentNorth, Math.sin(state.cameraHeading));
      right.crossVectors(camForward,state.normal).normalize();
      travel.copy(camForward).multiplyScalar(forward).addScaledVector(right,horizontal).normalize();
      const newHeading = Math.atan2(travel.dot(tangentNorth),travel.dot(tangentEast));
      const turn = angleDelta(newHeading,state.heading);
      state.heading += turn * Math.min(1, dt * 11);
      prevHeading = newHeading;
      axis.crossVectors(state.normal,travel).normalize();
      const step = WALK_SPEED * dt * power;
      const oldLon = Math.atan2(state.normal.x,state.normal.z);
      state.normal.applyAxisAngle(axis, step/R).normalize();
      const newLon = Math.atan2(state.normal.x,state.normal.z);
      state.lonUnwrapped += angleDelta(newLon,oldLon);
      state.meters += step;
      state.legCycle += dt * power * 9.1;
    } else {
      state.legCycle += dt * 1.1;
    }
    updateActor();
    limbs[0].rotation.x = Math.sin(state.legCycle) * power * .48;
    limbs[2].rotation.x = -Math.sin(state.legCycle) * power * .48;
    limbs[1].rotation.x = -Math.sin(state.legCycle) * power * .30;
    limbs[3].rotation.x = Math.sin(state.legCycle) * power * .30;
    flame.scale.y = 1 + .10*Math.sin(elapsed*9);
    banner.rotation.y = Math.sin(elapsed*.9)*.13;

    if (state.orbit) {
      state.orbitAngle += dt * .10;
      const r = R * 3.22;
      cameraGoal.set(Math.sin(state.orbitAngle)*r, r*.34, Math.cos(state.orbitAngle)*r);
      camera.up.set(0,1,0);
      focus.set(0,0,0);
    } else {
      tangentBasis(state.normal);
      camForward.copy(tangentEast).multiplyScalar(Math.cos(state.cameraHeading)).addScaledVector(tangentNorth,Math.sin(state.cameraHeading));
      const h = R + heightAt(state.normal);
      focus.copy(state.normal).multiplyScalar(h+2.3);
      cameraGoal.copy(focus).addScaledVector(camForward,-state.zoom*Math.cos(state.cameraPitch));
      cameraGoal.addScaledVector(state.normal,state.zoom*Math.sin(state.cameraPitch)+1.1);
      const minRadius = R + heightAt(cameraGoal.clone().normalize()) + 1.0;
      if (cameraGoal.length() < minRadius) cameraGoal.normalize().multiplyScalar(minRadius);
      camera.up.copy(state.normal);
    }
    if (cameraSnap) {camera.position.copy(cameraGoal);cameraSnap=false;}
    else camera.position.lerp(cameraGoal,1-Math.exp(-dt * 8.5));
    camera.lookAt(focus);
    renderer.render(scene,camera);
    if (uiClock > .12) {uiClock = 0;updateHUD();}
  }
  function resize() {
    const w = innerWidth,h = innerHeight;
    renderer.setSize(w,h,false);
    camera.aspect = w/h;camera.updateProjectionMatrix();
  }
  addEventListener('resize',resize);
  document.addEventListener('visibilitychange',()=>{clock.getDelta();});
  updateActor();
  updateHUD(true);
  animate();
  loading.classList.add('is-done');
} catch (error) {
  loading.classList.add('is-done');
  failure.textContent = 'Не удалось запустить прототип: ' + (error && error.message || String(error));
  console.error(error);
}
