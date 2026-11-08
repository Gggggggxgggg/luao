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

  function genRoom(seed, i, goal, chase) {
    const r = mulberry(Math.imul(seed ^ 0x9e3779b9, 2654435761) ^ Math.imul(i + 1, 0x85ebca6b));
    r(); r(); r(); // прогрев генератора
    const inChase = !!chase && i >= chase.from && i <= chase.to;
    const room = {
      i, chase: inChase, final: inChase && i === chase.to,
      locked: !inChase && i >= 2 && i < goal && r() < 0.3, dark: !inChase && i >= 4 && r() < 0.35,
      furn: [], coins: [], decor: [], obstacles: [],
    };
    if (inChase) { // коридор погони: завалы вместо шкафов (спрятаться нельзя)
      for (let k = 0; k < 3; k++) {
        room.obstacles.push({ side: k % 2 ? 1 : -1, dz: 3 + k * 4.2 + r() * 1.5, w: 3.4 + r() * 1.4, d: 1.3, h: 1 + r() * 0.8 });
      }
    } else {
      // 10 мест вдоль стен; перемешиваем и раздаём шкафы, комоды и декор
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
      for (let k = closets + drawers, n = 0; k < slots.length && n < 3; k++, n++) {
        const x = r();
        room.decor.push({ type: x < 0.5 ? 'plant' : x < 0.75 ? 'shelf' : 'table', side: slots[k].side, dz: slots[k].dz, kind: Math.floor(r() * 3) });
      }
      for (let k = 0; k < 2; k++) room.decor.push({ type: 'painting', side: r() < 0.5 ? -1 : 1, dz: 2 + r() * 12, kind: Math.floor(r() * 4) });
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
    #drChatBtn { position: absolute; top: 10px; right: 10px; z-index: 5; opacity: .85; }
    #drFeed { position: absolute; right: 10px; top: 52px; width: min(300px, 70vw); font-size: 13px; text-align: right; pointer-events: none; color: #e8d9a8; text-shadow: 0 0 5px #000; }
    #drFeed div { margin-bottom: 3px; }
    #drChat { position: absolute; right: 10px; top: 52px; z-index: 5; width: min(330px, calc(100vw - 20px)); height: min(46vh, 320px); display: flex; flex-direction: column; background: rgba(0,0,0,.85); border: 1px solid var(--line); border-radius: 8px; }
    #drChatList { flex: 1; overflow: auto; padding: 8px 10px; font-size: 13px; display: flex; flex-direction: column; gap: 4px; }
    #drChatList .sys { color: var(--muted); font-style: italic; }
    #drChatList b { color: var(--moon); }
    #drChatForm { display: flex; gap: 6px; padding: 8px; border-top: 1px solid var(--line); }
    #drChatForm input { flex: 1; min-width: 0; }
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
        <li><b>Вихрь</b> — свет мигает, слышен нарастающий гул. Спрячься в шкафу до того, как он пролетит.</li>
        <li><b>Эхо</b> — быстрее Вихря и проносится по комнатам несколько раз туда-обратно. Выходи из шкафа, только когда стихнет.</li>
        <li><b>Преследователь</b> — на некоторых этажах в коридоре гаснет свет, по стенам открываются глаза, и по нему идёт нечто. Прятаться нельзя: беги вперёд, огибай завалы и открой дверь <b>0000</b>.</li>
        <li><b>Шорох</b> — шепчет «пссст». Успей посмотреть на него, иначе укусит.</li>
        <li>Запертая дверь требует <b>ключ</b> — он лежит в одном из ящиков комнаты. С комнаты №5 бывают тёмные комнаты — включай фонарик.</li>
        <li>Пока кто-то жив, забег продолжается; погибшие наблюдают за живыми. Когда погибли все — новый забег.</li>
      </ul>
      <p><b>Управление:</b> WASD — ходить, Shift — бежать, мышь — смотреть (клик по экрану захватывает мышь), E — действие, F — фонарик, Esc — отпустить мышь, Enter или T — чат.
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
      <button id="drChatBtn" title="Чат (Enter или T)">💬</button>
      <div id="drFeed"></div>
      <div id="drChat" hidden>
        <div id="drChatList"></div>
        <form id="drChatForm"><input type="text" id="drChatInput" maxlength="500" placeholder="Сообщение" autocomplete="off"><button>→</button></form>
      </div>
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
    chase: null, chaser: null, chaseSnd: null, chatOpen: false, unread: 0, pending: false, lastSend: 0, lastHud: 0, count: 0, msgUntil: 0, deadY: 0,
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
    const low = type === 'rush' || type === 'chase';
    const bp = AC.createBiquadFilter(); bp.type = low ? 'bandpass' : 'highpass'; bp.frequency.value = 400; bp.Q.value = 0.8;
    const osc = AC.createOscillator(); osc.type = low ? 'sawtooth' : 'square'; osc.frequency.value = type === 'rush' ? 80 : type === 'chase' ? 46 : 190;
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

  // лица существ нарисованы на canvas; все дизайны оригинальные
  function faceTex(kind) {
    return canvasTex(256, 256, (g, w, h) => {
      if (kind === 'rush') { // «Вихрь»: грозовое облако с тремя щелевидными глазами
        for (let k = 0; k < 9; k++) {
          const x = 70 + Math.random() * 116, y = 80 + Math.random() * 100, r = 50 + Math.random() * 40;
          const grd = g.createRadialGradient(x, y, 4, x, y, r);
          grd.addColorStop(0, 'rgba(26,28,38,.95)'); grd.addColorStop(1, 'rgba(10,10,16,0)');
          g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
        }
        g.fillStyle = '#ffb347';
        for (const [x, y] of [[88, 110], [128, 96], [168, 110]]) { g.beginPath(); g.ellipse(x, y, 7, 22, 0, 0, Math.PI * 2); g.fill(); }
      } else if (kind === 'ambush') { // «Эхо»: бледная маска с косыми глазами и зигзагом вместо рта
        const grd = g.createRadialGradient(128, 128, 20, 128, 128, 120);
        grd.addColorStop(0, '#9fd6c8'); grd.addColorStop(0.7, '#2c5a56'); grd.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grd; g.beginPath(); g.ellipse(128, 128, 84, 112, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#031210';
        g.beginPath(); g.moveTo(72, 96); g.lineTo(116, 112); g.lineTo(80, 126); g.fill();
        g.beginPath(); g.moveTo(184, 96); g.lineTo(140, 112); g.lineTo(176, 126); g.fill();
        g.strokeStyle = '#031210'; g.lineWidth = 6; g.beginPath(); g.moveTo(84, 176);
        for (let x = 84; x <= 172; x += 22) g.lineTo(x + 11, (x / 22) % 2 ? 160 : 194);
        g.stroke();
      } else { // «Шорох»: маленький колючий шар с красными точками-глазами
        g.fillStyle = '#0a0a0a';
        for (let k = 0; k < 14; k++) {
          const a = (k / 14) * Math.PI * 2;
          g.beginPath(); g.moveTo(128 + Math.cos(a - 0.12) * 60, 128 + Math.sin(a - 0.12) * 60);
          g.lineTo(128 + Math.cos(a) * 112, 128 + Math.sin(a) * 112); g.lineTo(128 + Math.cos(a + 0.12) * 60, 128 + Math.sin(a + 0.12) * 60); g.fill();
        }
        g.beginPath(); g.arc(128, 128, 66, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#ff2a2a';
        for (const x of [104, 152]) { g.beginPath(); g.arc(x, 120, 9, 0, Math.PI * 2); g.fill(); }
      }
    });
  }

  function textTex(text, w, h, font, bg, fg) {
    return canvasTex(w, h, (g) => {
      if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
      g.fillStyle = fg; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(text, w / 2, h / 2);
    });
  }

  // ---------- материалы и текстуры (рисуются на canvas, файлов нет) ----------
  function makeMaterials() {
    const rep = (t) => { t.wrapS = t.wrapT = T.RepeatWrapping; return t; };
    const L = (o) => new T.MeshLambertMaterial(o);
    const wallTex = rep(canvasTex(128, 128, (g, w, h) => {
      g.fillStyle = '#5b4636'; g.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += 32) { g.fillStyle = '#6a5240'; g.fillRect(x + 8, 0, 16, h); }
      g.fillStyle = '#7d634a';
      for (let x = 16; x < w; x += 32) for (let y = 16; y < h; y += 48) {
        g.beginPath(); g.moveTo(x, y - 8); g.lineTo(x + 6, y); g.lineTo(x, y + 8); g.lineTo(x - 6, y); g.fill();
      }
    }));
    const woodTex = rep(canvasTex(128, 64, (g, w, h) => {
      g.fillStyle = '#4a3220'; g.fillRect(0, 0, w, h);
      for (let k = 0; k < 40; k++) {
        g.strokeStyle = Math.random() < 0.5 ? 'rgba(0,0,0,.18)' : 'rgba(255,220,170,.07)';
        g.beginPath(); const y = Math.random() * h; g.moveTo(0, y); g.bezierCurveTo(w / 3, y + 4, 2 * w / 3, y - 4, w, y + 2); g.stroke();
      }
    }));
    const carpetTex = rep(canvasTex(128, 128, (g, w, h) => {
      g.fillStyle = '#4a1418'; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(190,150,70,.5)'; g.lineWidth = 2;
      for (let o = -h; o < w; o += 32) { g.beginPath(); g.moveTo(o, 0); g.lineTo(o + h, h); g.stroke(); g.beginPath(); g.moveTo(o + h, 0); g.lineTo(o, h); g.stroke(); }
      g.fillStyle = 'rgba(190,150,70,.6)';
      for (let x = 16; x < w; x += 32) for (let y = 16; y < h; y += 32) { g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill(); }
    }));
    const runnerTex = rep(canvasTex(128, 256, (g, w, h) => {
      g.fillStyle = '#7a1c22'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#c9a24a'; g.fillRect(8, 0, 6, h); g.fillRect(w - 14, 0, 6, h);
      g.fillStyle = '#2a0b0e'; g.fillRect(18, 0, 4, h); g.fillRect(w - 22, 0, 4, h);
      g.strokeStyle = '#c9a24a'; g.lineWidth = 3;
      for (let y = 64; y < h + 64; y += 128) { g.beginPath(); g.ellipse(w / 2, y, 30, 44, 0, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.ellipse(w / 2, y, 14, 22, 0, 0, Math.PI * 2); g.stroke(); }
    }));
    const art = (n) => canvasTex(128, 96, (g, w, h) => {
      const sky = g.createLinearGradient(0, 0, 0, h);
      if (n === 0) { sky.addColorStop(0, '#34406b'); sky.addColorStop(1, '#d8a060'); } else if (n === 1) { sky.addColorStop(0, '#1a2a2a'); sky.addColorStop(1, '#4a6a50'); } else if (n === 2) { sky.addColorStop(0, '#6a3a3a'); sky.addColorStop(1, '#e0c080'); } else { sky.addColorStop(0, '#222'); sky.addColorStop(1, '#556'); }
      g.fillStyle = sky; g.fillRect(0, 0, w, h);
      g.fillStyle = n === 1 ? '#0c1a14' : '#2a1e18';
      g.beginPath(); g.moveTo(0, h); g.lineTo(0, 64); g.quadraticCurveTo(40, 40, 70, 62); g.quadraticCurveTo(100, 78, w, 56); g.lineTo(w, h); g.fill();
      g.fillStyle = 'rgba(255,240,200,.85)'; g.beginPath(); g.arc(n % 2 ? 94 : 34, 26, 10, 0, Math.PI * 2); g.fill();
    });
    const glowTex = (inner) => canvasTex(64, 64, (g, w, h) => {
      const grd = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
      grd.addColorStop(0, inner); grd.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = grd; g.fillRect(0, 0, w, h);
    });
    const eyeTex = canvasTex(128, 64, (g, w, h) => {
      g.fillStyle = 'rgba(0,0,0,.0)'; g.clearRect(0, 0, w, h);
      g.fillStyle = '#e8e4d8'; g.beginPath(); g.ellipse(w / 2, h / 2, 56, 24, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#d2781e'; g.beginPath(); g.arc(w / 2, h / 2, 18, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#000'; g.beginPath(); g.ellipse(w / 2, h / 2, 6, 15, 0, 0, Math.PI * 2); g.fill();
    });
    Object.assign(M, {
      wall: L({ map: wallTex }), wallDark: L({ map: wallTex, color: 0xb06a6a }),
      wood: L({ map: woodTex }), ceil: L({ map: woodTex, color: 0x777777 }), carpet: L({ map: carpetTex }), runner: L({ map: runnerTex }),
      trim: L({ color: 0x24160a }), door: L({ map: woodTex, color: 0xc9966a }), doorInset: L({ map: woodTex, color: 0x9a6e48 }),
      doorFinal: L({ color: 0x241012 }), brass: L({ color: 0xb08a3a }), glass: L({ color: 0xaaccdd, transparent: true, opacity: 0.28 }),
      cab: L({ map: woodTex, color: 0xa87850 }), cabPanel: L({ map: woodTex, color: 0x7e5634 }), drawerOpen: L({ color: 0x2a1d10 }),
      pot: L({ color: 0xa0522d }), soil: L({ color: 0x2a1a0f }), leaf: [L({ color: 0x2e6b34 }), L({ color: 0x3c8a40 }), L({ color: 0x245a2c })],
      lamp: new T.MeshBasicMaterial({ color: 0xffe2a8 }), lampOff: new T.MeshBasicMaterial({ color: 0x2a2418 }),
      coin: new T.MeshBasicMaterial({ color: 0xffd45a }), redGlow: new T.MeshBasicMaterial({ color: 0xff3b2e }),
      eye: new T.MeshBasicMaterial({ map: eyeTex, transparent: true, depthWrite: false }),
      paint: [0, 1, 2, 3].map((n) => new T.MeshBasicMaterial({ map: art(n) })),
      mist: new T.SpriteMaterial({ map: glowTex('rgba(10,0,16,.9)'), transparent: true, depthWrite: false }),
    });
    M.floor = M.carpet; M.frame = M.trim; M.closet = M.cab; M.panel = M.cabPanel; M.drawer = M.cab;
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
    makeMaterials();
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
  function scaleUV(geo, su, sv) {
    const uv = geo.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * su, uv.getY(k) * sv);
  }
  function tbox(parent, w, h, d, x, y, z, mat, su, sv) { // коробка с повторяющейся текстурой
    const geo = new T.BoxGeometry(w, h, d);
    if (su) scaleUV(geo, su, sv);
    const m = new T.Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }

  // горшок с растением: куст-шар, папоротник или высокое растение
  function plant(g, x, z, kind, rv, R) {
    const pot = new T.Mesh(new T.CylinderGeometry(0.34, 0.25, 0.5, 14), M.pot); pot.position.set(x, 0.25, z); g.add(pot);
    const rim = new T.Mesh(new T.CylinderGeometry(0.38, 0.38, 0.07, 14), M.pot); rim.position.set(x, 0.52, z); g.add(rim);
    const soil = new T.Mesh(new T.CylinderGeometry(0.33, 0.33, 0.04, 14), M.soil); soil.position.set(x, 0.55, z); g.add(soil);
    if (kind === 0) {
      for (let k = 0; k < 6; k++) {
        const a = rv() * 6.28, rr = rv() * 0.22;
        const b = new T.Mesh(new T.SphereGeometry(0.26 + rv() * 0.16, 9, 7), M.leaf[k % 3]);
        b.position.set(x + Math.cos(a) * rr, 0.85 + rv() * 0.45, z + Math.sin(a) * rr); g.add(b);
      }
    } else if (kind === 1) {
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * 6.28 + rv() * 0.4, piv = new T.Group();
        piv.position.set(x, 0.56, z); piv.rotation.set(Math.cos(a) * 0.6, 0, -Math.sin(a) * 0.6);
        const c = new T.Mesh(new T.ConeGeometry(0.11, 1.0, 5), M.leaf[k % 3]); c.position.y = 0.5; piv.add(c); g.add(piv);
      }
    } else {
      const st = new T.Mesh(new T.CylinderGeometry(0.04, 0.05, 1.2, 6), M.soil); st.position.set(x, 1.15, z); g.add(st);
      for (let k = 0; k < 4; k++) {
        const b = new T.Mesh(new T.SphereGeometry(0.3 - k * 0.03, 9, 7), M.leaf[k % 3]);
        b.position.set(x + (rv() - 0.5) * 0.25, 1.5 + k * 0.28, z + (rv() - 0.5) * 0.25); g.add(b);
      }
    }
    R.colliders.push(aabb(x, z, 0.7, 0.7));
  }

  // декоративный шкаф: двери с филёнками, карниз, ножки; перед направлен в +x (затем поворачивается)
  function wardrobe(g, wx, wz, side) {
    const w = new T.Group(); w.position.set(wx, 0, wz); w.rotation.y = side < 0 ? 0 : Math.PI; g.add(w);
    const add = (geo, mat, x, y, z) => { const m = new T.Mesh(geo, mat); m.position.set(x, y, z); w.add(m); return m; };
    add(new T.BoxGeometry(1.1, 2.5, 1.6), M.cab, 0, 1.35, 0);
    add(new T.BoxGeometry(1.2, 0.16, 1.7), M.cabPanel, 0, 2.68, 0);
    for (const sz of [-1, 1]) {
      add(new T.BoxGeometry(0.04, 2.25, 0.74), M.cabPanel, 0.56, 1.35, sz * 0.4);
      add(new T.BoxGeometry(0.05, 0.9, 0.5), M.cab, 0.58, 1.9, sz * 0.4);
      add(new T.BoxGeometry(0.05, 0.9, 0.5), M.cab, 0.58, 0.8, sz * 0.4);
      add(new T.BoxGeometry(0.07, 0.22, 0.05), M.brass, 0.6, 1.3, sz * 0.1);
      add(new T.BoxGeometry(0.1, 0.1, 0.1), M.cabPanel, 0.45, 0.1, sz * 0.65);
    }
  }

  // комод с выдвижным ящиком, вазой и цветами сверху
  function dresser(g, wx, wz, side, rv) {
    const w = new T.Group(); w.position.set(wx, 0, wz); w.rotation.y = side < 0 ? 0 : Math.PI; g.add(w);
    const add = (geo, mat, x, y, z) => { const m = new T.Mesh(geo, mat); m.position.set(x, y, z); w.add(m); return m; };
    add(new T.BoxGeometry(0.7, 0.98, 1.4), M.cab, 0, 0.49, 0);
    add(new T.BoxGeometry(0.78, 0.06, 1.5), M.cabPanel, 0, 1.01, 0);
    let top = null;
    [0.8, 0.5, 0.2].forEach((y, k) => {
      const f = add(new T.BoxGeometry(0.04, 0.26, 1.3), M.cabPanel, 0.36, y, 0);
      add(new T.BoxGeometry(0.06, 0.06, 0.14), M.brass, 0.4, y, 0);
      if (k === 0) top = f;
    });
    add(new T.CylinderGeometry(0.1, 0.07, 0.28, 10), M.glass, 0, 1.18, 0.3);
    for (let k = 0; k < 4; k++) add(new T.SphereGeometry(0.07, 6, 5), M.leaf[k % 3], (rv() - 0.5) * 0.12, 1.36 + rv() * 0.1, 0.3 + (rv() - 0.5) * 0.12);
    return top;
  }

  function shelf(g, wx, wz, side, rv, R) {
    const w = new T.Group(); w.position.set(wx, 0, wz); w.rotation.y = side < 0 ? 0 : Math.PI; g.add(w);
    const add = (geo, mat, x, y, z) => { const m = new T.Mesh(geo, mat); m.position.set(x, y, z); w.add(m); return m; };
    add(new T.BoxGeometry(0.06, 2.4, 2.0), M.cabPanel, -0.22, 1.2, 0);
    for (const sz of [-1, 1]) add(new T.BoxGeometry(0.5, 2.4, 0.06), M.cab, 0, 1.2, sz * 0.97);
    const rows = [0.15, 0.7, 1.25, 1.8, 2.37];
    rows.forEach((y) => add(new T.BoxGeometry(0.5, 0.05, 2.0), M.cab, 0, y, 0));
    const inst = new T.InstancedMesh(new T.BoxGeometry(0.28, 0.3, 0.07), new T.MeshLambertMaterial({ color: 0xffffff }), 52);
    const pal = [0x7a2a2a, 0x2a4a7a, 0x3a6a3a, 0x8a6a2a, 0x5a3a6a, 0x2a2a2a, 0x7a5a3a];
    const dum = new T.Object3D(), col = new T.Color();
    let n = 0;
    for (let rI = 0; rI < 4; rI++) {
      let zz = -0.88;
      for (let k = 0; k < 13 && n < 52; k++, n++) {
        const th = 0.5 + rv() * 0.7, h = 0.85 + rv() * 0.3;
        dum.position.set(0.02, rows[rI] + 0.025 + 0.15 * h, zz + 0.035 * th);
        dum.scale.set(1, h, th); dum.updateMatrix(); inst.setMatrixAt(n, dum.matrix);
        inst.setColorAt(n, col.setHex(pal[Math.floor(rv() * pal.length)]));
        zz += 0.07 * th + 0.01;
      }
    }
    inst.count = n; w.add(inst);
    R.colliders.push(aabb(wx, wz, 0.5, 2.0));
  }

  function sideTable(g, wx, wz, rv, R) {
    const add = (geo, mat, x, y, z) => { const m = new T.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m; };
    add(new T.BoxGeometry(0.7, 0.06, 1.2), M.cab, wx, 0.8, wz);
    for (const dx of [-0.28, 0.28]) for (const dz of [-0.5, 0.5]) add(new T.BoxGeometry(0.07, 0.78, 0.07), M.cabPanel, wx + dx, 0.39, wz + dz);
    add(new T.CylinderGeometry(0.09, 0.12, 0.3, 10), M.glass, wx, 0.98, wz + 0.15);
    for (let k = 0; k < 3; k++) add(new T.SphereGeometry(0.07, 6, 5), M.leaf[k], wx + (rv() - 0.5) * 0.1, 1.2 + rv() * 0.08, wz + 0.15 + (rv() - 0.5) * 0.1);
    R.colliders.push(aabb(wx, wz, 0.7, 1.2));
  }

  function painting(g, side, z, kind) {
    const gr = new T.Group(); gr.position.set(side * (RW / 2 - 0.06), 2.2, z); gr.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2; g.add(gr);
    const fr = new T.Mesh(new T.BoxGeometry(1.3, 1.0, 0.06), M.brass); gr.add(fr);
    const pl = new T.Mesh(new T.PlaneGeometry(1.16, 0.88), M.paint[kind]); pl.position.z = 0.035; gr.add(pl);
  }

  function sconce(g, R, side, z) {
    const base = new T.Mesh(new T.BoxGeometry(0.06, 0.34, 0.2), M.brass); base.position.set(side * (RW / 2 - 0.05), 2.3, z); g.add(base);
    const sh = new T.Mesh(new T.CylinderGeometry(0.07, 0.13, 0.24, 8), M.lamp); sh.position.set(side * (RW / 2 - 0.2), 2.5, z); g.add(sh);
    R.lampMeshes.push(sh);
  }

  function chandelier(g, R, zc) {
    const ch = new T.Mesh(new T.CylinderGeometry(0.02, 0.02, 0.5, 5), M.brass); ch.position.set(0, RH - 0.25, zc); g.add(ch);
    const ring = new T.Mesh(new T.TorusGeometry(0.42, 0.03, 6, 18), M.brass); ring.rotation.x = Math.PI / 2; ring.position.set(0, RH - 0.55, zc); g.add(ring);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * 6.28, b = new T.Mesh(new T.SphereGeometry(0.075, 7, 6), M.lamp);
      b.position.set(Math.cos(a) * 0.42, RH - 0.5, zc + Math.sin(a) * 0.42); g.add(b); R.lampMeshes.push(b);
    }
  }

  // ---------- комнаты ----------
  function buildRoom(i) {
    if (S.rooms.has(i)) return;
    const R = genRoom(S.seed, i, S.goal, S.chase);
    const g = new T.Group();
    R.group = g; R.colliders = []; R.inter = []; R.lampMeshes = [];
    const z0 = -i * RD, z1 = -(i + 1) * RD, zc = (z0 + z1) / 2;
    R.z0 = z0; R.z1 = z1;
    const rv = mulberry(S.seed + i * 131 + 7); // детали декора одинаковы у всех игроков
    const wallMat = R.chase ? M.wallDark : M.wall;

    // пол с ковром и дорожкой, потолок с балками
    tbox(g, RW, 0.2, RD, 0, -0.1, zc, M.carpet, RW / 3, RD / 3);
    tbox(g, 3.4, 0.03, RD - 0.2, 0, 0.012, zc, M.runner, 1, RD / 4);
    tbox(g, RW, 0.2, RD, 0, RH + 0.1, zc, M.ceil, RW / 3, RD / 3);
    for (let k = 0; k < 4; k++) box(g, RW, 0.22, 0.28, 0, RH - 0.11, z0 - 2 - k * 4, M.wood);

    // боковые стены: обои, деревянные панели, плинтус и карниз
    for (const s of [-1, 1]) {
      tbox(g, 0.3, RH, RD, s * (RW / 2 + 0.15), RH / 2, zc, wallMat, RD / 3, RH / 3);
      R.colliders.push({ minx: s < 0 ? -RW / 2 - 0.3 : RW / 2, maxx: s < 0 ? -RW / 2 : RW / 2 + 0.3, minz: z1, maxz: z0, on: true });
      tbox(g, 0.08, 1.1, RD, s * (RW / 2 - 0.04), 0.55, zc, M.wood, RD / 2, 1);
      box(g, 0.12, 0.08, RD, s * (RW / 2 - 0.06), 1.12, zc, M.trim);
      box(g, 0.1, 0.18, RD, s * (RW / 2 - 0.05), 0.09, zc, M.trim);
      box(g, 0.14, 0.14, RD, s * (RW / 2 - 0.07), RH - 0.07, zc, M.trim);
    }
    if (i === 0) {
      tbox(g, RW, RH, 0.3, 0, RH / 2, z0 + 0.15, wallMat, RW / 3, RH / 3);
      R.colliders.push({ minx: -RW / 2, maxx: RW / 2, minz: z0, maxz: z0 + 0.3, on: true });
    }

    // торцевая стена с проёмом под дверь
    const gap = 2.4, side = (RW - gap) / 2;
    for (const s of [-1, 1]) {
      const cx = s * (gap / 2 + side / 2);
      tbox(g, side, RH, 0.3, cx, RH / 2, z1, wallMat, side / 3, RH / 3);
      R.colliders.push({ minx: cx - side / 2, maxx: cx + side / 2, minz: z1 - 0.15, maxz: z1 + 0.15, on: true });
    }
    tbox(g, gap, RH - 3, 0.3, 0, 3 + (RH - 3) / 2, z1, wallMat, 1, 0.4);
    const fm = R.final ? M.redGlow : M.trim;
    box(g, 0.15, 3.05, 0.36, -gap / 2 + 0.07, 1.52, z1, fm);
    box(g, 0.15, 3.05, 0.36, gap / 2 - 0.07, 1.52, z1, fm);
    box(g, gap, 0.15, 0.36, 0, 3.05, z1, fm);

    // дверь на петлях: филёнки, ручки, табличка с номером (у финальной двери коридора — «0000»)
    const hinge = new T.Group();
    hinge.position.set(-1.1, 0, z1);
    box(hinge, 2.2, 3, 0.15, 1.1, 1.5, 0, R.final ? M.doorFinal : M.door);
    for (const [px, py, pw, ph] of [[0.6, 2.2, 0.7, 0.5], [1.6, 2.2, 0.7, 0.5], [0.6, 0.9, 0.7, 1.0], [1.6, 0.9, 0.7, 1.0]]) {
      box(hinge, pw, ph, 0.04, px + 0.0, py, 0.09, R.final ? M.trim : M.doorInset);
      box(hinge, pw, ph, 0.04, px + 0.0, py, -0.09, R.final ? M.trim : M.doorInset);
    }
    for (const zz of [0.12, -0.12]) { const k = new T.Mesh(new T.SphereGeometry(0.07, 8, 6), M.brass); k.position.set(1.95, 1.4, zz); hinge.add(k); }
    const label = new T.Mesh(new T.PlaneGeometry(0.95, 0.5), new T.MeshBasicMaterial({ map: textTex(R.final ? '0000' : pad4(i + 1), 256, 128, 'bold 78px serif', R.final ? '#300808' : '#24160a', R.final ? '#ff6a5a' : '#e8d9a8') }));
    label.position.set(1.1, 2.45, 0.12); label.userData.own = true;
    hinge.add(label);
    g.add(hinge);
    R.hinge = hinge;
    R.doorCol = { minx: -1.1, maxx: 1.1, minz: z1 - 0.1, maxz: z1 + 0.1, on: i >= S.front };
    R.colliders.push(R.doorCol);
    hinge.rotation.y = i < S.front ? 1.5 : 0;
    R.doorAngle = hinge.rotation.y;
    R.inter.push({ type: 'door', x: 0, z: z1, reach: 2.8, R });

    // шкафы и комоды (интерактивные)
    R.furn.forEach((f) => {
      const wx = f.side * (RW / 2 - (f.type === 'closet' ? 0.55 : 0.35));
      const wz = z0 - f.dz;
      if (f.type === 'closet') {
        wardrobe(g, wx, wz, f.side);
        R.colliders.push(aabb(wx, wz, 1.1, 1.6));
        R.inter.push({ type: 'closet', x: wx, z: wz, reach: 2.1, R, f, ex: wx - f.side * 1.3, ez: wz, face: -f.side });
      } else {
        const m = dresser(g, wx, wz, f.side, rv);
        R.colliders.push(aabb(wx, wz, 0.7, 1.4));
        R.inter.push({ type: 'drawer', x: wx, z: wz, reach: 2.0, R, f, mesh: m, done: false });
      }
    });

    // декор: растения, книжные полки, столики, картины
    for (const d of R.decor) {
      const wz = z0 - d.dz;
      if (d.type === 'plant') plant(g, d.side * (RW / 2 - 0.5), wz, d.kind, rv, R);
      else if (d.type === 'shelf') shelf(g, d.side * (RW / 2 - 0.3), wz, d.side, rv, R);
      else if (d.type === 'table') sideTable(g, d.side * (RW / 2 - 0.45), wz, rv, R);
      else painting(g, d.side, wz, d.kind);
    }

    // завалы в коридоре погони и глаза на стенах
    for (const o of R.obstacles) {
      const ox = o.side * (RW / 2 - o.w / 2), wz = z0 - o.dz;
      const m = box(g, o.w, o.h, o.d, ox, o.h / 2, wz, M.cabPanel);
      m.rotation.z = (rv() - 0.5) * 0.12;
      box(g, o.w * 0.9, 0.1, o.d + 0.3, ox, o.h + 0.05, wz, M.cab).rotation.y = (rv() - 0.5) * 0.3;
      R.colliders.push(aabb(ox, wz, o.w, o.d));
    }
    if (R.chase) {
      for (let k = 0; k < 14; k++) {
        const s = rv() < 0.5 ? -1 : 1, e = new T.Mesh(new T.PlaneGeometry(0.55, 0.28), M.eye);
        e.position.set(s * (RW / 2 - 0.12), 1 + rv() * 2.4, z0 - 1 - rv() * (RD - 2));
        e.rotation.y = s < 0 ? Math.PI / 2 : -Math.PI / 2;
        g.add(e);
      }
    }

    // монеты
    R.coins.forEach((c) => {
      const m = new T.Mesh(new T.CylinderGeometry(0.16, 0.16, 0.04, 14), M.coin);
      m.rotation.x = Math.PI / 2; m.position.set(c.x, 0.5, z0 - c.dz);
      g.add(m); c.mesh = m; c.taken = false; c.wz = z0 - c.dz;
    });

    // свет: бра, люстра, точечный источник (в коридоре погони — красноватый)
    sconce(g, R, -1, z0 - 4); sconce(g, R, 1, z0 - 4); sconce(g, R, -1, z0 - 12); sconce(g, R, 1, z0 - 12);
    chandelier(g, R, zc);
    const lit = !R.dark;
    R.base = lit ? (R.chase ? 0.75 : 0.95) : 0;
    R.lamp = new T.PointLight(R.chase ? 0xff6a3a : 0xffd9a0, R.base, 20, 1.6);
    R.lamp.position.set(0, RH - 0.5, zc);
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
      if (o.isInstancedMesh) { o.material.dispose(); o.dispose(); }
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
      if (S.chase && !S.chase.ended) return say('Здесь не спрячешься!');
      S.hidden = it; S.vx = S.vz = 0;
      S.x = it.x; S.z = it.z;
      S.yaw = it.face > 0 ? -Math.PI / 2 : Math.PI / 2; S.pitch = 0;
      $('drHide').hidden = false;
      sfx.hide();
    } else if (it.type === 'drawer') {
      it.done = true; it.mesh.material = M.drawerOpen; it.mesh.position.x += 0.2; sfx.drawer();
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

  // ---------- погоня: оригинальное существо-преследователь и дверь «0000» ----------
  function makeChaser() {
    const g = new T.Group();
    const dark = new T.MeshLambertMaterial({ color: 0x15091f }), glow = new T.MeshBasicMaterial({ color: 0xffb040 });
    const add = (geo, mat, x, y, z) => { const m = new T.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m; };
    const body = add(new T.SphereGeometry(0.8, 14, 10), dark, 0, 1.0, 0); body.scale.set(1, 0.75, 1.7);
    const neck = add(new T.CylinderGeometry(0.2, 0.34, 0.9, 8), dark, 0, 1.55, -0.95); neck.rotation.x = 0.5;
    const head = add(new T.SphereGeometry(0.5, 12, 10), dark, 0, 2.0, -1.3); head.scale.set(1, 0.9, 1.1);
    for (const [x, y] of [[-0.22, 2.04], [0.22, 2.04], [0, 2.26]]) add(new T.SphereGeometry(0.09, 8, 6), glow, x, y, -1.75);
    for (let k = -2; k <= 2; k++) add(new T.ConeGeometry(0.04, 0.16, 4), new T.MeshBasicMaterial({ color: 0xdddddd }), k * 0.1, 1.78, -1.78).rotation.x = Math.PI;
    const legs = [];
    for (let k = 0; k < 8; k++) {
      const sd = k % 2 ? 1 : -1, row = k >> 1;
      const piv = new T.Group(); piv.position.set(sd * 0.6, 1.0, -0.7 + row * 0.6);
      const leg = new T.Mesh(new T.CylinderGeometry(0.05, 0.03, 1.7, 5), dark); leg.position.set(sd * 0.55, -0.55, 0); leg.rotation.z = sd * 0.65;
      piv.add(leg); g.add(piv); legs.push(piv);
    }
    const mist = [];
    for (let k = 0; k < 6; k++) { const sp = new T.Sprite(M.mist); sp.scale.set(2.4, 2.4, 1); g.add(sp); mist.push(sp); }
    return { g, legs, mist, head };
  }

  function clearChaser() {
    if (S.chaser) { scene.remove(S.chaser.g); S.chaser = null; }
    if (S.chaseSnd) { S.chaseSnd.stop(); S.chaseSnd = null; }
  }

  function startChase(c) {
    endEvent();
    S.chase = { ...c, ended: false };
    if (S.hidden && S.hidden.R.i >= c.from && S.hidden.R.i <= c.to) { // шкаф исчезнет вместе с комнатой
      S.x = S.hidden.ex; S.z = S.hidden.ez; S.hidden = null; $('drHide').hidden = true;
    }
    for (const i of [...S.rooms.keys()]) if (i >= c.from && i <= c.to) unbuildRoom(i);
    syncRooms(curRoom(S.z));
    say('Свет мигает… Что-то идёт по коридору! Беги к двери 0000!', 6000);
  }

  function updateChase(dt, now) {
    const c = S.chase;
    if (!c || c.ended || !S.on) { if (S.chaser) clearChaser(); return false; }
    if (!S.chaser) { S.chaser = makeChaser(); scene.add(S.chaser.g); S.chaseSnd = entSound('chase'); S.chaser.x = 0; }
    const K = S.chaser, t = serverNow(), el = (t - c.t0) / 1000;
    const zEnd = -(c.to + 1) * RD + 1.6;
    const z = el < 0 ? c.z0 : Math.max(zEnd, c.z0 - c.speed * el);
    // чуть смещаемся к ближайшему игроку
    const tx = clamp(S.x, -3.5, 3.5);
    K.x += (tx - K.x) * Math.min(1, dt * 1.5);
    K.g.position.set(K.x, Math.abs(Math.sin(now / 90)) * 0.08, z);
    K.g.visible = el > -3;
    K.legs.forEach((p, k) => { p.rotation.x = Math.sin(now / 70 + k * 1.3) * 0.5; });
    K.mist.forEach((sp, k) => { sp.position.set((Math.random() - 0.5) * 1.6, 0.6 + Math.random() * 1.4, 1 + k * 0.5); sp.material.opacity = 0.4; });
    const dist = Math.hypot(K.x - S.x, z - S.z);
    if (S.chaseSnd) S.chaseSnd.set(el < 0 ? 0.12 : clamp(1.1 - dist / 40, 0.12, 1), 180 + 500 * clamp(1 - dist / 40, 0, 1));
    if (el >= 0 && S.alive && !S.over && dist < 1.9) die('Преследователь');
    return el < 0;
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
      if (S.alive && !S.hidden && !S.over && dist < 2.2) die(ev.type === 'rush' ? 'Вихрь' : 'Эхо');
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
    if (sc.look > 0.25) { scene.remove(sc.sp); S.screech = null; sfx.screech(); say('Ты отогнал Шороха'); }
    else if (sc.t > 1.9) { scene.remove(sc.sp); S.screech = null; sfx.screech(); damage(25, 'Шорох'); say('Шорох укусил тебя!'); }
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
    const flickEv = updateEvent();
    const flickCh = updateChase(dt, now);
    const flick = flickEv || flickCh;
    updateScreech(dt, now);

    for (const R of S.rooms.values()) {
      const dim = flick && Math.random() < 0.5;
      R.lamp.intensity = R.broken ? 0 : R.base * (dim ? 0.12 : 1);
      const lampOn = !R.broken && R.base > 0 && !dim;
      for (const lm of R.lampMeshes) lm.material = lampOn ? M.lamp : M.lampOff;
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
      updateFeed();
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
    clearChaser();
    S.chase = m.chase ? { ...m.chase, ended: false } : null;
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
    say(S.front ? `Ты присоединился к забегу (комната ${S.front})` : 'Найди дверь в конце комнаты. Помни: от Вихря и Эха прячься в шкафу!', 5000);
  }

  function onMessage(m) {
    switch (m.type) {
      case 'init':
        chatMsgs.length = 0;
        (m.chat || []).forEach((c) => addChat(c, false));
        if (S.on) Net.send({ type: 'd_join' }); // переподключение
        break;
      case 'chat':
        addChat(m.msg, true);
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
        for (let k = S.front; k < m.front; k++) openDoorLocal(k);
        S.front = m.front; S.pending = false;
        syncRooms(curRoom(S.z));
        sfx.door();
        say(`Дверь ${pad4(m.front)} открыта`);
        break;
      case 'd_chase': if (S.ready && S.on) startChase(m.chase); break;
      case 'd_chase_end':
        if (S.chase && !S.chase.ended) { S.chase.ended = true; sfx.door(); say('Дверь 0000 открыта. Погоня окончена!', 4000); }
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
    closeChat();
    clearChaser();
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

  // ---------- чат (тот же, что на сайте) ----------
  const chatMsgs = [];
  function addChat(m, fresh) {
    chatMsgs.push({ ...m, _t: fresh ? Date.now() : 0 });
    if (chatMsgs.length > 60) chatMsgs.shift();
    if (fresh && !S.chatOpen && !m.system) S.unread++;
    renderChat();
  }
  function chatLine(m) {
    const d = document.createElement('div');
    if (m.system) { d.className = 'sys'; d.textContent = m.text; return d; }
    const b = document.createElement('b'); b.textContent = m.nick;
    d.append(b, ' ' + m.text);
    return d;
  }
  function renderChat() {
    const list = $('drChatList');
    list.replaceChildren(...chatMsgs.map(chatLine));
    list.scrollTop = list.scrollHeight;
    $('drChatBtn').textContent = '💬' + (S.unread ? ' ' + S.unread : '');
  }
  function updateFeed() { // последние сообщения поверх игры, пока чат закрыт
    const now = Date.now();
    const recent = S.chatOpen ? [] : chatMsgs.filter((m) => m._t && now - m._t < 8000 && !m.system).slice(-3);
    $('drFeed').replaceChildren(...recent.map(chatLine));
  }
  function openChat() {
    if (!S.on) return;
    S.chatOpen = true; S.unread = 0;
    keys.clear(); touch.x = touch.y = 0;
    if (document.pointerLockElement) document.exitPointerLock();
    $('drChat').hidden = false;
    renderChat();
    $('drChatInput').focus();
  }
  function closeChat() {
    S.chatOpen = false;
    $('drChat').hidden = true;
    $('drChatInput').blur();
  }
  $('drChatBtn').addEventListener('click', () => (S.chatOpen ? closeChat() : openChat()));
  $('drChatForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('drChatInput').value.trim();
    if (!text) return;
    Net.send({ type: 'chat', nick: Net.nick(), text });
    $('drChatInput').value = '';
  });

  // ---------- ввод ----------
  document.addEventListener('keydown', (e) => {
    if (!S.on) return;
    if (e.target && e.target.tagName === 'INPUT') { // набираем сообщение
      if (e.code === 'Escape') closeChat();
      return;
    }
    if (e.code === 'Enter' || e.code === 'KeyT') { e.preventDefault(); openChat(); return; }
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
    _test: {
      evState, genRoom, mulberry,
      smoke(fakeT, msg) { // прогон построения комнат и кадра с подставным three.js (для проверки без браузера)
        T = fakeT; initGL(); S.on = true;
        resetRun(msg);
        for (let k = 0; k < 3; k++) frame(1000 + k * 16);
        return { rooms: [...S.rooms.keys()], chase: !!S.chase, chaser: !!S.chaser };
      },
    },
  };
})();
