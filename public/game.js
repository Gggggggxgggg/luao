(() => {
  'use strict';
  const COLORS = ['#ff5c8a', '#ffb347', '#5ce1a0', '#5cb8ff'];
  const KEYS = { KeyD: 0, KeyF: 1, KeyJ: 2, KeyK: 3 };
  const PRE_MS = 2500;
  const WIN = { perfect: 40, great: 80, good: 130 };
  const WEIGHT = { perfect: 300, great: 200, good: 100, miss: 0 };
  const LABEL = { perfect: 'PERFECT', great: 'GREAT', good: 'GOOD', miss: 'MISS' };
  const JCOLOR = { perfect: '#ffffff', great: '#9fd8b4', good: '#f2d98d', miss: '#ff9a9a' };

  const root = document.getElementById('gameTab');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const popcnt = (n) => (n & 1) + ((n >> 1) & 1) + ((n >> 2) & 1) + ((n >> 3) & 1);
  const noteCount = (c) => c.steps.reduce((a, m) => a + popcnt(m), 0);

  let charts = {};
  let board = { global: [], charts: {} };
  let players = [];
  let lobby = [];
  let you = null;
  let selected = localStorage.getItem('gmChart') || 'demo';
  let speed = Number(localStorage.getItem('gmSpeed')) || 10;
  let volume = Number(localStorage.getItem('gmVol') ?? 70);
  let awaitSave = false;
  let G = null; // текущая игра
  let E = null; // редактор

  // ---------- разметка и стили ----------
  const style = document.createElement('style');
  style.textContent = `
    #gameTab { overflow: auto; min-height: 0; }
    .gm { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0; height: 100%; min-height: 0; }
    .gm > section { padding: 12px 14px; border-right: 1px solid var(--line); overflow: auto; min-height: 0; }
    .gm > section:last-child { border-right: 0; }
    .gm h3, #gmEditor h3 { margin: 0 0 10px; font-size: 14px; color: var(--muted); font-weight: 600; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    .gm h4 { margin: 16px 0 6px; font-size: 13px; color: var(--muted); font-weight: 600; }
    .gm ul, .gm ol { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
    .gm ol { counter-reset: n; }
    .gm ol li.muted::before { content: none; }
    .gm ol li::before { counter-increment: n; content: counter(n) "."; color: var(--muted); width: 22px; display: inline-block; }
    .gm li { padding: 7px 9px; border-radius: 6px; font-size: 14px; }
    #gmCharts li { cursor: pointer; display: grid; gap: 2px; border: 1px solid transparent; }
    #gmCharts li:hover { background: var(--panel); }
    #gmCharts li.on { background: var(--panel); border-color: var(--moon); }
    #gmCharts li span, #gmCharts li em, .muted { color: var(--muted); font-size: 12px; font-style: normal; }
    .gm .row, #gmEditor .row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
    .gm label.rng { display: grid; grid-template-columns: 90px 1fr 28px; align-items: center; gap: 8px; font-size: 13px; color: var(--muted); margin-top: 10px; }
    .gm input[type=range] { accent-color: var(--moon); }
    .gm .num { float: right; color: var(--muted); font-size: 13px; }
    .gm li button { padding: 2px 8px; font-size: 12px; margin-left: 4px; }
    #gmStage { position: fixed; inset: 0; z-index: 60; background: #000; }
    #gmStage canvas { width: 100%; height: 100%; display: block; touch-action: none; }
    #gmStage .x { position: absolute; top: 10px; left: 10px; }
    #gmOver { position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none; }
    #gmOver .res { pointer-events: auto; background: rgba(0,0,0,.88); border: 1px solid var(--line); border-radius: 10px; padding: 20px 26px; text-align: center; min-width: 260px; }
    #gmOver .rank { font-size: 64px; font-weight: 700; line-height: 1; }
    #gmOver .big { font-size: 26px; font-weight: 600; margin: 6px 0; }
    #gmOver .small { color: var(--muted); font-size: 13px; margin: 3px 0; }
    #gmOver .row { display: flex; gap: 8px; justify-content: center; margin-top: 14px; }
    #gmEditor { padding: 14px; max-width: 720px; margin: 0 auto; }
    #gmEditor .grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin: 10px 0; }
    #gmEditor label { display: grid; gap: 4px; font-size: 12px; color: var(--muted); }
    #gmEditor input[type=text], #gmEditor input[type=number], #gmEditor input[type=url] { width: 100%; background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 6px 10px; color: var(--text); }
    #gmEditor .pat { display: grid; gap: 4px; margin: 12px 0; }
    #gmEditor .lane { display: grid; grid-template-columns: repeat(16, 1fr); gap: 2px; }
    #gmEditor .cell { height: 34px; padding: 0; border-radius: 4px; background: var(--panel); border: 1px solid var(--line); }
    #gmEditor .cell:nth-child(4n+1) { margin-left: 4px; }
    #gmEditor .cell.on { border-color: transparent; }
    #gmEditor .pager { display: flex; align-items: center; gap: 10px; margin-top: 14px; }
    #gmToast { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); background: var(--panel); border: 1px solid var(--moon); padding: 8px 14px; border-radius: 8px; z-index: 80; font-size: 14px; max-width: 90vw; }
    @media (max-width: 900px) { .gm { grid-template-columns: 1fr; height: auto; } .gm > section { border-right: 0; border-bottom: 1px solid var(--line); } }
  `;
  document.head.appendChild(style);

  root.innerHTML = `
    <div class="gm" id="gmMenu">
      <section>
        <h3>Треки <button id="gmNew">+ Создать</button></h3>
        <ul id="gmCharts"></ul>
        <label class="rng">Скорость <input type="range" id="gmSpeed" min="1" max="20"><b id="gmSpeedV"></b></label>
        <label class="rng">Громкость <input type="range" id="gmVol" min="0" max="100"><b id="gmVolV"></b></label>
        <div class="row">
          <button class="run" id="gmPlay">Играть</button>
          <button id="gmEdit">Редактировать</button>
          <button id="gmDel">Удалить</button>
        </div>
        <p class="muted">Клавиши D F J K, либо нажимай пальцем / мышью на дорожки.</p>
      </section>
      <section>
        <h3>Матч</h3>
        <div class="row" style="margin-top:0"><button id="gmOpen">Вызвать всех на выбранный трек</button></div>
        <h4>Вызовы</h4><ul id="gmLobby"></ul>
        <h4>Игроки онлайн</h4><ul id="gmPlayers"></ul>
      </section>
      <section>
        <h3>Рейтинг игроков</h3>
        <p class="muted" style="margin:0 0 8px">Сумма лучших очков по всем трекам</p>
        <ol id="gmGlobal"></ol>
        <h4 id="gmBoardTitle">Лучшие на треке</h4>
        <ol id="gmBoard"></ol>
      </section>
    </div>
    <div id="gmEditor" hidden></div>
    <div id="gmStage" hidden>
      <canvas id="gmCv"></canvas>
      <button class="x" id="gmExit">← Выйти</button>
      <div id="gmOver"></div>
    </div>
    <div id="gmToast" hidden></div>`;

  const $ = (id) => document.getElementById(id);
  const cv = $('gmCv');
  const ctx = cv.getContext('2d');
  const audio = new Audio();
  audio.preload = 'auto';

  let toastTimer = null;
  function toast(text) {
    const t = $('gmToast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 3500);
  }

  // ---------- меню ----------
  const nick = () => (window.Net ? window.Net.nick() : 'Гость');
  const nickOf = (id) => (players.find((p) => p.id === id) || {}).nick || 'игрок';
  const chartList = () => Object.values(charts).sort((a, b) => a.ts - b.ts);

  function renderMenu() {
    if (!charts[selected]) selected = (chartList()[0] || {}).id || null;
    $('gmCharts').innerHTML = chartList().map((c) => {
      const top = (board.charts[c.id] || [])[0];
      return `<li data-id="${esc(c.id)}" class="${c.id === selected ? 'on' : ''}"><b>${esc(c.title)}</b>
        <span>${esc(c.author)} · ${noteCount(c)} нот · ${c.bpm} BPM${c.url ? ' · ♪' : ''}</span>
        ${top ? `<em>рекорд ${top.score} — ${esc(top.nick)}</em>` : ''}</li>`;
    }).join('') || '<li class="muted">Треков нет</li>';

    $('gmSpeed').value = speed; $('gmSpeedV').textContent = speed;
    $('gmVol').value = volume; $('gmVolV').textContent = volume;

    $('gmLobby').innerHTML = lobby.map((c) => {
      const t = esc((charts[c.chartId] || {}).title || '?');
      if (c.mine) {
        return `<li>Твой вызов: «${t}» ${c.to === 'all' ? '(всем)' : '→ ' + esc(nickOf(c.to))}
          <button data-a="cancel">Отменить</button></li>`;
      }
      return `<li><b>${esc(c.nick)}</b> вызывает ${c.to === 'all' ? 'всех' : 'тебя'} на «${t}»
        <button data-a="accept" data-from="${esc(c.from)}">Принять</button>
        ${c.to !== 'all' ? `<button data-a="decline" data-from="${esc(c.from)}">Отклонить</button>` : ''}</li>`;
    }).join('') || '<li class="muted">Вызовов нет</li>';

    $('gmPlayers').innerHTML = players.filter((p) => p.id !== you).map((p) =>
      `<li>${esc(p.nick)} ${p.busy ? '<span class="muted">в матче</span>'
        : `<button data-a="challenge" data-id="${esc(p.id)}">Вызвать</button>`}</li>`).join('') || '<li class="muted">Других игроков пока нет</li>';

    $('gmGlobal').innerHTML = board.global.map((p) =>
      `<li><b>${esc(p.nick)}</b> <span class="num">${p.total}</span></li>`).join('') || '<li class="muted">Пока никто не играл</li>';
    const sel = charts[selected];
    $('gmBoardTitle').textContent = sel ? `Лучшие: ${sel.title}` : 'Лучшие на треке';
    $('gmBoard').innerHTML = ((sel && board.charts[sel.id]) || []).map((p) =>
      `<li><b>${esc(p.nick)}</b> <span class="num">${p.score} · ${p.acc}%</span></li>`).join('') || '<li class="muted">Рекордов нет</li>';
  }

  function prime(chart) {
    // разрешаем звук заранее, пока есть жест пользователя
    if (!chart || !chart.url) return;
    audio.src = chart.url;
    audio.muted = true;
    audio.play().then(() => { audio.pause(); audio.currentTime = 0; audio.muted = false; })
      .catch(() => { audio.muted = false; });
  }

  $('gmCharts').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-id]');
    if (!li) return;
    selected = li.dataset.id;
    localStorage.setItem('gmChart', selected);
    renderMenu();
  });
  $('gmSpeed').addEventListener('input', (e) => {
    speed = Number(e.target.value);
    localStorage.setItem('gmSpeed', speed);
    $('gmSpeedV').textContent = speed;
  });
  $('gmVol').addEventListener('input', (e) => {
    volume = Number(e.target.value);
    localStorage.setItem('gmVol', volume);
    $('gmVolV').textContent = volume;
    audio.volume = volume / 100;
  });
  $('gmPlay').addEventListener('click', () => {
    const c = charts[selected];
    if (!c) return toast('Выбери трек');
    prime(c);
    startGame(c, 'solo');
  });
  $('gmNew').addEventListener('click', () => openEditor(null));
  $('gmEdit').addEventListener('click', () => {
    if (!charts[selected]) return toast('Выбери трек');
    openEditor(charts[selected]);
  });
  $('gmDel').addEventListener('click', () => {
    const c = charts[selected];
    if (!c) return;
    if (c.id === 'demo') return toast('Демо-трек удалить нельзя');
    if (c.author !== Net.user()) return toast('Удалить трек может только автор');
    if (confirm(`Удалить трек «${c.title}» у всех вместе с рекордами?`)) Net.send({ type: 'chart_delete', id: c.id });
  });
  $('gmOpen').addEventListener('click', () => {
    if (!charts[selected]) return toast('Выбери трек');
    Net.send({ type: 'challenge', to: 'all', chartId: selected });
    toast('Вызов отправлен всем игрокам');
  });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-a]');
    if (!b) return;
    const a = b.dataset.a;
    if (a === 'challenge') {
      if (!charts[selected]) return toast('Выбери трек');
      Net.send({ type: 'challenge', to: b.dataset.id, chartId: selected });
      toast('Вызов отправлен');
    } else if (a === 'accept') {
      const c = lobby.find((x) => x.from === b.dataset.from);
      if (c) prime(charts[c.chartId]);
      Net.send({ type: 'accept', from: b.dataset.from });
    } else if (a === 'decline') {
      Net.send({ type: 'decline', from: b.dataset.from });
    } else if (a === 'cancel') {
      Net.send({ type: 'cancel' });
    } else if (a === 'menu') {
      exitGame();
    } else if (a === 'again') {
      const c = G && G.chart;
      stopGame();
      if (c) { prime(c); startGame(c, G_LAST.mode); }
    } else if (a === 'rematch') {
      if (G_LAST.opp) Net.send({ type: 'challenge', to: G_LAST.opp.id, chartId: G_LAST.chart.id });
      toast('Реванш предложен');
      exitGame();
    }
  });

  // ---------- игра ----------
  let G_LAST = {};
  function buildLanes(chart) {
    const step = 60000 / chart.bpm / 4;
    const lanes = [[], [], [], []];
    chart.steps.forEach((mask, i) => {
      for (let l = 0; l < 4; l++) if ((mask >> l) & 1) lanes[l].push({ t: chart.offset + i * step });
    });
    return lanes;
  }

  function startGame(chart, mode, opp) {
    stopGame();
    const lanes = buildLanes(chart);
    const total = lanes.reduce((a, l) => a + l.length, 0);
    const last = Math.max(...lanes.map((l) => (l.length ? l[l.length - 1].t : 0)));
    G = {
      chart, mode, opp: opp || null, opps: { score: 0, acc: 0, combo: 0 }, lanes, ptr: [0, 0, 0, 0], total,
      score: 0, combo: 0, maxCombo: 0, wsum: 0, judged: 0, counts: { perfect: 0, great: 0, good: 0, miss: 0 },
      state: 'pre', preStart: performance.now(), startPerf: 0, t: -PRE_MS, endT: last + 1500,
      flash: [0, 0, 0, 0], fx: [], pop: null, speed, audioFailed: false, notice: '', lastProg: 0, result: null,
    };
    G_LAST = { mode, chart, opp: opp || null };
    $('gmMenu').hidden = true;
    $('gmEditor').hidden = true;
    $('gmStage').hidden = false;
    $('gmOver').innerHTML = '';
    audio.pause();
    if (chart.url) {
      audio.src = chart.url;
      audio.volume = volume / 100;
      audio.load();
    }
    fit();
    startLoop();
  }

  function stopGame() {
    audio.pause();
    G = null;
  }

  function exitGame() {
    const mode = G && G.mode;
    if (G && G.mode === 'match' && G.state !== 'end') Net.send({ type: 'match_leave' });
    stopGame();
    $('gmStage').hidden = true;
    if (mode === 'test' && E) {
      $('gmEditor').hidden = false;
    } else {
      $('gmMenu').hidden = false;
      renderMenu();
    }
  }
  $('gmExit').addEventListener('click', exitGame);

  audio.addEventListener('playing', () => { if (G && G.state === 'wait') begin(); });
  audio.addEventListener('error', () => {
    if (G && G.chart.url) { G.audioFailed = true; G.notice = 'Музыка не загрузилась — играем без неё'; }
  });

  function begin() {
    G.state = 'play';
    G.startPerf = performance.now();
  }

  function judge(j, lane) {
    const now = performance.now();
    G.counts[j]++;
    G.judged++;
    G.wsum += WEIGHT[j];
    if (j === 'miss') {
      G.combo = 0;
    } else {
      G.combo++;
      G.maxCombo = Math.max(G.maxCombo, G.combo);
      G.score += Math.round(WEIGHT[j] * (1 + Math.min(G.combo, 60) / 60));
      G.fx.push({ lane, t0: now });
    }
    G.pop = { text: LABEL[j], color: JCOLOR[j], until: now + 450 };
  }

  function press(lane) {
    if (!G || (G.state !== 'play' && G.state !== 'wait')) return;
    G.flash[lane] = performance.now();
    const n = G.lanes[lane][G.ptr[lane]];
    if (!n) return;
    const dt = G.t - n.t;
    if (dt < -WIN.good) return; // слишком рано — игнорируем
    const ad = Math.abs(dt);
    G.ptr[lane]++;
    judge(ad <= WIN.perfect ? 'perfect' : ad <= WIN.great ? 'great' : 'good', lane);
  }

  function update(now) {
    if (G.state === 'pre') {
      G.t = now - G.preStart - PRE_MS;
      if (G.t >= 0) {
        G.t = 0;
        if (G.chart.url && !G.audioFailed) {
          G.state = 'wait';
          G.waitStart = now;
          audio.play().catch(() => { G.audioFailed = true; G.notice = 'Браузер заблокировал музыку — играем без неё'; });
        } else {
          begin();
        }
      }
    } else if (G.state === 'wait') {
      G.t = 0;
      if (G.audioFailed || now - G.waitStart > 3500) begin();
    } else if (G.state === 'play') {
      G.t = now - G.startPerf;
      for (let l = 0; l < 4; l++) {
        const arr = G.lanes[l];
        while (G.ptr[l] < arr.length && G.t - arr[G.ptr[l]].t > WIN.good) {
          G.ptr[l]++;
          judge('miss', l);
        }
      }
      if (G.mode === 'match' && now - G.lastProg > 250) {
        G.lastProg = now;
        Net.send({ type: 'match_progress', score: G.score, combo: G.combo, acc: liveAcc() });
      }
      if (G.t > G.endT) finish();
    }
  }

  const liveAcc = () => (G.judged ? (G.wsum / (G.judged * 300)) * 100 : 100);

  function rankOf(acc) {
    return acc >= 95 ? 'S' : acc >= 85 ? 'A' : acc >= 70 ? 'B' : acc >= 50 ? 'C' : 'D';
  }

  function finish() {
    if (G.state === 'end') return;
    G.state = 'end';
    audio.pause();
    const acc = Math.round((G.wsum / (G.total * 300)) * 10000) / 100;
    G.result = { score: G.score, acc, maxCombo: G.maxCombo, counts: { ...G.counts }, rank: rankOf(acc) };
    if (G.mode !== 'test' && Net.user()) Net.send({ type: 'score', chartId: G.chart.id, score: G.score, acc });
    if (G.mode === 'match') Net.send({ type: 'match_finish', score: G.score, acc, maxCombo: G.maxCombo });
    showResult();
  }

  function showResult(extra) {
    const r = G.result;
    const c = r.counts;
    $('gmOver').innerHTML = `<div class="res">
      <div class="rank">${r.rank}</div>
      <div class="big">${r.score}</div>
      <div class="small">Точность ${r.acc}% · макс. комбо ${r.maxCombo}</div>
      <div class="small">Perfect ${c.perfect} · Great ${c.great} · Good ${c.good} · Miss ${c.miss}</div>
      ${!Net.user() && G.mode !== 'test' ? '<div class="small">Войди в аккаунт, чтобы очки попали в рейтинг</div>' : ''}
      ${G.mode === 'match' ? `<div class="big">${extra || 'Ждём соперника…'}</div>` : ''}
      <div class="row">
        ${G.mode === 'match' ? (extra ? '<button data-a="rematch">Реванш</button>' : '')
          : '<button class="run" data-a="again">Ещё раз</button>'}
        <button data-a="menu">В меню</button>
      </div></div>`;
  }

  // ввод
  document.addEventListener('keydown', (e) => {
    if (!G) return;
    if (e.code === 'Escape') return exitGame();
    if (e.repeat || !(e.code in KEYS)) return;
    e.preventDefault();
    press(KEYS[e.code]);
  });
  cv.addEventListener('pointerdown', (e) => {
    if (!G) return;
    e.preventDefault();
    const L = layout();
    const x = e.clientX - cv.getBoundingClientRect().left;
    const lane = Math.floor((x - L.left) / L.laneW);
    if (lane >= 0 && lane < 4) press(lane);
  });

  // ---------- отрисовка ----------
  let dpr = 1;
  function fit() {
    dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(cv.clientWidth * dpr);
    cv.height = Math.round(cv.clientHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', () => { if (G) fit(); });

  function layout() {
    const W = cv.clientWidth, H = cv.clientHeight;
    const laneW = Math.min(100, Math.floor(W / 4.6));
    return { W, H, laneW, left: Math.floor((W - laneW * 4) / 2), judgeY: H - Math.max(80, Math.round(H * 0.14)), r: laneW * 0.38 };
  }

  let loopId = 0;
  function startLoop() {
    const id = ++loopId;
    const frame = () => {
      if (id !== loopId || !G) return;
      const now = performance.now();
      if (G.state !== 'end') update(now);
      if (id !== loopId || !G) return;
      draw(now);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  function text(s, x, y, size, color, align, weight) {
    ctx.font = `${weight || 600} ${size}px system-ui, sans-serif`;
    ctx.fillStyle = color;
    ctx.textAlign = align || 'center';
    ctx.fillText(s, x, y);
  }

  function draw(now) {
    const { W, H, laneW, left, judgeY, r } = layout();
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    const pxms = G.speed * 0.05;

    // дорожки
    for (let l = 0; l <= 4; l++) {
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(left + l * laneW - 0.5, 0, 1, H);
    }
    for (let l = 0; l < 4; l++) {
      const f = Math.max(0, 1 - (now - G.flash[l]) / 220);
      if (f > 0) {
        const g = ctx.createLinearGradient(0, judgeY - 200, 0, judgeY);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(1, COLORS[l]);
        ctx.globalAlpha = f * 0.3;
        ctx.fillStyle = g;
        ctx.fillRect(left + l * laneW, judgeY - 200, laneW, 200);
        ctx.globalAlpha = 1;
      }
    }

    // тонкая белая линия
    ctx.fillStyle = '#fff';
    ctx.fillRect(left, judgeY, laneW * 4, 1.5);

    // кружки-рецепторы
    for (let l = 0; l < 4; l++) {
      const cx = left + l * laneW + laneW / 2;
      ctx.strokeStyle = COLORS[l];
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, judgeY, r, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
      text(['D', 'F', 'J', 'K'][l], cx, judgeY + r + 22, 13, 'rgba(255,255,255,.35)');
    }

    // ноты
    for (let l = 0; l < 4; l++) {
      const arr = G.lanes[l];
      const cx = left + l * laneW + laneW / 2;
      ctx.fillStyle = COLORS[l];
      for (let i = G.ptr[l]; i < arr.length; i++) {
        const y = judgeY - (arr[i].t - G.t) * pxms;
        if (y < -r) break;
        ctx.beginPath(); ctx.arc(cx, y, r, 0, Math.PI * 2); ctx.fill();
      }
    }

    // эффекты попаданий
    G.fx = G.fx.filter((f) => now - f.t0 < 260);
    for (const f of G.fx) {
      const k = (now - f.t0) / 260;
      ctx.strokeStyle = COLORS[f.lane];
      ctx.globalAlpha = 1 - k;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(left + f.lane * laneW + laneW / 2, judgeY, r * (1 + k * 0.8), 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // оценка попадания
    if (G.pop && G.pop.until > now) text(G.pop.text, W / 2, judgeY - 140, 22, G.pop.color);

    // HUD
    text(String(G.score).padStart(7, '0'), W / 2, 44, 34, '#fff');
    if (G.combo > 1) text(G.combo + 'x', W / 2, 78, 22, 'rgba(255,255,255,.7)');
    text(liveAcc().toFixed(2) + '%', W - 16, 34, 18, 'rgba(255,255,255,.7)', 'right');
    const prog = Math.max(0, Math.min(1, G.t / G.endT));
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    ctx.fillRect(0, 0, W * prog, 2);

    if (G.mode === 'match' && G.opp) {
      text(G.opp.nick, W - 16, 64, 14, '#9aa0c9', 'right');
      text(String(G.opps.score).padStart(7, '0'), W - 16, 88, 20, G.opps.score > G.score ? '#ff9a9a' : '#9fd8b4', 'right');
      text(G.opps.acc.toFixed(2) + '% · ' + G.opps.combo + 'x', W - 16, 108, 13, 'rgba(255,255,255,.5)', 'right');
    }
    if (G.mode === 'test') text('Тест — очки не сохраняются', W / 2, H - 14, 12, 'rgba(255,255,255,.4)');

    if (G.state === 'pre') {
      const n = Math.ceil(-G.t / 1000);
      text(n > 0 ? String(n) : 'GO', W / 2, H / 2 - 40, 64, 'rgba(255,255,255,.9)');
    }
    if (G.state === 'wait') text('Загружаю музыку…', W / 2, H / 2 - 40, 22, 'rgba(255,255,255,.7)');
    if (G.notice) text(G.notice, W / 2, H - 40, 14, '#f2d98d');
  }

  // ---------- редактор паттернов ----------
  const PRESETS = {
    'Лесенка': (a) => { for (let s = 0; s < 16; s += 2) a[s] = 1 << ((s / 2) % 4); },
    'Зигзаг': (a) => { [0, 1, 2, 3, 2, 1, 0, 1].forEach((l, i) => (a[i * 2] = 1 << l)); },
    'Стрим': (a) => { for (let s = 0; s < 16; s++) a[s] = 1 << (s % 4); },
    'Аккорды': (a) => { [0, 4, 8, 12].forEach((s, i) => (a[s] = i % 2 ? 10 : 5)); },
    'Случайный': (a) => {
      let prev = -1;
      for (let s = 0; s < 16; s += 2) {
        let l; do { l = Math.floor(Math.random() * 4); } while (l === prev);
        prev = l; a[s] = 1 << l;
      }
    },
  };

  function openEditor(chart) {
    E = chart
      ? { id: chart.id, title: chart.title, url: chart.url, bpm: chart.bpm, offset: chart.offset, measures: chart.measures, speed: chart.speed, steps: chart.steps.slice(), m: 0 }
      : { id: null, title: '', url: '', bpm: 120, offset: 0, measures: 8, speed: 10, steps: Array(8 * 16).fill(0), m: 0 };
    // чужие треки и демо не перезаписываем — сохранится как твоя копия
    if (chart && (chart.id === 'demo' || chart.author !== Net.user())) { E.id = null; E.fork = true; }
    $('gmMenu').hidden = true;
    $('gmEditor').hidden = false;
    renderEditor();
  }

  function editorChart() {
    return { id: E.id || 'test', title: E.title || 'Тест', url: E.url, bpm: E.bpm, offset: E.offset, measures: E.measures, speed: E.speed, steps: E.steps, author: nick() };
  }

  function resizeSteps() {
    const len = E.measures * 16;
    while (E.steps.length < len) E.steps.push(0);
    E.steps.length = len;
    if (E.m >= E.measures) E.m = E.measures - 1;
  }

  function renderEditor() {
    const base = E.m * 16;
    let lanes = '';
    for (let l = 0; l < 4; l++) {
      let cells = '';
      for (let s = 0; s < 16; s++) {
        const on = (E.steps[base + s] >> l) & 1;
        cells += `<button class="cell ${on ? 'on' : ''}" data-l="${l}" data-s="${s}" style="${on ? 'background:' + COLORS[l] : ''}" aria-label="дорожка ${l + 1}, шаг ${s + 1}"></button>`;
      }
      lanes += `<div class="lane">${cells}</div>`;
    }
    $('gmEditor').innerHTML = `
      <h3>${E.id ? 'Редактирование трека' : E.fork ? 'Копия трека (автором станешь ты)' : 'Новый трек'} <button id="edClose">← Назад</button></h3>
      <div class="grid2">
        <label>Название<input type="text" id="edTitle" maxlength="40" value="${esc(E.title)}"></label>
        <label>Ссылка на музыку (прямая, mp3/ogg/wav)<input type="url" id="edUrl" maxlength="500" placeholder="https://…/track.mp3" value="${esc(E.url)}"></label>
        <label>BPM<input type="number" id="edBpm" min="40" max="300" step="0.01" value="${E.bpm}"></label>
        <label>Сдвиг первой доли, мс<input type="number" id="edOff" min="-5000" max="600000" value="${E.offset}"></label>
        <label>Тактов (1–32)<input type="number" id="edMeas" min="1" max="32" value="${E.measures}"></label>
        <label>Скорость по умолчанию<input type="number" id="edSpeed" min="1" max="20" value="${E.speed}"></label>
      </div>
      <div class="pager">
        <button id="edPrev">◀</button><b>Такт ${E.m + 1} / ${E.measures}</b><button id="edNext">▶</button>
        <span class="muted">16 шагов в такте</span>
      </div>
      <div class="pat">${lanes}</div>
      <div class="row" style="margin-top:6px">
        ${Object.keys(PRESETS).map((k) => `<button data-p="${esc(k)}">${esc(k)}</button>`).join('')}
        <button id="edClear">Очистить такт</button>
        <button id="edCopy">Скопировать в следующий</button>
      </div>
      <div class="row">
        <button id="edTest">Тест</button>
        <button class="run" id="edSave">Сохранить для всех</button>
      </div>
      <p class="muted">Совет: сдвиг — это время (мс) от начала музыки до первой доли. Подбирай его кнопкой «Тест».
      Если паттерн или BPM изменятся, рекорды этого трека сбросятся.</p>`;
  }

  function syncFields() {
    if (!$('edTitle')) return;
    E.title = $('edTitle').value;
    E.url = $('edUrl').value.trim();
    E.bpm = Number($('edBpm').value) || 120;
    E.offset = Math.round(Number($('edOff').value) || 0);
    E.speed = Math.min(20, Math.max(1, Math.round(Number($('edSpeed').value) || 10)));
    const m = Math.min(32, Math.max(1, Math.round(Number($('edMeas').value) || 1)));
    if (m !== E.measures) { E.measures = m; resizeSteps(); }
  }

  $('gmEditor').addEventListener('click', (e) => {
    const t = e.target;
    const cell = t.closest('.cell');
    if (cell) {
      syncFields();
      E.steps[E.m * 16 + Number(cell.dataset.s)] ^= 1 << Number(cell.dataset.l);
      return renderEditor();
    }
    const btn = t.closest('button');
    if (!btn) return;
    syncFields();
    const base = E.m * 16;
    if (btn.id === 'edClose') { $('gmEditor').hidden = true; $('gmMenu').hidden = false; E = null; return renderMenu(); }
    if (btn.id === 'edPrev') { E.m = Math.max(0, E.m - 1); return renderEditor(); }
    if (btn.id === 'edNext') { E.m = Math.min(E.measures - 1, E.m + 1); return renderEditor(); }
    if (btn.id === 'edClear') { for (let s = 0; s < 16; s++) E.steps[base + s] = 0; return renderEditor(); }
    if (btn.id === 'edCopy') {
      if (E.m + 1 < E.measures) for (let s = 0; s < 16; s++) E.steps[base + 16 + s] = E.steps[base + s];
      E.m = Math.min(E.measures - 1, E.m + 1);
      return renderEditor();
    }
    if (btn.dataset.p) {
      const a = Array(16).fill(0);
      PRESETS[btn.dataset.p](a);
      for (let s = 0; s < 16; s++) E.steps[base + s] = a[s];
      return renderEditor();
    }
    if (btn.id === 'edTest') {
      if (!E.steps.some(Boolean)) return toast('Добавь хотя бы одну ноту');
      prime(editorChart());
      return startGame(editorChart(), 'test');
    }
    if (btn.id === 'edSave') {
      if (!Net.user()) { toast('Войди в аккаунт, чтобы сохранять треки'); return Net.openAuth('login'); }
      if (!E.title.trim()) return toast('Введи название');
      if (!E.steps.some(Boolean)) return toast('Добавь хотя бы одну ноту');
      awaitSave = true;
      Net.send({ type: 'chart_save', nick: nick(), chart: { id: E.id, title: E.title, url: E.url, bpm: E.bpm, offset: E.offset, measures: E.measures, speed: E.speed, steps: E.steps } });
    }
  });

  // ---------- сообщения от сервера ----------
  function onMessage(m) {
    switch (m.type) {
      case 'init':
        charts = m.charts || {}; board = m.board || board; you = m.you; players = m.players || []; lobby = m.lobby || [];
        Net.send({ type: 'hello', nick: nick() });
        renderMenu();
        break;
      case 'chart':
        charts[m.chart.id] = m.chart;
        if (awaitSave && E && (E.id ? m.chart.id === E.id : m.chart.title === E.title.trim() && m.chart.author === nick())) {
          awaitSave = false;
          selected = m.chart.id;
          localStorage.setItem('gmChart', selected);
          E = null;
          $('gmEditor').hidden = true;
          $('gmMenu').hidden = false;
          toast('Трек сохранён');
        }
        renderMenu();
        break;
      case 'chart_delete':
        delete charts[m.id];
        renderMenu();
        break;
      case 'board': board = m.board; renderMenu(); break;
      case 'players': players = m.list; renderMenu(); break;
      case 'lobby': lobby = m.list; renderMenu(); break;
      case 'declined': toast(`${m.nick} отклонил вызов`); break;
      case 'error': awaitSave = false; toast(m.text); break;
      case 'match_start': {
        const c = charts[m.chartId];
        if (!c) return toast('Трек матча не найден');
        Net.showGame();
        startGame(c, 'match', m.opponent);
        break;
      }
      case 'opp_progress':
        if (G && G.mode === 'match') G.opps = { score: m.score, acc: m.acc, combo: m.combo };
        break;
      case 'match_result': {
        const msg = m.winner === 'you' ? `Победа! ${m.you.score} : ${m.opp.score}`
          : m.winner === 'opp' ? `Поражение ${m.you.score} : ${m.opp.score}` : `Ничья ${m.you.score} : ${m.opp.score}`;
        if (G && G.mode === 'match' && G.state === 'end') showResult(msg);
        else toast(`Матч с ${m.oppNick}: ${msg}`);
        break;
      }
      case 'match_abort':
        if (G && G.mode === 'match') {
          if (G.state !== 'end') finish();
          showResult(`${m.nick} вышел — победа тебе`);
        } else toast(`${m.nick} вышел из матча`);
        break;
    }
  }

  // ник изменился — сообщаем серверу
  document.getElementById('nick').addEventListener('change', () => Net.send({ type: 'hello', nick: nick() }));

  window.Game = {
    onMessage,
    onHide() { if (G) exitGame(); },
  };
})();
