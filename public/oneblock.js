(() => {
  'use strict';
  // OneBlock: общий остров с одним блоком. Мир и выдачу дропа держит сервер, клиент рисует мир (three.js),
  // двигает игрока и считает крафт. Все текстуры нарисованы кодом; свои файлы можно положить в public/textures/<имя>.png.
  const root = document.getElementById('oneblockTab');
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
  const NAMES = { 1: 'Трава', 2: 'Земля', 3: 'Камень', 4: 'Булыжник', 5: 'Песок', 6: 'Дерево', 7: 'Доски', 8: 'Стекло', 9: 'Кирпичи', 10: 'Верстак' };
  const REACH = 5.5, STACK = 64;
  // рецепты: форма (0 — пусто), id результата и количество; 3×2 и больше — только на верстаке
  const RECIPES = [
    { pat: [[6]], out: 7, n: 4 }, // дерево -> 4 доски
    { pat: [[7, 7], [7, 7]], out: 10, n: 1 }, // 4 доски -> верстак
    { pat: [[5, 5], [5, 5]], out: 8, n: 4 }, // 4 песка -> 4 стекла
    { pat: [[4, 4, 4], [4, 4, 4]], out: 9, n: 8 }, // 6 булыжников (3×2) -> 8 кирпичей
  ];

  function mulberry(a) {
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- крафт и инвентарь (чистая логика) ----------
  function craftResult(cells, size) {
    let r0 = size, r1 = -1, c0 = size, c1 = -1;
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
      if (cells[r * size + c]) { r0 = Math.min(r0, r); r1 = Math.max(r1, r); c0 = Math.min(c0, c); c1 = Math.max(c1, c); }
    }
    if (r1 < 0) return null;
    const h = r1 - r0 + 1, w = c1 - c0 + 1;
    for (const rc of RECIPES) {
      if (rc.pat.length !== h || rc.pat[0].length !== w) continue;
      let ok = true;
      for (let r = 0; r < h && ok; r++) for (let c = 0; c < w; c++) {
        const cell = cells[(r0 + r) * size + c0 + c];
        if ((cell ? cell.id : 0) !== rc.pat[r][c]) { ok = false; break; }
      }
      if (ok) return { id: rc.out, n: rc.n };
    }
    return null;
  }

  function addTo(inv, id, n) { // возвращает, сколько не поместилось
    for (const s of inv) if (n > 0 && s && s.id === id && s.n < STACK) { const m = Math.min(STACK - s.n, n); s.n += m; n -= m; }
    for (let i = 0; i < inv.length && n > 0; i++) if (!inv[i]) { const m = Math.min(STACK, n); inv[i] = { id, n: m }; n -= m; }
    return n;
  }
  const canAddTo = (inv, id) => inv.some((s) => !s || (s.id === id && s.n < STACK));

  // ---------- текстуры блоков 16×16 (оригинальные, рисуются кодом) ----------
  const TEX = {};
  const shade = (hex, d) => {
    const n = parseInt(hex.slice(1), 16);
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => clamp(Math.round(v + d), 0, 255));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  };
  function tex(name, seed, draw) {
    const c = document.createElement('canvas'); c.width = c.height = 16;
    draw(c.getContext('2d'), mulberry(seed));
    TEX[name] = c;
  }
  const noise = (g, r, base, amp, y0 = 0, y1 = 16) => {
    for (let y = y0; y < y1; y++) for (let x = 0; x < 16; x++) { g.fillStyle = shade(base, (r() - 0.5) * amp); g.fillRect(x, y, 1, 1); }
  };
  function makeTextures() {
    tex('dirt', 1, (g, r) => { noise(g, r, '#7a5230', 38); for (let k = 0; k < 10; k++) { g.fillStyle = '#4a2f18'; g.fillRect(Math.floor(r() * 15), Math.floor(r() * 15), 2, 1); } });
    tex('grass_top', 2, (g, r) => noise(g, r, '#5aa03c', 44));
    tex('grass_side', 3, (g, r) => {
      noise(g, r, '#7a5230', 38);
      for (let x = 0; x < 16; x++) { const d = 3 + Math.floor(r() * 3); for (let y = 0; y < d; y++) { g.fillStyle = shade('#5aa03c', (r() - 0.5) * 44); g.fillRect(x, y, 1, 1); } }
    });
    tex('stone', 4, (g, r) => { noise(g, r, '#8c8c8c', 30); for (let k = 0; k < 14; k++) { g.fillStyle = r() < 0.5 ? '#6a6a6a' : '#a4a4a4'; g.fillRect(Math.floor(r() * 15), Math.floor(r() * 15), 2, 1); } });
    tex('cobblestone', 5, (g, r) => {
      g.fillStyle = '#3a3a3a'; g.fillRect(0, 0, 16, 16);
      for (let row = 0; row < 4; row++) {
        let x = -Math.floor(r() * 3);
        while (x < 16) {
          const w = 4 + Math.floor(r() * 3);
          g.fillStyle = shade('#7a7a7a', (r() - 0.5) * 50);
          g.fillRect(Math.max(0, x), row * 4, Math.min(16, x + w - 1) - Math.max(0, x), 3);
          x += w;
        }
      }
    });
    tex('sand', 6, (g, r) => noise(g, r, '#dbc98a', 26));
    tex('log_side', 7, (g, r) => { for (let x = 0; x < 16; x++) { const base = x % 4 === 0 ? '#4e341c' : '#6a4a2a'; for (let y = 0; y < 16; y++) { g.fillStyle = shade(base, (r() - 0.5) * 20); g.fillRect(x, y, 1, 1); } } });
    tex('log_top', 8, (g, r) => {
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
        g.fillStyle = d > 7 ? '#5a3c20' : shade(Math.floor(d / 2) % 2 ? '#8f6c3c' : '#b8925a', (r() - 0.5) * 14);
        g.fillRect(x, y, 1, 1);
      }
    });
    const planks = (g, r) => {
      noise(g, r, '#b88d56', 24);
      for (let row = 0; row < 4; row++) {
        g.fillStyle = '#7a5a30'; g.fillRect(0, row * 4 + 3, 16, 1);
        g.fillRect(Math.floor(r() * 14) + 1, row * 4, 1, 3);
      }
    };
    tex('planks', 9, planks);
    tex('glass', 10, (g) => {
      g.fillStyle = 'rgba(190,225,245,0.22)'; g.fillRect(0, 0, 16, 16);
      g.strokeStyle = 'rgba(235,248,255,0.95)'; g.lineWidth = 1; g.strokeRect(0.5, 0.5, 15, 15);
      g.fillStyle = 'rgba(255,255,255,0.85)'; for (const [x, y] of [[3, 3], [4, 4], [5, 5], [3, 7], [4, 8]]) g.fillRect(x, y, 1, 1);
    });
    tex('bricks', 11, (g, r) => {
      g.fillStyle = '#b4aca0'; g.fillRect(0, 0, 16, 16);
      for (let row = 0; row < 4; row++) {
        for (let x = row % 2 ? -4 : 0; x < 16; x += 8) {
          g.fillStyle = shade('#a8483a', (r() - 0.5) * 36);
          g.fillRect(Math.max(0, x), row * 4, Math.min(16, x + 7) - Math.max(0, x), 3);
        }
      }
    });
    tex('table_top', 12, (g, r) => {
      planks(g, r); g.fillStyle = '#4a2c14';
      for (const p of [5, 10]) { g.fillRect(p, 0, 1, 16); g.fillRect(0, p, 16, 1); }
    });
    tex('table_side', 13, (g, r) => { planks(g, r); g.fillStyle = '#5a3a1c'; g.fillRect(0, 12, 16, 4); g.fillStyle = '#9a9a9a'; g.fillRect(3, 4, 6, 2); g.fillStyle = '#6a4a2a'; g.fillRect(9, 4, 3, 2); });
    tex('table_front', 14, (g, r) => { planks(g, r); g.fillStyle = '#5a3a1c'; g.fillRect(0, 12, 16, 4); g.fillStyle = '#7a7a7a'; g.fillRect(4, 3, 2, 6); g.fillRect(9, 5, 4, 2); });
  }
  const FACES = { // порядок граней: +x, -x, верх, низ, +z, -z
    1: ['grass_side', 'grass_side', 'grass_top', 'dirt', 'grass_side', 'grass_side'],
    2: Array(6).fill('dirt'), 3: Array(6).fill('stone'), 4: Array(6).fill('cobblestone'), 5: Array(6).fill('sand'),
    6: ['log_side', 'log_side', 'log_top', 'log_top', 'log_side', 'log_side'], 7: Array(6).fill('planks'), 8: Array(6).fill('glass'),
    9: Array(6).fill('bricks'), 10: ['table_side', 'table_side', 'table_top', 'planks', 'table_front', 'table_side'],
  };

  const ICONS = new Map();
  function iconFor(id) { // миниатюра блока (кубик), строится из тех же текстур
    if (ICONS.has(id)) return ICONS.get(id);
    const c = document.createElement('canvas'); c.width = 40; c.height = 44;
    const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
    const f = FACES[id], top = TEX[f[2]], side = TEX[f[4]];
    g.setTransform(1.25 * 16 / top.width, 0.625 * 16 / top.width, -1.25 * 16 / top.width, 0.625 * 16 / top.width, 20, 2); g.drawImage(top, 0, 0);
    g.setTransform(1.25 * 16 / side.width, 0.625 * 16 / side.width, 0, 1.25 * 16 / side.height, 0, 12); g.drawImage(side, 0, 0);
    g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = 'rgba(0,0,0,0.22)'; g.beginPath(); g.moveTo(0, 12); g.lineTo(20, 22); g.lineTo(20, 42); g.lineTo(0, 32); g.fill();
    g.setTransform(1.25 * 16 / side.width, -0.625 * 16 / side.width, 0, 1.25 * 16 / side.height, 20, 22); g.drawImage(side, 0, 0);
    g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = 'rgba(0,0,0,0.42)'; g.beginPath(); g.moveTo(20, 22); g.lineTo(40, 12); g.lineTo(40, 32); g.lineTo(20, 42); g.fill();
    const url = c.toDataURL();
    ICONS.set(id, url);
    return url;
  }
  const avgColor = (id) => {
    const cv = TEX[FACES[id][4]], d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 40) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
    return n ? (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n) : 0x999999;
  };

  // ---------- состояние ----------
  const S = {
    on: false, ready: false, x: 2.5, y: 1.01, z: 2.5, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: false, sprint: false, third: false,
    inv: Array(36).fill(null), sel: 0, held: null, craft: { size: 2, cells: Array(4).fill(null) }, ui: null,
    target: null, count: 0, peers: new Map(), parts: [], msgUntil: 0, mouseDown: false, lastBreak: 0, lastSend: 0, lastHud: 0, chatOpen: false, unread: 0,
  };
  const W = new Map(); // "x,y,z" -> { x, y, z, id, pop }
  const keys = new Set();
  const touch = { x: 0, y: 0 };
  const pointers = new Map();
  const wkey = (x, y, z) => `${x},${y},${z}`;
  const chatMsgs = [];
  let T = null, renderer, scene, camera, viewEl, rafId = 0, dirty = true;
  let insts = {}, hl, me, sunLight;
  const MAT = {}, TX = {};

  try { const sv = JSON.parse(localStorage.getItem('obInv') || 'null'); if (Array.isArray(sv) && sv.length === 36) S.inv = sv.map((s) => (s && NAMES[s.id] ? { id: s.id, n: clamp(s.n | 0, 1, STACK) } : null)); } catch { /* пустой инвентарь */ }
  const saveInv = () => localStorage.setItem('obInv', JSON.stringify(S.inv));

  // ---------- разметка ----------
  const style = document.createElement('style');
  style.textContent = `
    #oneblockTab { min-height: 0; overflow: auto; }
    .ob-land { max-width: 640px; margin: 0 auto; padding: 24px 18px; }
    .ob-land h2 { font-size: 36px; letter-spacing: 6px; margin: 0 0 6px; font-weight: 700; }
    .ob-land p, .ob-land li { color: var(--muted); font-size: 14px; line-height: 1.55; }
    .ob-land b { color: var(--text); }
    #obStage { position: fixed; inset: 0; z-index: 70; background: #000; user-select: none; -webkit-user-select: none; touch-action: none; }
    #obView, #obView canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; }
    #obCross { position: absolute; left: 50%; top: 50%; width: 18px; height: 18px; margin: -9px; pointer-events: none; }
    #obCross::before, #obCross::after { content: ''; position: absolute; background: rgba(255,255,255,.85); mix-blend-mode: difference; }
    #obCross::before { left: 8px; top: 0; width: 2px; height: 18px; } #obCross::after { top: 8px; left: 0; height: 2px; width: 18px; }
    #obTop { position: absolute; top: 12px; left: 0; right: 0; text-align: center; font-family: var(--mono); font-size: 14px; color: #fff; text-shadow: 0 0 5px #000; pointer-events: none; }
    #obMsg { position: absolute; left: 0; right: 0; bottom: 84px; text-align: center; font-size: 15px; color: #fff; text-shadow: 0 0 5px #000; pointer-events: none; min-height: 20px; }
    #obHotbar { position: absolute; left: 50%; bottom: 10px; transform: translateX(-50%); display: flex; gap: 3px; padding: 4px; background: rgba(0,0,0,.55); border-radius: 8px; z-index: 3; }
    .slot { position: relative; width: 44px; height: 44px; border: 2px solid #555; background: rgba(40,40,40,.85); border-radius: 4px; display: grid; place-items: center; cursor: pointer; }
    .slot.sel { border-color: #f2d98d; box-shadow: 0 0 6px #f2d98d; }
    .slot img { width: 34px; height: 37px; image-rendering: pixelated; pointer-events: none; }
    .slot i { position: absolute; right: 3px; bottom: 1px; font-style: normal; font-size: 12px; font-weight: 700; color: #fff; text-shadow: 1px 1px 0 #000; pointer-events: none; }
    #obExit { position: absolute; top: 10px; left: 10px; z-index: 4; opacity: .85; }
    #obChatBtn { position: absolute; top: 10px; right: 10px; z-index: 5; opacity: .85; }
    #obInvBtn { position: absolute; top: 52px; right: 10px; z-index: 5; opacity: .85; }
    #obFeed { position: absolute; right: 56px; top: 12px; width: min(300px, 62vw); font-size: 13px; text-align: right; color: #fff; text-shadow: 0 0 5px #000; pointer-events: none; }
    #obChat { position: absolute; right: 10px; top: 94px; z-index: 5; width: min(330px, calc(100vw - 20px)); height: min(40vh, 280px); display: flex; flex-direction: column; background: rgba(0,0,0,.85); border: 1px solid var(--line); border-radius: 8px; }
    #obChatList { flex: 1; overflow: auto; padding: 8px 10px; font-size: 13px; display: flex; flex-direction: column; gap: 4px; color: #eee; }
    #obChatList b { color: var(--moon); } #obChatList .sys { color: var(--muted); font-style: italic; }
    #obChatForm { display: flex; gap: 6px; padding: 8px; border-top: 1px solid var(--line); } #obChatForm input { flex: 1; min-width: 0; }
    #obInvUI { position: absolute; inset: 0; z-index: 6; display: grid; place-items: center; background: rgba(0,0,0,.55); }
    #obInvUI .panel { background: #2b2b2b; border: 2px solid #555; border-radius: 8px; padding: 12px; width: min(94vw, 470px); color: #eee; }
    #obInvUI h4 { margin: 0 0 8px; font-size: 14px; }
    #obInvUI .craft { display: flex; align-items: center; gap: 14px; margin-bottom: 12px; }
    #obInvUI .grid { display: grid; gap: 3px; }
    #obInvUI .inv { grid-template-columns: repeat(9, 1fr); }
    #obInvUI .slot { width: auto; aspect-ratio: 1; height: auto; min-width: 0; }
    #obInvUI .sep { height: 8px; }
    #obInvUI .close { float: right; }
    #obHeld { position: fixed; z-index: 9; width: 36px; height: 40px; pointer-events: none; transform: translate(-50%, -50%); }
    #obHeld img { width: 100%; height: 100%; image-rendering: pixelated; } #obHeld i { position: absolute; right: 0; bottom: 0; font-style: normal; font-size: 12px; font-weight: 700; color: #fff; text-shadow: 1px 1px 0 #000; }
    #obTouch { display: none; }
    #obTouch button { position: absolute; z-index: 4; width: 58px; height: 58px; border-radius: 50%; font-size: 20px; opacity: .75; }
    @media (pointer: coarse) { #obTouch { display: block; } }
  `;
  document.head.appendChild(style);

  root.innerHTML = `
    <div class="ob-land">
      <h2>ONEBLOCK</h2>
      <p>Общий остров с <b>одним блоком</b>. Разбил блок — он исчезает, ты получаешь его, а на его месте сразу появляется другой.
      Из добытых блоков строй остров, делай доски, верстак, стекло и кирпичи. Все посетители сайта играют в одном мире и видят друг друга.</p>
      <ul>
        <li><b>ЛКМ</b> — разбить блок (можно зажать), <b>ПКМ</b> — поставить блок или открыть верстак (с Ctrl — поставить блок на верстак).</li>
        <li><b>WASD</b> — ходить, <b>Пробел</b> — прыжок, <b>Shift</b> — бег, <b>V</b> — вид от третьего лица (видно свою модель).</li>
        <li><b>1–9</b> и колесо мыши — слоты, <b>E</b> — инвентарь на 36 слотов (крафт 2×2), <b>Enter</b> или <b>T</b> — чат.</li>
        <li>Рецепты: дерево → 4 доски; 4 доски → верстак; 4 песка → 4 стекла; 6 булыжников (3×2) на верстаке → 8 кирпичей.</li>
        <li>На телефоне: левая половина экрана — джойстик, правая — обзор; кнопки справа: ⛏ разбить, ▣ поставить, ⤒ прыжок, ⇧ бег.</li>
      </ul>
      <p id="obCountLand" class="muted">Загляни на остров…</p>
      <button class="run" id="obPlay">Играть</button>
    </div>
    <div id="obStage" hidden>
      <div id="obView"></div>
      <div id="obCross"></div>
      <div id="obTop"><span id="obInfo"></span></div>
      <div id="obMsg"></div>
      <div id="obHotbar"></div>
      <button id="obExit">← Выйти</button>
      <button id="obChatBtn" title="Чат (Enter или T)">💬</button>
      <button id="obInvBtn" title="Инвентарь (E)">🎒</button>
      <div id="obFeed"></div>
      <div id="obChat" hidden>
        <div id="obChatList"></div>
        <form id="obChatForm"><input type="text" id="obChatInput" maxlength="500" placeholder="Сообщение" autocomplete="off"><button>→</button></form>
      </div>
      <div id="obInvUI" hidden></div>
      <div id="obHeld" hidden></div>
      <div id="obTouch">
        <button id="obBBreak" style="right:18px;bottom:130px">⛏</button>
        <button id="obBPlace" style="right:90px;bottom:100px">▣</button>
        <button id="obBJump" style="right:18px;bottom:62px">⤒</button>
        <button id="obBRun" style="right:90px;bottom:34px">⇧</button>
      </div>
    </div>`;

  // ---------- графика ----------
  const loadThree = () => (window.THREE ? Promise.resolve() : new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = THREE_URL; s.onload = res; s.onerror = () => rej(new Error('three.js не загрузился'));
    document.head.appendChild(s);
  }));

  function texture(name) {
    if (!TX[name]) {
      const t = new T.CanvasTexture(TEX[name]);
      t.magFilter = T.NearestFilter; t.minFilter = T.NearestFilter;
      TX[name] = t;
    }
    return TX[name];
  }
  function materialsFor(id) {
    if (!MAT[id]) {
      MAT[id] = FACES[id].map((n) => new T.MeshLambertMaterial({ map: texture(n), transparent: id === 8, alphaTest: id === 8 ? 0.02 : 0 }));
    }
    return MAT[id];
  }
  function loadOverrides() { // необязательные свои текстуры: public/textures/<имя>.png
    for (const k of Object.keys(TEX)) {
      const img = new Image();
      img.onload = () => {
        const c = TEX[k]; c.width = img.width; c.height = img.height;
        const g = c.getContext('2d'); g.imageSmoothingEnabled = false; g.clearRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0);
        if (TX[k]) TX[k].needsUpdate = true;
        ICONS.clear(); if (S.on) { renderHotbar(); if (S.ui) renderUI(); }
      };
      img.src = 'textures/' + k + '.png';
    }
  }

  function initGL() {
    if (renderer) return;
    viewEl = $('obView');
    renderer = new T.WebGLRenderer({ antialias: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    viewEl.appendChild(renderer.domElement);
    scene = new T.Scene();
    scene.background = new T.Color(0x87b8e8);
    scene.fog = new T.Fog(0x87b8e8, 24, 80);
    camera = new T.PerspectiveCamera(75, 1, 0.05, 120);
    camera.rotation.order = 'YXZ';
    scene.add(new T.AmbientLight(0xffffff, 0.62));
    sunLight = new T.DirectionalLight(0xffffff, 0.75); sunLight.position.set(8, 20, 6); scene.add(sunLight);
    const box = new T.BoxGeometry(1, 1, 1);
    for (let id = 1; id <= 10; id++) {
      const im = new T.InstancedMesh(box, materialsFor(id), 6500);
      im.count = 0; im.frustumCulled = false; scene.add(im); insts[id] = im;
    }
    hl = new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(1.004, 1.004, 1.004)), new T.LineBasicMaterial({ color: 0x000000 }));
    hl.visible = false; scene.add(hl);
    me = makePlayerModel('Я'); me.visible = false; scene.add(me);
    loadOverrides();
    resize();
  }
  function resize() {
    if (!renderer) return;
    const w = viewEl.clientWidth || window.innerWidth, h = viewEl.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);

  const dummy = () => T.Object3D && new T.Object3D();
  let dum = null;
  function rebuild(now) {
    dum = dum || dummy();
    const n = {};
    for (let id = 1; id <= 10; id++) n[id] = 0;
    let popping = false;
    for (const b of W.values()) {
      const im = insts[b.id];
      if (!im || n[b.id] >= 6500) continue;
      let sc = 1;
      if (b.pop && now - b.pop < 160) { sc = 0.55 + 0.45 * ((now - b.pop) / 160); popping = true; }
      dum.position.set(b.x + 0.5, b.y + 0.5, b.z + 0.5); dum.scale.set(sc, sc, sc); dum.updateMatrix();
      im.setMatrixAt(n[b.id]++, dum.matrix);
    }
    for (let id = 1; id <= 10; id++) { insts[id].count = n[id]; insts[id].instanceMatrix.needsUpdate = true; }
    dirty = popping;
  }

  // частицы при разрушении блока
  const bits = [];
  function burst(b) {
    const col = avgColor(b.id), geo = new T.BoxGeometry(0.12, 0.12, 0.12);
    for (let k = 0; k < 9; k++) {
      const m = new T.Mesh(geo, new T.MeshBasicMaterial({ color: col }));
      m.position.set(b.x + 0.2 + Math.random() * 0.6, b.y + 0.2 + Math.random() * 0.6, b.z + 0.2 + Math.random() * 0.6);
      m.userData = { v: [(Math.random() - 0.5) * 3, 1.5 + Math.random() * 2.5, (Math.random() - 0.5) * 3], life: 0.55 };
      scene.add(m); bits.push(m);
    }
  }
  function stepBits(dt) {
    for (let i = bits.length - 1; i >= 0; i--) {
      const m = bits[i], u = m.userData;
      u.life -= dt; u.v[1] -= 12 * dt;
      m.position.x += u.v[0] * dt; m.position.y += u.v[1] * dt; m.position.z += u.v[2] * dt;
      if (u.life <= 0) { scene.remove(m); m.material.dispose(); bits.splice(i, 1); }
    }
  }

  // ---------- модели игроков (простая кубическая фигура, оригинальный дизайн) ----------
  const hash = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7) >>> 0;
  function textSprite(text, w, h, font, fg, bg) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    if (bg) { g.fillStyle = bg; g.beginPath(); g.roundRect ? g.roundRect(0, 0, w, h, 14) : g.rect(0, 0, w, h); g.fill(); }
    g.fillStyle = fg; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h / 2);
    const sp = new T.Sprite(new T.SpriteMaterial({ map: new T.CanvasTexture(c), transparent: true, depthTest: false }));
    sp.renderOrder = 10;
    return sp;
  }
  function makePlayerModel(nick) {
    const hue = hash(nick) % 360;
    const L = (c) => new T.MeshLambertMaterial({ color: c });
    const skin = L(0xf0c8a0), hair = L(new T.Color(`hsl(${(hue + 40) % 360},45%,22%)`)), shirt = L(new T.Color(`hsl(${hue},60%,48%)`)), pants = L(new T.Color(`hsl(${(hue + 200) % 360},40%,28%)`));
    const fc = document.createElement('canvas'); fc.width = fc.height = 16;
    const fg = fc.getContext('2d');
    fg.fillStyle = '#f0c8a0'; fg.fillRect(0, 0, 16, 16);
    fg.fillStyle = '#fff'; fg.fillRect(3, 6, 4, 3); fg.fillRect(9, 6, 4, 3);
    fg.fillStyle = '#2a3a8a'; fg.fillRect(5, 6, 2, 3); fg.fillRect(9, 6, 2, 3);
    fg.fillStyle = '#a0584a'; fg.fillRect(5, 11, 6, 1);
    const ft = new T.CanvasTexture(fc); ft.magFilter = T.NearestFilter;
    const g = new T.Group();
    const head = new T.Mesh(new T.BoxGeometry(0.45, 0.45, 0.45), [skin, skin, hair, skin, new T.MeshLambertMaterial({ map: ft }), hair]);
    head.position.y = 1.625; g.add(head);
    const body = new T.Mesh(new T.BoxGeometry(0.5, 0.7, 0.25), shirt); body.position.y = 1.05; g.add(body);
    const limb = (geo, mat, x, y) => { const p = new T.Group(); p.position.set(x, y, 0); const m = new T.Mesh(geo, mat); m.position.y = -0.35; p.add(m); g.add(p); return p; };
    const armG = new T.BoxGeometry(0.2, 0.7, 0.2), legG = new T.BoxGeometry(0.24, 0.7, 0.24);
    g.userData = {
      armL: limb(armG, shirt, -0.36, 1.4), armR: limb(armG, shirt, 0.36, 1.4), legL: limb(legG, pants, -0.13, 0.7), legR: limb(legG, pants, 0.13, 0.7),
    };
    const label = textSprite(nick, 256, 56, '600 30px system-ui', '#fff', 'rgba(0,0,0,.45)');
    label.scale.set(1.5, 0.33, 1); label.position.y = 2.25; g.add(label);
    g.userData.label = label; g.userData.nick = nick;
    return g;
  }
  function animateModel(g, speed, now) {
    const s = Math.sin(now / 110) * clamp(speed, 0, 1) * 0.9, u = g.userData;
    u.armL.rotation.x = s; u.armR.rotation.x = -s; u.legL.rotation.x = -s; u.legR.rotation.x = s;
  }
  function bubble(model, text) {
    const u = model.userData;
    if (u.bubble) { model.remove(u.bubble); u.bubble = null; }
    const t = text.length > 40 ? text.slice(0, 40) + '…' : text;
    const sp = textSprite(t, 512, 64, '28px system-ui', '#111', 'rgba(255,255,255,.92)');
    sp.scale.set(2.8, 0.35, 1); sp.position.y = 2.65; model.add(sp);
    u.bubble = sp; u.bubbleUntil = performance.now() + 5000;
  }

  // ---------- мир: столкновения и луч ----------
  function collides(px, py, pz) {
    const x0 = Math.floor(px - 0.3), x1 = Math.floor(px + 0.3), y0 = Math.floor(py), y1 = Math.floor(py + 1.79), z0 = Math.floor(pz - 0.3), z1 = Math.floor(pz + 0.3);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) if (W.has(wkey(x, y, z))) return true;
    return false;
  }

  function raycast(ox, oy, oz, dx, dy, dz, maxD) { // обход вокселей (Amanatides–Woo)
    let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
    const sx = Math.sign(dx), sy = Math.sign(dy), sz = Math.sign(dz);
    const tdx = dx ? Math.abs(1 / dx) : Infinity, tdy = dy ? Math.abs(1 / dy) : Infinity, tdz = dz ? Math.abs(1 / dz) : Infinity;
    let tmx = dx > 0 ? (x + 1 - ox) * tdx : dx < 0 ? (ox - x) * tdx : Infinity;
    let tmy = dy > 0 ? (y + 1 - oy) * tdy : dy < 0 ? (oy - y) * tdy : Infinity;
    let tmz = dz > 0 ? (z + 1 - oz) * tdz : dz < 0 ? (oz - z) * tdz : Infinity;
    let t = 0, fx = 0, fy = 0, fz = 0;
    while (t <= maxD) {
      const b = W.get(wkey(x, y, z));
      if (b) return { x, y, z, nx: fx, ny: fy, nz: fz, b };
      if (tmx < tmy && tmx < tmz) { x += sx; t = tmx; tmx += tdx; fx = -sx; fy = 0; fz = 0; }
      else if (tmy < tmz) { y += sy; t = tmy; tmy += tdy; fx = 0; fy = -sy; fz = 0; }
      else { z += sz; t = tmz; tmz += tdz; fx = 0; fy = 0; fz = -sz; }
    }
    return null;
  }

  // ---------- действия ----------
  const popSound = () => {
    try {
      popSound.ctx = popSound.ctx || new (window.AudioContext || window.webkitAudioContext)();
      const c = popSound.ctx, o = c.createOscillator(), g = c.createGain(), t = c.currentTime;
      o.type = 'square'; o.frequency.setValueAtTime(320, t); o.frequency.exponentialRampToValueAtTime(90, t + 0.08);
      g.gain.setValueAtTime(0.08, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + 0.1);
    } catch { /* звук необязателен */ }
  };
  function say(text, ms) {
    $('obMsg').textContent = text;
    S.msgUntil = performance.now() + (ms || 1800);
  }

  function doBreak() {
    const h = S.target;
    if (!h || S.ui) return;
    if (h.x === 0 && h.y === 0 && h.z === 0) return say('Основу острова сломать нельзя');
    if (!canAddTo(S.inv, h.b.id)) return say('Инвентарь полон');
    Net.send({ type: 'o_break', x: h.x, y: h.y, z: h.z });
  }

  function intersectsMe(x, y, z) {
    return x + 1 > S.x - 0.3 && x < S.x + 0.3 && y + 1 > S.y && y < S.y + 1.8 && z + 1 > S.z - 0.3 && z < S.z + 0.3;
  }

  function doUse() {
    const h = S.target;
    if (!h || S.ui) return;
    if (h.b.id === 10 && !keys.has('ControlLeft') && !keys.has('ControlRight')) return openUI(3);
    const slot = S.inv[S.sel];
    if (!slot) return;
    const x = h.x + h.nx, y = h.y + h.ny, z = h.z + h.nz;
    if (W.has(wkey(x, y, z)) || intersectsMe(x, y, z)) return;
    Net.send({ type: 'o_place', x, y, z, t: slot.id });
    slot.n--;
    if (slot.n <= 0) S.inv[S.sel] = null;
    saveInv(); renderHotbar();
  }

  // ---------- инвентарь и крафт (интерфейс) ----------
  function slotHtml(area, i, s, sel) {
    return `<div class="slot${sel ? ' sel' : ''}" data-a="${area}" data-i="${i}" title="${s ? NAMES[s.id] : ''}">${s ? `<img src="${iconFor(s.id)}" alt=""><i>${s.n > 1 ? s.n : ''}</i>` : ''}</div>`;
  }
  function renderHotbar() {
    $('obHotbar').innerHTML = S.inv.slice(0, 9).map((s, i) => slotHtml('hot', i, s, i === S.sel)).join('');
  }
  function renderUI() {
    const c = S.craft, size = c.size, res = craftResult(c.cells, size);
    let inv = '';
    for (let i = 9; i < 36; i++) inv += slotHtml('inv', i, S.inv[i]);
    let hot = '';
    for (let i = 0; i < 9; i++) hot += slotHtml('inv', i, S.inv[i]);
    $('obInvUI').innerHTML = `<div class="panel">
      <button class="close" data-a="close">✕</button>
      <h4>${size === 3 ? 'Верстак' : 'Крафт'}</h4>
      <div class="craft">
        <div class="grid" style="grid-template-columns:repeat(${size},46px)">${c.cells.map((s, i) => slotHtml('craft', i, s)).join('')}</div>
        <span>→</span>
        <div style="width:46px">${slotHtml('out', 0, res ? { id: res.id, n: res.n } : null)}</div>
      </div>
      <h4>Инвентарь (36 слотов)</h4>
      <div class="grid inv">${inv}</div><div class="sep"></div><div class="grid inv">${hot}</div>
      <p class="muted" style="margin:8px 0 0;font-size:12px">Нажми на предмет, чтобы взять, и на слот, чтобы положить. ПКМ — половина или один предмет.</p>
    </div>`;
    renderHeld();
  }
  function renderHeld() {
    const el = $('obHeld'), h = S.held;
    el.hidden = !h || !S.ui;
    if (h) el.innerHTML = `<img src="${iconFor(h.id)}" alt=""><i>${h.n > 1 ? h.n : ''}</i>`;
  }

  function openUI(size) {
    if (S.ui) return;
    S.ui = size === 3 ? 'table' : 'inv';
    S.craft = { size, cells: Array(size * size).fill(null) };
    keys.clear(); touch.x = touch.y = 0;
    if (document.pointerLockElement) document.exitPointerLock();
    $('obInvUI').hidden = false;
    renderUI();
  }
  function closeUI() {
    if (!S.ui) return;
    for (const s of [S.held, ...S.craft.cells]) if (s) addTo(S.inv, s.id, s.n);
    S.held = null; S.ui = null; S.craft = { size: 2, cells: Array(4).fill(null) };
    $('obInvUI').hidden = true; $('obHeld').hidden = true;
    saveInv(); renderHotbar();
  }

  function clickSlot(area, i, right) {
    if (area === 'out') {
      const r = craftResult(S.craft.cells, S.craft.size), h = S.held;
      if (!r || (h && (h.id !== r.id || h.n + r.n > STACK))) return;
      S.craft.cells = S.craft.cells.map((s) => { if (!s) return null; s.n--; return s.n > 0 ? s : null; });
      S.held = h ? { id: h.id, n: h.n + r.n } : { id: r.id, n: r.n };
    } else {
      const arr = area === 'inv' ? S.inv : S.craft.cells, s = arr[i], h = S.held;
      if (!right) {
        if (!h) { if (s) { S.held = s; arr[i] = null; } }
        else if (!s) { arr[i] = h; S.held = null; }
        else if (s.id === h.id) { const m = Math.min(STACK - s.n, h.n); s.n += m; h.n -= m; if (h.n <= 0) S.held = null; }
        else { arr[i] = h; S.held = s; }
      } else if (!h) {
        if (s) { const take = Math.ceil(s.n / 2); S.held = { id: s.id, n: take }; s.n -= take; if (s.n <= 0) arr[i] = null; }
      } else if (!s) { arr[i] = { id: h.id, n: 1 }; h.n--; if (h.n <= 0) S.held = null; }
      else if (s.id === h.id && s.n < STACK) { s.n++; h.n--; if (h.n <= 0) S.held = null; }
      else { arr[i] = h; S.held = s; }
    }
    saveInv(); renderUI(); renderHotbar();
  }

  function slotEvent(e, right) {
    const el = e.target.closest('.slot[data-a], button[data-a]');
    if (!el) return;
    const a = el.dataset.a;
    if (a === 'close') return closeUI();
    if (a === 'hot') { S.sel = Number(el.dataset.i); renderHotbar(); say(S.inv[S.sel] ? NAMES[S.inv[S.sel].id] : '', 1200); return; }
    if (S.ui) clickSlot(a, Number(el.dataset.i), right);
  }
  $('obStage').addEventListener('click', (e) => slotEvent(e, false));
  $('obStage').addEventListener('contextmenu', (e) => { if (e.target.closest('.slot')) { e.preventDefault(); slotEvent(e, true); } else if (S.on) e.preventDefault(); });
  document.addEventListener('pointermove', (e) => { const h = $('obHeld'); if (S.ui) { h.style.left = e.clientX + 'px'; h.style.top = e.clientY + 'px'; } });

  // ---------- чат (общий с сайтом) ----------
  function chatLine(m) {
    const d = document.createElement('div');
    if (m.system) { d.className = 'sys'; d.textContent = m.text; return d; }
    const b = document.createElement('b'); b.textContent = m.nick;
    d.append(b, ' ' + m.text);
    return d;
  }
  function addChat(m, fresh) {
    chatMsgs.push({ ...m, _t: fresh ? Date.now() : 0 });
    if (chatMsgs.length > 60) chatMsgs.shift();
    if (fresh && !S.chatOpen && !m.system) S.unread++;
    $('obChatList').replaceChildren(...chatMsgs.map(chatLine));
    $('obChatList').scrollTop = $('obChatList').scrollHeight;
    $('obChatBtn').textContent = '💬' + (S.unread ? ' ' + S.unread : '');
    if (fresh && !m.system && S.on && T) {
      const peer = [...S.peers.values()].find((p) => p.nick === m.nick);
      if (peer) bubble(peer.g, m.text); else if (m.nick === Net.nick() && me) bubble(me, m.text);
    }
  }
  function updateFeed() {
    const now = Date.now();
    const recent = S.chatOpen ? [] : chatMsgs.filter((m) => m._t && now - m._t < 8000 && !m.system).slice(-3);
    $('obFeed').replaceChildren(...recent.map(chatLine));
  }
  function openChat() {
    if (!S.on || S.ui) return;
    S.chatOpen = true; S.unread = 0; keys.clear(); touch.x = touch.y = 0;
    if (document.pointerLockElement) document.exitPointerLock();
    $('obChat').hidden = false; $('obChatBtn').textContent = '💬';
    $('obChatInput').focus();
  }
  function closeChat() { S.chatOpen = false; $('obChat').hidden = true; $('obChatInput').blur(); }
  $('obChatBtn').addEventListener('click', () => (S.chatOpen ? closeChat() : openChat()));
  $('obInvBtn').addEventListener('click', () => (S.ui ? closeUI() : openUI(2)));
  $('obChatForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('obChatInput').value.trim();
    if (!text) return;
    Net.send({ type: 'chat', nick: Net.nick(), text });
    $('obChatInput').value = '';
  });

  // ---------- ввод ----------
  document.addEventListener('keydown', (e) => {
    if (!S.on) return;
    if (e.target && e.target.tagName === 'INPUT') { if (e.code === 'Escape') closeChat(); return; }
    if (e.code === 'Enter' || e.code === 'KeyT') { e.preventDefault(); openChat(); return; }
    if (e.code === 'KeyE') { e.preventDefault(); S.ui ? closeUI() : openUI(2); return; }
    if (e.code === 'Escape' && S.ui) { closeUI(); return; }
    if (e.code === 'KeyV' && !e.repeat) S.third = !S.third;
    if (/^Digit[1-9]$/.test(e.code)) { S.sel = Number(e.code.slice(5)) - 1; renderHotbar(); say(S.inv[S.sel] ? NAMES[S.inv[S.sel].id] : '', 1200); }
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    keys.add(e.code);
  });
  document.addEventListener('keyup', (e) => keys.delete(e.code));
  document.addEventListener('mousemove', (e) => {
    if (!S.on || !viewEl || document.pointerLockElement !== viewEl) return;
    S.yaw -= e.movementX * 0.0022;
    S.pitch = clamp(S.pitch - e.movementY * 0.0022, -1.5, 1.5);
  });
  document.addEventListener('wheel', (e) => {
    if (!S.on || S.ui || S.chatOpen) return;
    S.sel = (S.sel + (e.deltaY > 0 ? 1 : 8)) % 9; renderHotbar();
  }, { passive: true });
  document.addEventListener('mouseup', () => { S.mouseDown = false; });

  root.addEventListener('pointerdown', (e) => {
    if (!S.on || S.ui || !e.target.closest('#obView')) return;
    if (e.pointerType !== 'touch') {
      if (document.pointerLockElement !== viewEl && viewEl.requestPointerLock) { viewEl.requestPointerLock(); return; }
      if (e.button === 0) { S.mouseDown = true; doBreak(); S.lastBreak = performance.now(); }
      else if (e.button === 2) doUse();
      return;
    }
    pointers.set(e.pointerId, { mover: e.clientX < window.innerWidth / 2, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY });
  });
  root.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    if (p.mover) { touch.x = clamp((e.clientX - p.sx) / 55, -1, 1); touch.y = clamp((e.clientY - p.sy) / 55, -1, 1); }
    else { S.yaw -= (e.clientX - p.x) * 0.006; S.pitch = clamp(S.pitch - (e.clientY - p.y) * 0.006, -1.5, 1.5); }
    p.x = e.clientX; p.y = e.clientY;
  });
  const endPtr = (e) => { const p = pointers.get(e.pointerId); if (p && p.mover) touch.x = touch.y = 0; pointers.delete(e.pointerId); };
  root.addEventListener('pointerup', endPtr);
  root.addEventListener('pointercancel', endPtr);
  const hold = (id, fn) => { $(id).addEventListener('pointerdown', (e) => { e.preventDefault(); fn(true); }); $(id).addEventListener('pointerup', () => fn(false)); $(id).addEventListener('pointerleave', () => fn(false)); };
  hold('obBBreak', (down) => { S.mouseDown = down; if (down) { doBreak(); S.lastBreak = performance.now(); } });
  hold('obBPlace', (down) => { if (down) doUse(); });
  hold('obBJump', (down) => { if (down) keys.add('Space'); else keys.delete('Space'); });
  $('obBRun').addEventListener('pointerdown', (e) => { e.preventDefault(); S.sprint = !S.sprint; $('obBRun').style.opacity = S.sprint ? 1 : 0.75; });

  // ---------- физика ----------
  function physics(dt) {
    let fx = touch.x, fz = -touch.y;
    if (keys.has('KeyW') || keys.has('ArrowUp')) fz += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) fz -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) fx += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) fx -= 1;
    const len = Math.hypot(fx, fz);
    if (len > 1) { fx /= len; fz /= len; }
    const sp = S.sprint || keys.has('ShiftLeft') ? 6 : 4.3;
    const tx = (-Math.sin(S.yaw) * fz + Math.cos(S.yaw) * fx) * sp, tz = (-Math.cos(S.yaw) * fz - Math.sin(S.yaw) * fx) * sp;
    const k = Math.min(1, dt * (S.onGround ? 12 : 4));
    S.vx += (tx - S.vx) * k; S.vz += (tz - S.vz) * k;
    if (keys.has('Space') && S.onGround) { S.vy = 8.6; S.onGround = false; }
    S.vy = Math.max(-28, S.vy - 28 * dt);
    const nx = S.x + S.vx * dt; if (!collides(nx, S.y, S.z)) S.x = nx; else S.vx = 0;
    const nz = S.z + S.vz * dt; if (!collides(S.x, S.y, nz)) S.z = nz; else S.vz = 0;
    const ny = S.y + S.vy * dt;
    if (!collides(S.x, ny, S.z)) { S.y = ny; S.onGround = false; } else { if (S.vy < 0) S.onGround = true; S.vy = 0; }
    if (S.y < -15) { S.x = S.spawn.x; S.y = S.spawn.y; S.z = S.spawn.z; S.vx = S.vy = S.vz = 0; say('Ты упал с острова и вернулся на спавн'); }
  }

  // ---------- кадр ----------
  let last = 0;
  function frame(ts) {
    rafId = requestAnimationFrame(frame);
    if (!S.on || !S.ready) return;
    const dt = Math.min(0.05, (ts - last) / 1000 || 0.016);
    last = ts;
    const now = performance.now();
    if (!S.ui && !S.chatOpen) { physics(dt / 2); physics(dt / 2); }
    stepBits(dt);
    if (S.mouseDown && !S.ui && now - S.lastBreak > 170) { S.lastBreak = now; doBreak(); }

    const ey = S.y + 1.62, fx = -Math.sin(S.yaw) * Math.cos(S.pitch), fy = Math.sin(S.pitch), fz = -Math.cos(S.yaw) * Math.cos(S.pitch);
    S.target = S.ui ? null : raycast(S.x, ey, S.z, fx, fy, fz, REACH);
    hl.visible = !!S.target;
    if (S.target) hl.position.set(S.target.x + 0.5, S.target.y + 0.5, S.target.z + 0.5);

    if (S.third) camera.position.set(S.x - fx * 3.2, ey - fy * 3.2 + 0.3, S.z - fz * 3.2);
    else camera.position.set(S.x, ey, S.z);
    camera.rotation.set(S.pitch, S.yaw, 0);
    me.visible = S.third;
    me.position.set(S.x, S.y, S.z); me.rotation.y = S.yaw + Math.PI;
    animateModel(me, Math.hypot(S.vx, S.vz) / 4, now);

    for (const p of S.peers.values()) {
      p.g.position.x += (p.tx - p.g.position.x) * Math.min(1, dt * 12);
      p.g.position.y += (p.ty - p.g.position.y) * Math.min(1, dt * 12);
      p.g.position.z += (p.tz - p.g.position.z) * Math.min(1, dt * 12);
      p.g.rotation.y = (p.ry || 0) + Math.PI;
      animateModel(p.g, p.mv ? 1 : 0, now);
    }
    for (const g of [me, ...[...S.peers.values()].map((p) => p.g)]) {
      const u = g.userData;
      if (u.bubble && now > u.bubbleUntil) { g.remove(u.bubble); u.bubble = null; }
    }
    if (dirty) rebuild(now);

    if (now - S.lastSend > 100) { S.lastSend = now; Net.send({ type: 'o_pos', x: S.x, y: S.y, z: S.z, ry: S.yaw, mv: Math.hypot(S.vx, S.vz) > 0.5 }); }
    if (now - S.lastHud > 150) {
      S.lastHud = now;
      $('obInfo').textContent = `Разбито блоков: ${S.count} · игроков: ${S.peers.size + 1}`;
      if (S.msgUntil && now > S.msgUntil) { $('obMsg').textContent = ''; S.msgUntil = 0; }
      updateFeed();
    }
    renderer.render(scene, camera);
  }

  // ---------- сеть ----------
  function setBlock(x, y, z, id, magic) {
    const k = wkey(x, y, z), old = W.get(k);
    if (old && T && scene && (id === 0 || old.id !== id)) { burst(old); if (id === 0 && old) popSound(); }
    if (!id) W.delete(k); else W.set(k, { x, y, z, id, pop: magic ? performance.now() : 0 });
    dirty = true;
  }

  function updatePeers(list) {
    const seen = new Set();
    for (const p of list) {
      seen.add(p.id);
      let o = S.peers.get(p.id);
      if (!o) { o = { g: makePlayerModel(p.nick), nick: p.nick }; scene.add(o.g); o.g.position.set(p.x, p.y, p.z); S.peers.set(p.id, o); }
      Object.assign(o, { tx: p.x, ty: p.y, tz: p.z, ry: p.ry, mv: p.mv });
    }
    for (const [id, o] of S.peers) if (!seen.has(id)) { scene.remove(o.g); S.peers.delete(id); }
  }

  function onMessage(m) {
    switch (m.type) {
      case 'init':
        chatMsgs.length = 0;
        (m.chat || []).forEach((c) => addChat(c, false));
        if (S.on) Net.send({ type: 'o_join' });
        break;
      case 'chat': addChat(m.msg, true); break;
      case 'o_count':
        S.count = m.count;
        $('obCountLand').textContent = m.n ? `Сейчас на острове: ${m.n} · разбито блоков: ${m.count}` : `На острове никого нет · разбито блоков: ${m.count}`;
        break;
      case 'o_init': {
        if (!S.on) break;
        W.clear();
        for (const [x, y, z, t] of m.blocks) W.set(wkey(x, y, z), { x, y, z, id: t, pop: 0 });
        S.count = m.count; S.spawn = m.spawn;
        if (!S.ready) { S.x = m.spawn.x; S.y = m.spawn.y; S.z = m.spawn.z; S.yaw = Math.PI * 0.75; S.pitch = -0.35; }
        S.ready = true; dirty = true;
        say('Разбей главный блок: ЛКМ или кнопка ⛏', 4000);
        break;
      }
      case 'o_block': if (S.ready) setBlock(m.x, m.y, m.z, m.t, m.magic); break;
      case 'o_drop': {
        const left = addTo(S.inv, m.t, m.n);
        saveInv(); renderHotbar(); if (S.ui) renderUI();
        say(left ? 'Инвентарь полон' : `+${m.n} ${NAMES[m.t]}`, 1200);
        break;
      }
      case 'o_reject': { addTo(S.inv, m.t, 1); saveInv(); renderHotbar(); say('Сюда блок поставить нельзя'); break; }
      case 'o_peers': if (S.ready && S.on) updatePeers(m.list); break;
    }
  }

  // ---------- вход и выход ----------
  async function enter() {
    if (S.on) return;
    const btn = $('obPlay');
    btn.disabled = true; btn.textContent = 'Загружаю 3D…';
    try {
      await loadThree();
      T = window.THREE;
      if (!Object.keys(TEX).length) makeTextures();
      initGL();
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Играть';
      $('obCountLand').textContent = 'Не удалось загрузить 3D-движок (нужен интернет и WebGL).';
      return;
    }
    btn.disabled = false; btn.textContent = 'Играть';
    S.on = true; S.ready = false;
    $('obStage').hidden = false;
    resize(); renderHotbar();
    Net.send({ type: 'o_join' });
    last = performance.now();
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(frame);
  }

  function leave() {
    if (!S.on) return;
    closeUI(); closeChat();
    S.on = false; S.ready = false;
    Net.send({ type: 'o_leave' });
    cancelAnimationFrame(rafId);
    if (document.pointerLockElement) document.exitPointerLock();
    for (const o of S.peers.values()) scene.remove(o.g);
    S.peers.clear();
    $('obStage').hidden = true;
    keys.clear(); touch.x = touch.y = 0; S.mouseDown = false;
  }

  $('obPlay').addEventListener('click', enter);
  $('obExit').addEventListener('click', () => { leave(); Net.send({ type: 'o_peek' }); });

  window.OneBlock = {
    onMessage,
    onShow() { Net.send({ type: 'o_peek' }); },
    onHide() { leave(); },
    _test: {
      craftResult, addTo, canAddTo, raycast, collides, makeTextures, TEX, FACES, iconFor, W, S, RECIPES,
      smoke(fakeT, init) { // прогон построения сцены и кадра с подставным three.js (без браузера)
        T = fakeT; makeTextures(); initGL(); S.on = true;
        onMessage({ type: 'o_init', ...init });
        onMessage({ type: 'o_peers', list: [{ id: 'p1', nick: 'Боб', x: 1, y: 1, z: 1, ry: 0, mv: 1 }] });
        for (let k = 0; k < 3; k++) frame(1000 + k * 16);
        return { blocks: W.size, peers: S.peers.size };
      },
    },
  };
})();
