(() => {
  'use strict';
  // Doors — кооперативный хоррор по мотивам Roblox DOORS. Комнаты строятся по seed от сервера,
  // поэтому у всех игроков одинаковые комнаты; сущности (Rush, Ambush) приходят событиями с сервера.
  const RW = 10, RD = 16, RH = 4; // ширина, глубина (совпадает с сервером), высота комнаты
  const THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
  const root = document.getElementById('doorsTab');
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const pad4 = (n) => String(n).padStart(4, '0');
  const rnd = (a, b) => a + Math.random() * (b - a);

  // ---------- чистая логика (без графики) ----------
  function mulberry(a) {
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function genRoom(seed, i, goal) {
    const r = mulberry(Math.imul(seed ^ 0x9e3779b9, 2654435761) ^ Math.imul(i + 1, 0x85ebca6b));
    r(); r(); r(); // прогрев генератора
    const room = { i, locked: i >= 2 && i < goal && r() < 0.3, dark: i >= 4 && r() < 0.35, furn: [], coins: [] };
    // 10 мест вдоль стен; перемешиваем и раздаём шкафы и ящики
    const slots = [];
    for (const side of [-1, 1]) for (const dz of [2.6, 5.2, 7.8, 10.4, 13]) slots.push({ side, dz });
    for (let k = slots.length - 1; k > 0; k--) {
      const j = Math.floor(r() * (k + 1));
      [slots[k], slots[j]] = [slots[j], slots[k]];
    }
    const closets = i === 0 ? 1 : 1 + (r() < 0.5 ? 1 : 0);
    const drawers = i === 0 ? 1 : 2 + Math.floor(r() * 2);
    for (let k = 0; k < closets; k++) room.furn.push({ type: 'closet', ...slots[k] });
    for (let k = 0; k < drawers; k++) {
      room.furn.push({ type: 'drawer', ...slots[closets + k], gold: r() < 0.6 ? 1 + Math.floor(r() * 12) : 0, key: false });
    }
    if (room.locked) {
      const ds = room.furn.filter((f) => f.type === 'drawer');
      ds[Math.floor(r() * ds.length)].key = true; // ключ всегда лежит в одном из ящиков этой комнаты
    }
    const nCoins = Math.floor(r() * 4);
    for (let k = 0; k < nCoins; k++) room.coins.push({ x: (r() - 0.5) * (RW - 3), dz: 2 + r() * (RD - 4), v: 1 + Math.floor(r() * 4) });
    return room;
  }

  // положение сущности в момент t (мс по часам сервера)
  function evState(ev, t) {
    if (t < ev.t0) return { phase: 'warn' };
    const L = Math.abs(ev.z1 - ev.z0);
    const dur = (L / ev.speed) * 1000;
    const gap = 1200;
    const el = t - ev.t0;
    const k = Math.floor(el / (dur + gap));
    if (k >= ev.passes) return { phase: 'done' };
    const within = el - k * (dur + gap);
    if (within > dur) return { phase: 'gap', pass: k };
    const f = within / dur;
    const z = k % 2 === 0 ? ev.z0 + (ev.z1 - ev.z0) * f : ev.z1 + (ev.z0 - ev.z1) * f;
    return { phase: 'run', z, pass: k };
  }

  // ---------- стили и разметка ----------
  const style = document.createElement('style');
  style.textContent = `
    .dr-land { max-width: 640px; margin: 0 auto; padding: 24px 18px; }
    .dr-land h2 { font-size: 40px; letter-spacing: 8px; margin: 0 0 6px; font-weight: 700; }
    .dr-land p, .dr-land li { color: var(--muted); font-size: 14px; line-height: 1.55; }
    .dr-land ul { padding-left: 18px; }
    .dr-land b { color: var(--text); }
    #drStage { position: fixed; inset: 0; z-index: 70; background: #000; user-select: none; -webkit-user-select: none; }
    #drView, #drView canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; }
    #drHide { position: absolute; inset: 0; pointer-events: none; background: repeating-linear-gradient(90deg, #000 0 16px, rgba(0,0,0,.55) 16px 26px); }
    #drFlash { position: absolute; inset: 0; pointer-events: none; background: #a00; opacity: 0; }
    #drHud { position: absolute; inset: 0; pointer-events: none; font-family: var(--mono); color: #e8d9a8; text-shadow: 0 0 6px #000; }
    .dr-top { position: absolute; top: 12px; left: 0; right: 0; display: flex; justify-content: center; gap: 18px; font-size: 15px; }
    #drHp { position: absolute; left: 16px; bottom: 16px; width: 150px; height: 8px; background: #222; border-radius: 4px; overflow: hidden; }
    #drHpBar { display: block; height: 100%; width: 100%; background: #c44; }
    #drMsg { position: absolute; left: 0; right: 0; bottom: 70px; text-align: center; font-size: 15px; min-height: 20px; }
    #drPrompt { position: absolute; left: 0; right: 0; top: 56%; text-align: center; font-size: 16px; }
    #drExit { position: absolute; top: 10px; left: 10px; z-index: 3; opacity: .8; }
    #drScreech { position: absolute; width: 90px; height: 90px; border-radius: 50%; background: radial-gradient(circle at 35% 40%, #fff 0 8px, transparent 9px), radial-gradient(circle at 65% 40%, #fff 0 8px, transparent 9px), #050505; box-shadow: 0 0 24px #000; pointer-events: none; }
    #drOver { position: absolute; inset: 0; z-index: 4; display: grid; place-items: center; background: rgba(0,0,0,.78); text-align: center; padding: 20px; }
    #drOver h2 { margin: 0 0 8px; font-size: 30px; letter-spacing: 3px; }
    #drOver p { color: var(--muted); margin: 4px 0; }
    #drTouch { display: none; }
    #drTouch button { position: absolute; z-index: 3; width: 58px; height: 58px; border-radius: 50%; font-size: 18px; opacity: .75; }
    @media (pointer: coarse) { #drTouch { display: block; } }
  `;
  document.head.appendChild(style);

  root.innerHTML = `
    <div class="dr-land">
      <h2>DOORS</h2>
      <p>Кооперативный хоррор по мотивам Roblox DOORS. Все посетители сайта играют в одном забеге: проходите комнату за комнатой,
      открывайте двери и выживайте. Дверь открывается для всех сразу.</p>
      <ul>
        <li><b>Rush</b> — свет мигает, слышен нарастающий гул. Спрячься в шкафу до того, как он пролетит.</li>
        <li><b>Ambush</b> — быстрее Rush и проносится по комнатам несколько раз туда-обратно. Выходи из шкафа, только когда стихнет.</li>
        <li><b>Screech</b> — шепчет «пссст». Успей посмотреть на него, иначе укусит.</li>
        <li>Запертая дверь требует <b>ключ</b> — он лежит в одном из ящиков комнаты. С комнаты №5 бывают тёмные комнаты — включай фонарик.</li>
        <li>Пока кто-то жив, забег продолжается; погибшие наблюдают за живыми. Когда погибли все — новый забег.</li>
      </ul>
      <p><b>Управление:</b> WASD — ходить, Shift — бежать, мышь — смотреть (клик по экрану захватывает мышь), E — действие, F — фонарик, Esc — отпустить мышь.
      На телефоне: левая половина экрана — джойстик, правая — обзор, кнопки справа.</p>
      <p id="drCountLand" class="muted">Загляни в забег…</p>
      <button class="run" id="drPlay">Играть</button>
    </div>
    <div id="drStage" hidden>
      <div id="drView"></div>
      <div id="drHide" hidden></div>
      <div id="drFlash"></div>
      <div id="drHud">
        <div class="dr-top"><span id="drRoom"></span><span id="drGold"></span><span id="drKey" hidden>🔑 ключ</span><span id="drCount"></span></div>
        <div id="drHp"><i id="drHpBar"></i></div>
        <div id="drMsg"></div>
        <div id="drPrompt"></div>
      </div>
      <button id="drExit">← Выйти</button>
      <div id="drScreech" hidden></div>
      <div id="drOver" hidden></div>
      <div id="drTouch">
        <button id="drBtnE" style="right:18px;bottom:110px">E</button>
        <button id="drBtnF" style="right:88px;bottom:60px">🔦</button>
        <button id="drBtnR" style="right:18px;bottom:30px">⇧</button>
      </div>
    </div>`;

  // ---------- состояние ----------
  const S = {
    on: false, ready: false, seed: 1, front: 0, goal: 100, skew: 0, over: false,
    rooms: new Map(), peers: new Map(), broken: new Set(),
    alive: true, hp: 100, gold: 0, hasKey: false, killedBy: '',
    x: 0, z: -3, yaw: 0, pitch: 0, vx: 0, vz: 0, bob: 0, run: false,
    hidden: null, flash: false, ev: null, evSnd: null, screech: null, nextScreech: 0,
    pending: false, lastSend: 0, lastHud: 0, count: 0, msgUntil: 0, deadY: 0,
  };
  const keys = new Set();
  const touch = { x: 0, y: 0 };
  const pointers = new Map();
  const serverNow = () => Date.now() + S.skew;

  let T = null; // THREE
  let renderer, scene, camera, spot, ambient, viewEl, rafId = 0;
  const M = {}; // материалы
  let AC = null, drone = null, noiseBuffer = null;

  // ---------- звук (Web Audio, без файлов) ----------
  function audioInit() {
    if (!AC) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return;
      AC = new C();
    }
    if (AC.state === 'suspended') AC.resume();
    if (!drone) {
      const g = AC.createGain(); g.gain.value = 0.05;
      const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 180;
      const o1 = AC.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 55;
      const o2 = AC.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 55.7;
      o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(AC.destination);
      o1.start(); o2.start();
      drone = { g, stop() { try { o1.stop(); o2.stop(); } catch { /* уже остановлено */ } g.disconnect(); } };
    }
  }
  function audioStop() { if (drone) { drone.stop(); drone = null; } if (S.evSnd) { S.evSnd.stop(); S.evSnd = null; } }
  function noise() {
    if (!noiseBuffer) {
      noiseBuffer = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate);
      const d = noiseBuffer.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return noiseBuffer;
  }
  function tone(f0, f1, dur, type, vol) {
    if (!AC) return;
    const o = AC.createOscillator(), g = AC.createGain(), t = AC.currentTime;
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(AC.destination); o.start(t); o.stop(t + dur);
  }
  function burst(dur, freq, vol, type) {
    if (!AC) return;
    const s = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain(), t = AC.currentTime;
    s.buffer = noise(); f.type = type || 'bandpass'; f.frequency.value = freq;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(AC.destination); s.start(t); s.stop(t + dur);
  }
  const sfx = {
    door() { tone(90, 40, 0.5, 'sine', 0.5); burst(0.5, 300, 0.25); },
    coin() { tone(1200, 1300, 0.12, 'sine', 0.15); setTimeout(() => tone(1800, 1900, 0.18, 'sine', 0.12), 70); },
    drawer() { burst(0.25, 700, 0.18); },
    hide() { tone(120, 80, 0.2, 'sine', 0.3); },
    psst() { burst(0.5, 4500, 0.35, 'highpass'); },
    screech() { tone(900, 2600, 0.45, 'sawtooth', 0.25); },
    hit() { tone(70, 30, 0.35, 'sine', 0.6); },
    key() { tone(1500, 1000, 0.15, 'triangle', 0.2); },
  };
  function entSound(type) {
    if (!AC) return null;
    const src = AC.createBufferSource(); src.buffer = noise(); src.loop = true;
    const bp = AC.createBiquadFilter(); bp.type = type === 'rush' ? 'bandpass' : 'highpass'; bp.frequency.value = 400; bp.Q.value = 0.8;
    const osc = AC.createOscillator(); osc.type = type === 'rush' ? 'sawtooth' : 'square'; osc.frequency.value = type === 'rush' ? 80 : 190;
    const g = AC.createGain(); g.gain.value = 0;
    src.connect(bp); bp.connect(g); osc.connect(g); g.connect(AC.destination); src.start(); osc.start();
    return {
      set(v, f) { g.gain.setTargetAtTime(v * 0.55, AC.currentTime, 0.05); bp.frequency.setTargetAtTime(f, AC.currentTime, 0.1); },
      stop() { try { src.stop(); osc.stop(); } catch { /* уже остановлено */ } g.disconnect(); },
    };
  }

  // ---------- графика ----------
  function loadThree() {
    if (window.THREE) return Promise.resolve();
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = THREE_URL; s.onload = res; s.onerror = () => rej(new Error('three.js не загрузился'));
      document.head.appendChild(s);
    });
  }

  function canvasTex(w, h, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new T.CanvasTexture(c);
    return t;
  }

  function faceTex(kind) {
    return canvasTex(256, 256, (g, w, h) => {
      const grd = g.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w / 2);
      if (kind === 'rush') { grd.addColorStop(0, '#222'); grd.addColorStop(0.7, '#0a0a0a'); grd.addColorStop(1, 'rgba(0,0,0,0)'); }
      else if (kind === 'ambush') { grd.addColorStop(0, '#2f6b47'); grd.addColorStop(0.7, '#10261a'); grd.addColorStop(1, 'rgba(0,0,0,0)'); }
      else { grd.addColorStop(0, '#111'); grd.addColorStop(1, 'rgba(0,0,0,0)'); }
      g.fillStyle = grd; g.beginPath(); g.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#fff';
      g.beginPath(); g.ellipse(88, 100, 22, 30, 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.ellipse(168, 100, 22, 30, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#000';
      g.beginPath(); g.arc(92, 106, 7, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(164, 106, 7, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#fff';
      if (kind === 'ambush') { g.beginPath(); g.ellipse(128, 176, 40, 34, 0, 0, Math.PI * 2); g.fill(); g.fillStyle = '#000'; g.beginPath(); g.ellipse(128, 178, 30, 26, 0, 0, Math.PI * 2); g.fill(); }
      else { g.beginPath(); g.moveTo(60, 160); g.quadraticCurveTo(128, 240, 196, 160); g.quadraticCurveTo(128, 200, 60, 160); g.fill(); }
    });
  }

  function textTex(text, w, h, font, bg, fg) {
    return canvasTex(w, h, (g) => {
      if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
      g.fillStyle = fg; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(text, w / 2, h / 2);
    });
  }

  function initGL() {
    if (renderer) return;
    viewEl = $('drView');
    renderer = new T.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    viewEl.appendChild(renderer.domElement);
    scene = new T.Scene();
    scene.background = new T.Color(0x000000);
    scene.fog = new T.Fog(0x000000, 4, 30);
    camera = new T.PerspectiveCamera(75, 1, 0.05, 90);
    camera.rotation.order = 'YXZ';
    scene.add(camera);
    ambient = new T.AmbientLight(0xffffff, 0.2);
    scene.add(ambient);
    spot = new T.SpotLight(0xfff1c9, 0, 28, 0.5, 0.45, 1.2);
    const tgt = new T.Object3D(); tgt.position.set(0, 0, -5);
    camera.add(spot); camera.add(tgt); spot.target = tgt;
    const L = (c) => new T.MeshLambertMaterial({ color: c });
    Object.assign(M, {
      wall: L(0x5a4632), floor: L(0x3b1616), ceil: L(0x2a2118), door: L(0x7a5230), frame: L(0x24160a),
      closet: L(0x4e3320), panel: L(0x3a2616), drawer: L(0x6b4a28), drawerOpen: L(0x2a1d10), lamp: new T.MeshBasicMaterial({ color: 0xffe2a8 }),
      lampOff: new T.MeshBasicMaterial({ color: 0x2a2418 }), coin: new T.MeshBasicMaterial({ color: 0xffd45a }),
    });
    resize();
  }

  function resize() {
    if (!renderer) return;
    const w = viewEl.clientWidth || window.innerWidth, h = viewEl.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);

  function box(parent, w, h, d, x, y, z, mat) {
    const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }
  const aabb = (x, z, w, d) => ({ minx: x - w / 2, maxx: x + w / 2, minz: z - d / 2, maxz: z + d / 2, on: true });

  // ---------- комнаты ----------
  function buildRoom(i) {
    if (S.rooms.has(i)) return;
    const R = genRoom(S.seed, i, S.goal);
    const g = new T.Group();
    R.group = g; R.colliders = []; R.inter = []; R.coinMeshes = [];
    const z0 = -i * RD, z1 = -(i + 1) * RD, zc = (z0 + z1) / 2;
    R.z0 = z0; R.z1 = z1;
    box(g, RW, 0.2, RD, 0, -0.1, zc, M.floor);
    box(g, RW, 0.2, RD, 0, RH + 0.1, zc, M.ceil);
    for (const s of [-1, 1]) {
      box(g, 0.3, RH, RD, s * (RW / 2 + 0.15), RH / 2, zc, M.wall);
      R.colliders.push({ minx: s < 0 ? -RW / 2 - 0.3 : RW / 2, maxx: s < 0 ? -RW / 2 : RW / 2 + 0.3, minz: z1, maxz: z0, on: true });
    }
    if (i === 0) {
      box(g, RW, RH, 0.3, 0, RH / 2, z0 + 0.15, M.wall);
      R.colliders.push({ minx: -RW / 2, maxx: RW / 2, minz: z0, maxz: z0 + 0.3, on: true });
    }
    // торцевая стена с проёмом под дверь
    const gap = 2.4, side = (RW - gap) / 2;
    for (const s of [-1, 1]) {
      const cx = s * (gap / 2 + side / 2);
      box(g, side, RH, 0.3, cx, RH / 2, z1, M.wall);
      R.colliders.push({ minx: cx - side / 2, maxx: cx + side / 2, minz: z1 - 0.15, maxz: z1 + 0.15, on: true });
    }
    box(g, gap, RH - 3, 0.3, 0, 3 + (RH - 3) / 2, z1, M.wall);
    box(g, 0.15, 3, 0.35, -gap / 2 + 0.07, 1.5, z1, M.frame);
    box(g, 0.15, 3, 0.35, gap / 2 - 0.07, 1.5, z1, M.frame);
    // дверь на петлях слева
    const hinge = new T.Group();
    hinge.position.set(-1.1, 0, z1);
    box(hinge, 2.2, 3, 0.15, 1.1, 1.5, 0, M.door);
    const label = new T.Mesh(new T.PlaneGeometry(0.95, 0.5), new T.MeshBasicMaterial({ map: textTex(pad4(i + 1), 256, 128, 'bold 78px serif', '#24160a', '#e8d9a8') }));
    label.position.set(1.1, 2.45, 0.09); label.userData.own = true;
    hinge.add(label);
    g.add(hinge);
    R.hinge = hinge;
    R.doorCol = { minx: -1.1, maxx: 1.1, minz: z1 - 0.1, maxz: z1 + 0.1, on: i >= S.front };
    R.colliders.push(R.doorCol);
    hinge.rotation.y = i < S.front ? 1.5 : 0;
    R.doorAngle = hinge.rotation.y;
    R.inter.push({ type: 'door', x: 0, z: z1, reach: 2.8, R });

    // мебель
    R.furn.forEach((f, idx) => {
      const wx = f.side * (RW / 2 - (f.type === 'closet' ? 0.55 : 0.35));
      const wz = z0 - f.dz;
      if (f.type === 'closet') {
        box(g, 1.1, 2.6, 1.6, wx, 1.3, wz, M.closet);
        box(g, 0.05, 2.4, 1.4, wx - f.side * 0.56, 1.3, wz, M.panel);
        R.colliders.push(aabb(wx, wz, 1.1, 1.6));
        R.inter.push({ type: 'closet', x: wx, z: wz, reach: 2.1, R, f, ex: wx - f.side * 1.3, ez: wz, face: -f.side });
      } else {
        const m = box(g, 0.7, 1.0, 1.4, wx, 0.5, wz, M.drawer);
        box(g, 0.05, 0.1, 0.4, wx - f.side * 0.36, 0.7, wz, M.frame);
        R.colliders.push(aabb(wx, wz, 0.7, 1.4));
        R.inter.push({ type: 'drawer', x: wx, z: wz, reach: 2.0, R, f, mesh: m, done: false });
      }
    });
    // монеты
    R.coins.forEach((c) => {
      const m = new T.Mesh(new T.CylinderGeometry(0.16, 0.16, 0.04, 14), M.coin);
      m.rotation.x = Math.PI / 2; m.position.set(c.x, 0.5, z0 - c.dz);
      g.add(m); c.mesh = m; c.taken = false; c.wz = z0 - c.dz;
    });
    // свет
    const lit = !R.dark;
    box(g, 0.5, 0.12, 0.5, 0, RH - 0.06, zc, lit ? M.lamp : M.lampOff);
    R.base = lit ? 0.95 : 0;
    R.lamp = new T.PointLight(0xffd9a0, R.base, 20, 1.6);
    R.lamp.position.set(0, RH - 0.4, zc);
    g.add(R.lamp);
    R.broken = S.broken.has(i);
    scene.add(g);
    S.rooms.set(i, R);
  }

  function unbuildRoom(i) {
    const R = S.rooms.get(i);
    if (!R) return;
    scene.remove(R.group);
    R.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.userData.own) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
    });
    S.rooms.delete(i);
  }

  function clearRooms() { for (const i of [...S.rooms.keys()]) unbuildRoom(i); }
  let dummies = [];
  function fixLights() { // всегда ровно 3 точечных источника в сцене
    if (!dummies.length) dummies = [0, 1, 2].map(() => new T.PointLight(0x000000, 0, 1));
    const need = 3 - S.rooms.size;
    dummies.forEach((d, k) => {
      if (k < need && !d.parent) scene.add(d);
      else if (k >= need && d.parent) scene.remove(d);
    });
  }
  const curRoom = (z) => clamp(Math.floor(-z / RD), 0, S.front);
  function syncRooms(cur) {
    const lo = Math.max(0, cur - 1), hi = Math.min(S.front, cur + 1);
    for (let i = lo; i <= hi; i++) buildRoom(i);
    for (const i of [...S.rooms.keys()]) if (i < lo || i > hi) unbuildRoom(i);
    fixLights();
  }

  function openDoorLocal(i) {
    const R = S.rooms.get(i);
    if (R) R.doorCol.on = false;
  }

  // ---------- игроки-соседи ----------
  function makePeer(p) {
    const grp = new T.Group();
    const hue = [...p.id].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
    const mat = new T.MeshLambertMaterial({ color: new T.Color(`hsl(${hue},55%,45%)`) });
    const body = new T.Mesh(new T.CylinderGeometry(0.32, 0.32, 1.2, 12), mat); body.position.y = 0.75;
    const head = new T.Mesh(new T.SphereGeometry(0.28, 12, 10), mat); head.position.y = 1.55;
    const label = new T.Sprite(new T.SpriteMaterial({ map: textTex(p.nick, 256, 64, '600 30px system-ui', null, '#fff'), transparent: true, depthTest: false }));
    label.scale.set(1.8, 0.45, 1); label.position.y = 2.1;
    grp.add(body, head, label);
    scene.add(grp);
    return { grp, label, nick: p.nick, tx: p.x, tz: p.z };
  }

  function updatePeers(list) {
    const seen = new Set();
    for (const p of list) {
      seen.add(p.id);
      let o = S.peers.get(p.id);
      if (!o) { o = makePeer(p); S.peers.set(p.id, o); o.grp.position.set(p.x, 0, p.z); }
      Object.assign(o, { tx: p.x, tz: p.z, ry: p.ry, hid: p.hid, alive: p.alive });
    }
    for (const [id, o] of S.peers) {
      if (!seen.has(id)) { scene.remove(o.grp); S.peers.delete(id); }
    }
  }

  // ---------- движение и взаимодействие ----------
  function allColliders() {
    const out = [];
    for (const R of S.rooms.values()) for (const c of R.colliders) if (c.on) out.push(c);
    return out;
  }
  function tryMove(dx, dz) {
    const r = 0.35, nx = S.x + dx, nz = S.z + dz;
    for (const c of allColliders()) {
      if (nx > c.minx - r && nx < c.maxx + r && nz > c.minz - r && nz < c.maxz + r) return;
    }
    S.x = nx; S.z = nz;
  }
  function move(dt) {
    let fx = touch.x, fz = -touch.y;
    if (keys.has('KeyW') || keys.has('ArrowUp')) fz += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) fz -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) fx += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) fx -= 1;
    const len = Math.hypot(fx, fz);
    if (len > 1) { fx /= len; fz /= len; }
    const sp = S.run || keys.has('ShiftLeft') || keys.has('ShiftRight') ? 7.2 : 4.2;
    const tx = (-Math.sin(S.yaw) * fz + Math.cos(S.yaw) * fx) * sp;
    const tz = (-Math.cos(S.yaw) * fz - Math.sin(S.yaw) * fx) * sp;
    const k = Math.min(1, dt * 10);
    S.vx += (tx - S.vx) * k; S.vz += (tz - S.vz) * k;
    tryMove(S.vx * dt, 0); tryMove(0, S.vz * dt);
    S.bob += Math.hypot(S.vx, S.vz) * dt;
  }

  function nearest() {
    const fx = -Math.sin(S.yaw), fz = -Math.cos(S.yaw);
    let best = null, bd = 1e9;
    for (const R of S.rooms.values()) {
      for (const it of R.inter) {
        if (it.type === 'door' && it.R.i !== S.front) continue;
        if (it.type === 'drawer' && it.done) continue;
        const dx = it.x - S.x, dz = it.z - S.z, d = Math.hypot(dx, dz);
        if (d > it.reach) continue;
        if (d > 0.9 && (dx * fx + dz * fz) / d < 0.45) continue;
        if (d < bd) { bd = d; best = it; }
      }
    }
    return best;
  }

  function say(text, ms) {
    $('drMsg').textContent = text;
    S.msgUntil = performance.now() + (ms || 2500);
  }

  function interact() {
    if (!S.alive || S.over) return;
    if (S.hidden) { // выйти из шкафа
      const it = S.hidden;
      S.x = it.ex; S.z = it.ez; S.hidden = null;
      $('drHide').hidden = true;
      sfx.hide();
      return;
    }
    const it = nearest();
    if (!it) return;
    if (it.type === 'door') {
      if (S.pending) return;
      if (it.R.f_locked === undefined) it.R.f_locked = it.R.locked;
      if (it.R.f_locked && !S.hasKey) return say('Дверь заперта. Найди ключ в ящиках этой комнаты');
      if (it.R.f_locked) { S.hasKey = false; it.R.f_locked = false; say('Ты открыл замок ключом'); }
      S.pending = true;
      Net.send({ type: 'd_open', room: it.R.i });
      setTimeout(() => { S.pending = false; }, 1500);
    } else if (it.type === 'closet') {
      S.hidden = it; S.vx = S.vz = 0;
      S.x = it.x; S.z = it.z;
      S.yaw = it.face > 0 ? -Math.PI / 2 : Math.PI / 2; S.pitch = 0;
      $('drHide').hidden = false;
      sfx.hide();
    } else if (it.type === 'drawer') {
      it.done = true; it.mesh.material = M.drawerOpen; sfx.drawer();
      if (it.f.key) { S.hasKey = true; sfx.key(); say('Ты нашёл ключ!'); }
      else if (it.f.gold) { S.gold += it.f.gold; sfx.coin(); say(`+${it.f.gold} золота`); }
      else say('Пусто');
    }
  }

  function promptText() {
    if (S.hidden) return 'E — выйти из шкафа';
    const it = nearest();
    if (!it) return '';
    if (it.type === 'door') return it.R.locked && it.R.f_locked !== false && !S.hasKey ? 'Дверь заперта — нужен ключ' : 'E — открыть дверь';
    if (it.type === 'closet') return 'E — спрятаться';
    return 'E — обыскать';
  }

  // ---------- сущности ----------
  function startEvent(ev) {
    endEvent();
    S.ev = ev;
    S.evSnd = entSound(ev.type);
    const sp = new T.Sprite(new T.SpriteMaterial({ map: faceTex(ev.type), transparent: true, fog: false }));
    sp.scale.set(ev.type === 'rush' ? 4 : 5, ev.type === 'rush' ? 4 : 5, 1);
    sp.visible = false;
    scene.add(sp);
    ev.sprite = sp;
  }
  function endEvent() {
    if (!S.ev) return;
    scene.remove(S.ev.sprite);
    if (S.evSnd) { S.evSnd.stop(); S.evSnd = null; }
    S.ev = null;
  }

  function updateEvent() {
    const ev = S.ev;
    if (!ev) return false;
    const st = evState(ev, serverNow());
    let flick = false;
    if (st.phase === 'done') { endEvent(); return false; }
    if (st.phase === 'warn') {
      flick = !!ev.flick;
      const k = clamp((serverNow() - (ev.t0 - 3500)) / 3500, 0, 1);
      if (S.evSnd) S.evSnd.set(k * 0.25, 220);
      ev.sprite.visible = false;
    } else if (st.phase === 'gap') {
      if (S.evSnd) S.evSnd.set(0.08, 250);
      ev.sprite.visible = false;
    } else {
      flick = !!ev.flick;
      const dist = Math.abs(st.z - S.z);
      if (S.evSnd) S.evSnd.set(clamp(1 - dist / 80, 0.05, 1), 300 + 900 * clamp(1 - dist / 80, 0, 1));
      ev.sprite.visible = true;
      ev.sprite.position.set(Math.sin(performance.now() / 90) * 0.4, 1.7, st.z);
      if (ev.type === 'rush') {
        for (const R of S.rooms.values()) { // Rush ломает свет в комнатах, через которые пролетел
          if (st.z < R.z0 && st.z > R.z1 && !R.broken) { R.broken = true; S.broken.add(R.i); }
        }
      }
      if (S.alive && !S.hidden && !S.over && dist < 2.2) die(ev.type === 'rush' ? 'Rush' : 'Ambush');
    }
    return flick;
  }

  function die(by) {
    if (!S.alive) return;
    S.alive = false; S.killedBy = by; S.hidden = null;
    $('drHide').hidden = true;
    sfx.hit();
    Net.send({ type: 'd_dead' });
    showOver('dead');
  }

  function damage(n, by) {
    S.hp = Math.max(0, S.hp - n);
    $('drFlash').style.opacity = '0.7';
    sfx.hit();
    if (S.hp <= 0) die(by);
  }

  // Screech: нужно успеть посмотреть на него
  function updateScreech(dt, now) {
    if (!S.alive || S.over) return;
    const sc = S.screech;
    if (!sc) {
      if (S.hidden || S.front < 2 || now < S.nextScreech) return;
      S.nextScreech = now + rnd(35000, 70000);
      if (spot.intensity > 0 && Math.random() < 0.5) return; // свет отпугивает
      const fx = -Math.sin(S.yaw), fz = -Math.cos(S.yaw);
      const sx = S.x + fx * 1.4 + fz * 0.6 * (Math.random() < 0.5 ? 1 : -1), sz = S.z + fz * 1.4 - fx * 0.6 * (Math.random() < 0.5 ? 1 : -1);
      const sp = new T.Sprite(new T.SpriteMaterial({ map: faceTex('screech'), transparent: true, fog: false }));
      sp.scale.set(0.9, 0.9, 1); sp.position.set(sx, 1.5, sz);
      scene.add(sp);
      S.screech = { sp, t: 0, look: 0 };
      sfx.psst();
      return;
    }
    sc.t += dt;
    const dx = sc.sp.position.x - S.x, dz = sc.sp.position.z - S.z, d = Math.hypot(dx, dz) || 1;
    const dot = (dx * -Math.sin(S.yaw) + dz * -Math.cos(S.yaw)) / d;
    if (dot > 0.93) sc.look += dt; else sc.look = Math.max(0, sc.look - dt);
    if (sc.look > 0.25) { scene.remove(sc.sp); S.screech = null; sfx.screech(); say('Ты отогнал Screech'); }
    else if (sc.t > 1.9) { scene.remove(sc.sp); S.screech = null; sfx.screech(); damage(25, 'Screech'); say('Screech укусил тебя!'); }
  }

  // ---------- кадр ----------
  let last = 0, lastSend = 0;
  function frame(ts) {
    rafId = requestAnimationFrame(frame);
    if (!S.on || !S.ready) return;
    const dt = Math.min(0.05, (ts - last) / 1000 || 0.016);
    last = ts;
    const now = performance.now();

    let cx = S.x, cz = S.z, cy = 1.7, yaw = S.yaw, pitch = S.pitch;
    if (S.alive && !S.over) {
      if (!S.hidden) move(dt);
      else S.yaw = clamp(S.yaw, (S.hidden.face > 0 ? -Math.PI / 2 : Math.PI / 2) - 0.7, (S.hidden.face > 0 ? -Math.PI / 2 : Math.PI / 2) + 0.7);
      cx = S.x; cz = S.z; yaw = S.yaw;
      cy = 1.7 + Math.sin(S.bob * 2.2) * 0.04;
      for (const R of S.rooms.values()) for (const c of R.coins) {
        if (!c.taken && Math.hypot(c.x - S.x, c.wz - S.z) < 0.9) { c.taken = true; c.mesh.visible = false; S.gold += c.v; sfx.coin(); }
      }
    } else if (!S.alive) { // наблюдаем за живым игроком
      const tgt = [...S.peers.values()].find((p) => p.alive);
      if (tgt) { cx = tgt.grp.position.x; cz = tgt.grp.position.z; yaw = tgt.ry || 0; cy = 1.7; }
      else cy = 0.45;
    }

    syncRooms(curRoom(cz));
    const flick = updateEvent();
    updateScreech(dt, now);

    for (const R of S.rooms.values()) {
      R.lamp.intensity = R.broken ? 0 : R.base * (flick ? (Math.random() < 0.5 ? 0.12 : 1) : 1);
      R.doorAngle += ((R.i < S.front ? 1.5 : 0) - R.doorAngle) * Math.min(1, dt * 3);
      R.hinge.rotation.y = R.doorAngle;
    }
    for (const R of S.rooms.values()) for (const c of R.coins) if (!c.taken) c.mesh.rotation.z += dt * 2;

    for (const o of S.peers.values()) {
      o.grp.position.x += (o.tx - o.grp.position.x) * Math.min(1, dt * 12);
      o.grp.position.z += (o.tz - o.grp.position.z) * Math.min(1, dt * 12);
      o.grp.rotation.y = o.ry || 0;
      o.grp.visible = !o.hid;
      o.grp.rotation.z = o.alive === false ? Math.PI / 2 : 0;
      o.grp.position.y = o.alive === false ? 0.3 : 0;
    }

    camera.position.set(cx, cy, cz);
    camera.rotation.set(pitch, yaw, 0);
    if (S.ev && S.ev.sprite && S.ev.sprite.visible && Math.abs(S.ev.sprite.position.z - cz) < 30) {
      camera.position.x += (Math.random() - 0.5) * 0.04; // тряска от приближения
    }

    const fl = $('drFlash');
    if (fl.style.opacity !== '0') fl.style.opacity = String(Math.max(0, parseFloat(fl.style.opacity) - dt * 1.5));

    // позиция другим игрокам
    if (S.alive && now - lastSend > 100) {
      lastSend = now;
      Net.send({ type: 'd_pos', x: S.x, z: S.z, ry: S.yaw, hid: !!S.hidden });
    }
    // экранная подсказка и HUD
    if (now - S.lastHud > 120) {
      S.lastHud = now;
      $('drPrompt').textContent = S.alive && !S.over ? promptText() : '';
      $('drRoom').textContent = `Комната ${curRoom(cz)} / ${S.goal}`;
      $('drGold').textContent = `🪙 ${S.gold}`;
      $('drKey').hidden = !S.hasKey;
      $('drCount').textContent = `игроков: ${S.peers.size + 1}`;
      $('drHpBar').style.width = S.hp + '%';
      if (S.msgUntil && now > S.msgUntil) { $('drMsg').textContent = ''; S.msgUntil = 0; }
    }
    const sc = $('drScreech');
    sc.hidden = !S.screech;
    if (S.screech) {
      sc.style.left = 20 + (S.screech.t * 90) % 40 + '%';
      sc.style.top = '40%';
    }
    renderer.render(scene, camera);
  }

  // ---------- оверлеи ----------
  function showOver(kind, extra) {
    const o = $('drOver');
    o.hidden = false;
    const room = curRoom(S.z);
    if (kind === 'dead') {
      o.innerHTML = `<div><h2>ТЫ ПОГИБ</h2><p>Тебя убил: <b>${S.killedBy}</b></p><p>Ты дошёл до комнаты ${room}</p>
        <p class="muted">Наблюдай за живыми игроками. Если погибнут все, начнётся новый забег.</p><button id="drSpec">Наблюдать</button></div>`;
      $('drSpec').addEventListener('click', () => { o.hidden = true; });
    } else if (kind === 'over') {
      o.innerHTML = `<div><h2>ВСЕ ПОГИБЛИ</h2><p>Команда дошла до комнаты <b>${extra}</b></p><p class="muted">Новый забег начнётся через несколько секунд…</p></div>`;
    } else if (kind === 'win') {
      o.innerHTML = `<div><h2>ПОБЕДА!</h2><p>Вы открыли все ${S.goal} дверей. Золото: ${S.gold}</p><p class="muted">Новый забег скоро начнётся…</p></div>`;
    }
  }

  // ---------- сеть ----------
  function resetRun(m) {
    clearRooms();
    endEvent();
    if (S.screech) { scene.remove(S.screech.sp); S.screech = null; }
    for (const o of S.peers.values()) scene.remove(o.grp);
    S.peers.clear(); S.broken.clear();
    S.seed = m.seed; S.front = m.front; S.goal = m.goal || 100;
    S.skew = m.now - Date.now();
    S.alive = true; S.hp = 100; S.hasKey = false; S.gold = 0; S.hidden = null; S.over = !!m.over;
    S.x = m.spawn.x; S.z = m.spawn.z; S.yaw = 0; S.pitch = 0; S.vx = S.vz = 0;
    S.nextScreech = performance.now() + 40000;
    $('drHpBar').style.width = '100%';
    $('drHide').hidden = true;
    $('drOver').hidden = true;
    $('drMsg').textContent = '';
    syncRooms(curRoom(S.z));
    S.ready = true;
    say(S.front ? `Ты присоединился к забегу (комната ${S.front})` : 'Найди дверь в конце комнаты. Помни: от Rush и Ambush прячься в шкафу!', 5000);
  }

  function onMessage(m) {
    switch (m.type) {
      case 'init':
        if (S.on) Net.send({ type: 'd_join' }); // переподключение
        break;
      case 'd_count':
        S.count = m.n;
        $('drCountLand').textContent = m.n ? `Сейчас в забеге игроков: ${m.n}, открыто дверей: ${m.front}` : 'Сейчас в забеге никого нет — будь первым!';
        break;
      case 'd_init':
      case 'd_start':
        if (!S.on) break;
        resetRun(m);
        break;
      case 'd_front':
        if (!S.ready) break;
        S.front = m.front; S.pending = false;
        openDoorLocal(m.front - 1);
        syncRooms(curRoom(S.z));
        sfx.door();
        say(`Дверь ${pad4(m.front)} открыта`);
        break;
      case 'd_peers': if (S.ready && S.on) updatePeers(m.list); break;
      case 'd_event':
        if (S.ready && S.on) startEvent(m.ev);
        break;
      case 'd_over': if (S.on) { S.over = true; showOver('over', m.front); } break;
      case 'd_win': if (S.on) { S.over = true; showOver('win'); } break;
    }
  }

  // ---------- вход / выход ----------
  async function enter() {
    if (S.on) return;
    const btn = $('drPlay');
    btn.disabled = true; btn.textContent = 'Загружаю 3D…';
    try {
      T = window.THREE ? window.THREE : (await loadThree(), window.THREE);
      initGL();
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Играть';
      $('drCountLand').textContent = 'Не удалось загрузить 3D-движок (нужен интернет и WebGL).';
      return;
    }
    btn.disabled = false; btn.textContent = 'Играть';
    audioInit();
    S.on = true; S.ready = false;
    $('drStage').hidden = false;
    resize();
    Net.send({ type: 'd_join' });
    last = performance.now();
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(frame);
  }

  function leave() {
    if (!S.on) return;
    S.on = false; S.ready = false;
    Net.send({ type: 'd_leave' });
    cancelAnimationFrame(rafId);
    if (document.pointerLockElement) document.exitPointerLock();
    audioStop();
    endEvent();
    clearRooms();
    for (const o of S.peers.values()) scene.remove(o.grp);
    S.peers.clear();
    $('drStage').hidden = true;
    keys.clear(); touch.x = touch.y = 0;
  }

  $('drPlay').addEventListener('click', enter);
  $('drExit').addEventListener('click', () => { leave(); Net.send({ type: 'd_peek' }); });

  // ---------- ввод ----------
  document.addEventListener('keydown', (e) => {
    if (!S.on) return;
    if (e.code === 'KeyE' && !e.repeat) interact();
    else if (e.code === 'KeyF' && !e.repeat) { spot.intensity = spot.intensity > 0 ? 0 : 1.5; say(spot.intensity ? 'Фонарик включён' : 'Фонарик выключен', 1200); }
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight'].includes(e.code)) e.preventDefault();
    keys.add(e.code);
  });
  document.addEventListener('keyup', (e) => keys.delete(e.code));
  document.addEventListener('mousemove', (e) => {
    if (!S.on || document.pointerLockElement !== viewEl) return;
    S.yaw -= e.movementX * 0.0022;
    S.pitch = clamp(S.pitch - e.movementY * 0.0022, -1.4, 1.4);
  });

  root.addEventListener('pointerdown', (e) => {
    if (AC && AC.state === 'suspended') AC.resume();
    if (!S.on || e.target.closest('button') || !e.target.closest('#drView')) return;
    if (e.pointerType !== 'touch') {
      if (document.pointerLockElement !== viewEl && viewEl.requestPointerLock) viewEl.requestPointerLock();
      return;
    }
    const mover = e.clientX < window.innerWidth / 2;
    pointers.set(e.pointerId, { mover, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY });
  });
  root.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    if (p.mover) {
      touch.x = clamp((e.clientX - p.sx) / 55, -1, 1);
      touch.y = clamp((e.clientY - p.sy) / 55, -1, 1);
    } else {
      S.yaw -= (e.clientX - p.x) * 0.006;
      S.pitch = clamp(S.pitch - (e.clientY - p.y) * 0.006, -1.4, 1.4);
    }
    p.x = e.clientX; p.y = e.clientY;
  });
  const endPtr = (e) => {
    const p = pointers.get(e.pointerId);
    if (p && p.mover) touch.x = touch.y = 0;
    pointers.delete(e.pointerId);
  };
  root.addEventListener('pointerup', endPtr);
  root.addEventListener('pointercancel', endPtr);
  $('drBtnE').addEventListener('pointerdown', (e) => { e.preventDefault(); interact(); });
  $('drBtnF').addEventListener('pointerdown', (e) => { e.preventDefault(); if (spot) spot.intensity = spot.intensity > 0 ? 0 : 1.5; });
  $('drBtnR').addEventListener('pointerdown', (e) => { e.preventDefault(); S.run = !S.run; $('drBtnR').style.opacity = S.run ? 1 : 0.75; });

  window.Doors = {
    onMessage,
    onShow() { Net.send({ type: 'd_peek' }); },
    onHide() { leave(); },
    _test: { evState, genRoom, mulberry },
  };
})();
