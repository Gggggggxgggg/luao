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
  const noteCount = (c) => c.notes.length;

  let charts = {};
  let board = { global: [], charts: {} };
  let players = [];
  let lobby = [];
  let you = null;
  let selected = localStorage.getItem('gmChart') || 'demo';
  let speed = Number(localStorage.getItem('gmSpeed')) || 10;
  let autoPlay = localStorage.getItem('gmAuto') === '1';
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
    .gm label.rng { display: grid; grid-template-columns: 90px 1fr 70px; align-items: center; gap: 8px; font-size: 13px; color: var(--muted); margin-top: 10px; }
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
    #gmEditor { padding: 14px; max-width: 820px; margin: 0 auto; }
    #gmEditor .tools { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 10px 0; }
    #gmEditor select { background: var(--bg); color: var(--text); border: 1px solid var(--line); border-radius: 6px; padding: 5px 8px; }
    #gmEditor label.inl { display: flex; align-items: center; gap: 6px; }
    #edCv { width: 100%; height: 214px; display: block; background: #000; border: 1px solid var(--line); border-radius: 8px; touch-action: none; }
    #edPads { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 10px 0; }
    #edPads button { height: 68px; border: 0; border-radius: 14px; font-size: 22px; font-weight: 700; color: #000; touch-action: manipulation; }
    .gm input[type=number] { width: 70px; background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 4px 6px; color: var(--text); }
    #gmLock { opacity: .35; background: none; padding: 2px 8px; }
    .gm label.sw { position: relative; display: inline-block; width: 44px; height: 24px; }
    .gm label.sw input { position: absolute; opacity: 0; inset: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; z-index: 1; }
    .gm label.sw span { position: absolute; inset: 0; border-radius: 12px; background: #333; transition: background .15s; }
    .gm label.sw span::before { content: ''; position: absolute; width: 18px; height: 18px; left: 3px; top: 3px; border-radius: 50%; background: #fff; transition: transform .15s; }
    .gm label.sw input:checked + span { background: var(--moon); }
    .gm label.sw input:checked + span::before { transform: translateX(20px); background: #000; }
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
        <label class="rng">Скорость <input type="range" id="gmSpeed" min="1" max="100"><input type="number" id="gmSpeedN" min="0.1" max="1000" step="0.5"></label>
        <label class="rng">Громкость <input type="range" id="gmVol" min="0" max="100"><b id="gmVolV"></b></label>
        <div class="row" style="margin-top:6px">
          <button id="gmLock" aria-label="замок">🔒</button>
          <label class="sw" id="gmSw" hidden><input type="checkbox" id="gmAuto" aria-label="переключатель"><span></span></label>
        </div>
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
    <div id="gmToast" hidden></div>
    <dialog id="gmPw">
      <form id="gmPwForm">
        <label>Пароль<input type="password" id="gmPwIn" inputmode="numeric" autocomplete="off" maxlength="20"></label>
        <div class="err" id="gmPwErr" role="alert"></div>
        <div class="row"><button type="submit" class="run">OK</button><button type="button" id="gmPwNo">Отмена</button></div>
      </form>
    </dialog>`;

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

    $('gmSpeed').value = Math.min(100, speed);
    if (document.activeElement !== $('gmSpeedN')) $('gmSpeedN').value = speed;
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
  const setSpeed = (v) => {
    speed = Math.min(1000, Math.max(0.1, Number(v) || 10));
    localStorage.setItem('gmSpeed', speed);
  };
  $('gmSpeed').addEventListener('input', (e) => { setSpeed(e.target.value); $('gmSpeedN').value = speed; });
  $('gmSpeedN').addEventListener('input', (e) => {
    if (e.target.value === '') return;
    setSpeed(e.target.value);
    $('gmSpeed').value = Math.min(100, speed);
  });
  $('gmVol').addEventListener('input', (e) => {
    volume = Number(e.target.value);
    localStorage.setItem('gmVol', volume);
    $('gmVolV').textContent = volume;
    audio.volume = volume / 100;
  });
  const unlocked = () => localStorage.getItem('gmUnlock') === '1';
  function renderLock() {
    $('gmLock').hidden = unlocked();
    $('gmSw').hidden = !unlocked();
    $('gmAuto').checked = autoPlay && unlocked();
  }
  $('gmLock').addEventListener('click', () => {
    $('gmPwIn').value = ''; $('gmPwErr').textContent = '';
    $('gmPw').showModal();
    $('gmPwIn').focus();
  });
  $('gmPwNo').addEventListener('click', () => $('gmPw').close());
  $('gmPwForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if ($('gmPwIn').value.trim() === '6281') {
      localStorage.setItem('gmUnlock', '1');
      $('gmPw').close();
      renderLock();
    } else {
      $('gmPwErr').textContent = 'Неверный пароль';
      $('gmPwIn').value = '';
    }
  });
  $('gmAuto').addEventListener('change', (e) => {
    autoPlay = e.target.checked;
    localStorage.setItem('gmAuto', autoPlay ? '1' : '0');
  });
  renderLock();

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
    const lanes = [[], [], [], []];
    for (const [t, l] of chart.notes) lanes[l].push({ t });
    for (const arr of lanes) arr.sort((a, b) => a.t - b.t);
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
      auto: autoPlay && unlocked() && (mode === 'solo' || mode === 'test'),
      flash: [0, 0, 0, 0], fx: [], pop: null, speed, audioFailed: false, notice: '', lastProg: 0, result: null,
    };
    G_LAST = { mode, chart, opp: opp || null };
    $('gmMenu').hidden = true;
    $('gmEditor').hidden = true;
    $('gmStage').hidden = false;
    $('gmOver').innerHTML = '';
    audio.pause();
    audio.defaultPlaybackRate = audio.playbackRate = 1;
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
      edAfterTest();
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
      if (G.auto) {
        for (let l = 0; l < 4; l++) {
          const arr = G.lanes[l];
          while (G.ptr[l] < arr.length && arr[G.ptr[l]].t <= G.t) { G.flash[l] = now; G.ptr[l]++; judge('perfect', l); }
        }
      }
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
    if (G.mode !== 'test' && !G.auto && Net.user()) Net.send({ type: 'score', chartId: G.chart.id, score: G.score, acc });
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

  // ---------- редактор: таймлайн с музыкой и записью нажатий ----------
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
  const LANE_H = 44, RULER_H = 26, MAX_NOTES = 3000;

  $('gmEditor').innerHTML = `
    <h3>Редактор трека <button id="edClose">← Назад</button></h3>
    <div class="grid2">
      <label>Название<input type="text" id="edTitle" maxlength="40"></label>
      <label>Ссылка на музыку (прямая, mp3/ogg/wav)<input type="url" id="edUrl" maxlength="500" placeholder="https://…/track.mp3"></label>
      <label>BPM (для сетки)<input type="number" id="edBpm" min="20" max="400" step="0.01"></label>
      <label>Первая доля, мс<input type="number" id="edOff" min="-5000" max="600000"></label>
      <label>Скорость кружков (без лимита)<input type="number" id="edSpeed" min="0.1" max="1000" step="0.5"></label>
      <label>Поправка нажатий, мс<input type="number" id="edLat" step="5" value="0"></label>
    </div>
    <div id="edStatus" class="muted"></div>
    <div class="tools">
      <button id="edPlay" class="run">▶ Играть</button>
      <input type="range" id="edSeek" min="0" max="60000" value="0" style="flex:1;min-width:120px">
      <span id="edTime" class="muted"></span>
      <select id="edRate"><option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1" selected>1×</option></select>
    </div>
    <canvas id="edCv"></canvas>
    <div id="edPads">${[0, 1, 2, 3].map((l) => `<button data-l="${l}" style="background:${COLORS[l]}">${'DFJK'[l]}</button>`).join('')}</div>
    <p class="muted">Включи музыку и жми D F J K или цветные кнопки: ноты запишутся в такт. Касание дорожки на таймлайне ставит или убирает ноту,
    перетаскивание двигает таймлайн, касание линейки перематывает. Пробел — пауза.</p>
    <div class="tools">
      <label class="inl">Сетка <select id="edSnap"><option value="0">Свободно</option><option value="1">1/1</option><option value="2">1/2</option><option value="4">1/4</option></select></label>
      <button id="edQuant">Привязать к сетке</button>
      <button id="edTap">Тап-темп</button>
      <button id="edSetOff">Первая доля здесь</button>
      <button id="edZoomOut">−</button><button id="edZoomIn">+</button>
      <label class="inl"><input type="checkbox" id="edFollow" checked> Следить</label>
      <button id="edUndo">Отменить</button>
      <button id="edClear">Очистить</button>
    </div>
    <div class="tools">
      <select id="edPreset">${Object.keys(PRESETS).map((k) => `<option>${esc(k)}</option>`).join('')}</select>
      <button id="edInsert">Вставить паттерн на такт от курсора</button>
    </div>
    <div class="tools">
      <button id="edTest">Тест</button>
      <button class="run" id="edSave">Сохранить для всех</button>
      <span id="edCount" class="muted"></span>
    </div>
    <p class="muted">Если ноты изменятся, рекорды трека сбросятся. Чужой трек сохраняется как твоя копия.</p>`;

  const ecv = $('edCv'), ectx = ecv.getContext('2d');
  let drag = null, edLoopId = 0, seeking = false, tapTimes = [], clickCtx = null;

  const fmt = (ms, precise = true) => {
    ms = Math.max(0, ms);
    const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000), r = Math.floor(ms % 1000);
    return `${m}:${String(s).padStart(2, '0')}${precise ? '.' + String(r).padStart(3, '0') : ''}`;
  };
  const setStatus = (t) => { $('edStatus').textContent = t; };
  const updateCount = () => { $('edCount').textContent = `Нот: ${E ? E.notes.length : 0}`; };

  function openEditor(chart) {
    const mine = chart && chart.id !== 'demo' && chart.author === Net.user();
    E = {
      id: mine ? chart.id : null, fork: !!chart && !mine,
      title: chart ? chart.title : '', url: chart ? chart.url : '', bpm: chart ? chart.bpm : 120, offset: chart ? chart.offset : 0,
      notes: chart ? chart.notes.map(([t, l]) => ({ t, l })) : [],
      snap: 0, zoom: 240, vt: -400, undo: [], rate: 1, follow: true,
      audio: 'none', dur: 60000, clock: { playing: false, base: 0, since: 0 },
    };
    $('edTitle').value = E.title; $('edUrl').value = E.url; $('edBpm').value = E.bpm; $('edOff').value = E.offset;
    $('edSpeed').value = speed; $('edLat').value = Number(localStorage.getItem('gmLat')) || 0;
    $('edSnap').value = '0'; $('edRate').value = '1'; $('edFollow').checked = true;
    $('gmMenu').hidden = true; $('gmEditor').hidden = false;
    edLoadAudio(); updateCount(); startEdLoop();
  }

  function editorChart() {
    readFields();
    return {
      id: E.id || 'test', title: E.title || 'Тест', url: E.url, bpm: E.bpm, offset: E.offset, speed,
      notes: E.notes.map((n) => [n.t, n.l]), author: nick(),
    };
  }

  function readFields() {
    E.title = $('edTitle').value;
    E.url = $('edUrl').value.trim();
    E.bpm = Math.min(400, Math.max(20, Number($('edBpm').value) || 120));
    E.offset = Math.round(Number($('edOff').value) || 0);
  }

  // ----- музыка и часы -----
  const edAudioOn = () => E.audio === 'ready';
  function edTime() {
    if (edAudioOn()) return audio.currentTime * 1000;
    return E.clock.playing ? E.clock.base + (performance.now() - E.clock.since) * E.rate : E.clock.base;
  }
  const edPlaying = () => (edAudioOn() ? !audio.paused : E.clock.playing);
  const edDur = () => (E.audio === 'ready' ? E.dur : Math.max(60000, (E.notes.length ? E.notes[E.notes.length - 1].t : 0) + 10000));

  function edPlay() {
    if (E.audio === 'loading') return toast('Музыка ещё загружается…');
    if (edAudioOn()) {
      audio.volume = volume / 100;
      audio.play().catch(() => toast('Браузер заблокировал воспроизведение — нажми ещё раз'));
    } else {
      E.clock.since = performance.now();
      E.clock.playing = true;
    }
  }
  function edPause() {
    if (!E) return;
    if (edAudioOn()) audio.pause();
    else if (E.clock.playing) { E.clock.base = edTime(); E.clock.playing = false; }
  }
  function edSeek(ms) {
    ms = Math.max(0, Math.min(edDur(), ms));
    if (edAudioOn()) audio.currentTime = ms / 1000;
    else { E.clock.base = ms; E.clock.since = performance.now(); }
  }

  function edLoadAudio() {
    edPause();
    E.clock.base = 0;
    if (!E.url) {
      E.audio = 'none';
      audio.pause();
      setStatus('Без музыки: работает виртуальный таймер. Вставь ссылку на трек, чтобы слушать его в редакторе.');
      return;
    }
    E.audio = 'loading';
    setStatus('Загружаю музыку…');
    audio.src = E.url;
    audio.defaultPlaybackRate = audio.playbackRate = E.rate;
    audio.volume = volume / 100;
    audio.load();
  }
  audio.addEventListener('loadedmetadata', () => {
    if (!E || G) return;
    E.audio = 'ready';
    E.dur = isFinite(audio.duration) ? audio.duration * 1000 : 600000;
    setStatus('Музыка загружена, длительность ' + fmt(E.dur, false));
  });
  audio.addEventListener('error', () => {
    if (!E || G || !E.url) return;
    E.audio = 'error';
    setStatus('Не удалось загрузить музыку: нужна прямая ссылка на аудиофайл. Пока работает виртуальный таймер.');
  });

  // ----- ноты -----
  function snapT(t) {
    if (E.snap > 0 && E.bpm > 0) {
      const step = 60000 / E.bpm / E.snap;
      t = E.offset + Math.round((t - E.offset) / step) * step;
    }
    return Math.max(0, Math.round(t));
  }
  function pushUndo() {
    E.undo.push(JSON.stringify(E.notes));
    if (E.undo.length > 60) E.undo.shift();
  }
  function addNote(t, l, noUndo) {
    t = snapT(t);
    if (E.notes.some((n) => n.l === l && Math.abs(n.t - t) < 20)) return false;
    if (E.notes.length >= MAX_NOTES) { toast(`Максимум ${MAX_NOTES} нот`); return false; }
    if (!noUndo) pushUndo();
    E.notes.push({ t, l });
    E.notes.sort((a, b) => a.t - b.t || a.l - b.l);
    return true;
  }
  function removeNear(l, t, tol) {
    let best = -1, bd = tol + 1;
    E.notes.forEach((n, i) => {
      const d = Math.abs(n.t - t);
      if (n.l === l && d < bd) { bd = d; best = i; }
    });
    if (best < 0) return false;
    pushUndo();
    E.notes.splice(best, 1);
    return true;
  }
  function click() {
    try {
      clickCtx = clickCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = clickCtx.createOscillator(), g = clickCtx.createGain(), t = clickCtx.currentTime;
      o.frequency.value = 1400;
      g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      o.connect(g); g.connect(clickCtx.destination); o.start(t); o.stop(t + 0.05);
    } catch { /* звук необязателен */ }
  }
  function padHit(l) { // нажатие: нота ставится в текущий момент музыки
    const t = edTime() - (Number($('edLat').value) || 0);
    if (addNote(t, l)) {
      if (!edPlaying()) click();
      updateCount();
    }
  }

  // ----- таймлайн -----
  function zoomBy(f) {
    const W = ecv.clientWidth, c = E.vt + (W / 2) * 1000 / E.zoom;
    E.zoom = Math.min(5000, Math.max(30, E.zoom * f));
    E.vt = c - (W / 2) * 1000 / E.zoom;
  }

  function drawEditor() {
    const W = ecv.clientWidth, H = ecv.clientHeight, d = window.devicePixelRatio || 1;
    if (ecv.width !== Math.round(W * d) || ecv.height !== Math.round(H * d)) { ecv.width = Math.round(W * d); ecv.height = Math.round(H * d); }
    ectx.setTransform(d, 0, 0, d, 0, 0);
    const cur = edTime(), dur = edDur();
    if (E.follow && edPlaying() && !(drag && drag.moved)) E.vt = cur - W * 0.3 * 1000 / E.zoom;
    const px = (t) => (t - E.vt) * E.zoom / 1000;
    const tl = E.vt, tr = E.vt + W * 1000 / E.zoom;
    ectx.fillStyle = '#000'; ectx.fillRect(0, 0, W, H);
    for (let l = 0; l < 4; l++) {
      const y0 = RULER_H + l * LANE_H;
      ectx.fillStyle = l % 2 ? 'rgba(255,255,255,.03)' : 'rgba(255,255,255,.06)';
      ectx.fillRect(0, y0, W, LANE_H);
      ectx.fillStyle = COLORS[l]; ectx.globalAlpha = 0.18; ectx.fillRect(0, y0 + LANE_H / 2 - 0.5, W, 1); ectx.globalAlpha = 1;
    }
    // сетка по BPM
    if (E.bpm > 0) {
      const div = E.snap > 0 ? E.snap : 1, step = 60000 / E.bpm / div;
      if (step * E.zoom / 1000 >= 6) {
        let k = Math.ceil((tl - E.offset) / step);
        for (let t = E.offset + k * step; t <= tr; t = E.offset + ++k * step) {
          ectx.fillStyle = k % div === 0 ? 'rgba(255,255,255,.2)' : 'rgba(255,255,255,.08)';
          ectx.fillRect(px(t), RULER_H, 1, LANE_H * 4);
        }
      }
    }
    // линейка
    const steps = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 30000, 60000];
    const sm = steps.find((s) => s * E.zoom / 1000 >= 90) || 60000;
    ectx.fillStyle = 'rgba(255,255,255,.55)'; ectx.font = '11px system-ui'; ectx.textAlign = 'left';
    for (let t = Math.ceil(Math.max(0, tl) / sm) * sm; t <= tr; t += sm) {
      ectx.fillRect(px(t), RULER_H - 8, 1, 8);
      ectx.fillText(fmt(t, sm < 1000), px(t) + 3, 12);
    }
    // ноты
    for (const n of E.notes) {
      const x = px(n.t);
      if (x < -14 || x > W + 14) continue;
      ectx.fillStyle = COLORS[n.l];
      ectx.beginPath(); ectx.arc(x, RULER_H + n.l * LANE_H + LANE_H / 2, 12, 0, Math.PI * 2); ectx.fill();
    }
    ectx.fillStyle = 'rgba(255,255,255,.4)'; ectx.font = '600 12px system-ui';
    for (let l = 0; l < 4; l++) ectx.fillText('DFJK'[l], 6, RULER_H + l * LANE_H + LANE_H / 2 + 4);
    // курсор воспроизведения
    const cx = px(cur);
    ectx.fillStyle = '#fff'; ectx.fillRect(cx - 0.75, 0, 1.5, H);
    ectx.beginPath(); ectx.moveTo(cx - 6, 0); ectx.lineTo(cx + 6, 0); ectx.lineTo(cx, 9); ectx.fill();

    $('edTime').textContent = `${fmt(cur)} / ${fmt(dur, false)}`;
    const sk = $('edSeek');
    if (Number(sk.max) !== Math.round(dur)) sk.max = Math.round(dur);
    if (!seeking) sk.value = Math.round(cur);
    const pl = $('edPlay'), txt = edPlaying() ? '⏸ Пауза' : '▶ Играть';
    if (pl.textContent !== txt) pl.textContent = txt;
  }

  function startEdLoop() {
    const id = ++edLoopId;
    const f = () => {
      if (id !== edLoopId || !E || $('gmEditor').hidden || G) return;
      drawEditor();
      requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  }

  ecv.addEventListener('pointerdown', (e) => {
    if (!E) return;
    ecv.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, vt: E.vt, moved: false };
  });
  ecv.addEventListener('pointermove', (e) => {
    if (!drag || !E) return;
    const dx = e.clientX - drag.x;
    if (Math.abs(dx) > 6) drag.moved = true;
    if (drag.moved) E.vt = drag.vt - dx * 1000 / E.zoom;
  });
  ecv.addEventListener('pointerup', (e) => {
    if (!drag || !E) return;
    const dr = drag; drag = null;
    if (dr.moved) return;
    const r = ecv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const t = E.vt + x * 1000 / E.zoom;
    if (y < RULER_H) return edSeek(t);
    const l = Math.floor((y - RULER_H) / LANE_H);
    if (l < 0 || l > 3) return;
    if (!removeNear(l, t, 14 * 1000 / E.zoom)) addNote(t, l);
    updateCount();
  });
  ecv.addEventListener('pointercancel', () => { drag = null; });
  ecv.addEventListener('wheel', (e) => {
    if (!E) return;
    e.preventDefault();
    if (e.ctrlKey) zoomBy(e.deltaY < 0 ? 1.2 : 1 / 1.2);
    else E.vt += (e.deltaY + e.deltaX) * 1000 / E.zoom;
  }, { passive: false });

  $('edPads').addEventListener('pointerdown', (e) => {
    const b = e.target.closest('button[data-l]');
    if (!b || !E) return;
    e.preventDefault();
    padHit(Number(b.dataset.l));
  });

  document.addEventListener('keydown', (e) => {
    if (G || !E || $('gmEditor').hidden) return;
    const tag = e.target.tagName, type = e.target.type;
    if (tag === 'SELECT' || tag === 'TEXTAREA' || (tag === 'INPUT' && !['range', 'checkbox'].includes(type))) return;
    if (e.code === 'Space' && tag !== 'BUTTON') { e.preventDefault(); edPlaying() ? edPause() : edPlay(); }
    else if (!e.repeat && e.code in KEYS) { e.preventDefault(); padHit(KEYS[e.code]); }
    else if (e.ctrlKey && e.code === 'KeyZ') { e.preventDefault(); $('edUndo').click(); }
  });

  // ----- кнопки и поля -----
  function setSpeedValue(v) {
    speed = Math.min(1000, Math.max(0.1, Number(v) || 10));
    localStorage.setItem('gmSpeed', speed);
  }

  $('gmEditor').addEventListener('change', (e) => {
    if (!E) return;
    const id = e.target.id;
    if (id === 'edUrl') { E.url = e.target.value.trim(); edLoadAudio(); }
    else if (id === 'edBpm' || id === 'edOff' || id === 'edTitle') readFields();
    else if (id === 'edSnap') E.snap = Number(e.target.value);
    else if (id === 'edFollow') E.follow = e.target.checked;
    else if (id === 'edSpeed') setSpeedValue(e.target.value);
    else if (id === 'edLat') localStorage.setItem('gmLat', Number(e.target.value) || 0);
    else if (id === 'edRate') {
      if (!edAudioOn() && E.clock.playing) { E.clock.base = edTime(); E.clock.since = performance.now(); }
      E.rate = Number(e.target.value);
      audio.defaultPlaybackRate = audio.playbackRate = E.rate;
    }
  });
  $('edSeek').addEventListener('pointerdown', () => { seeking = true; });
  $('edSeek').addEventListener('pointerup', () => { seeking = false; });
  $('edSeek').addEventListener('input', (e) => { if (E) edSeek(Number(e.target.value)); });

  $('gmEditor').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn || !E || btn.closest('#edPads')) return;
    const id = btn.id;
    if (id === 'edClose') { edPause(); $('gmEditor').hidden = true; $('gmMenu').hidden = false; E = null; renderMenu(); }
    else if (id === 'edPlay') { edPlaying() ? edPause() : edPlay(); }
    else if (id === 'edZoomIn') zoomBy(1.5);
    else if (id === 'edZoomOut') zoomBy(1 / 1.5);
    else if (id === 'edUndo') { if (E.undo.length) { E.notes = JSON.parse(E.undo.pop()); updateCount(); } }
    else if (id === 'edClear') { if (E.notes.length && confirm('Удалить все ноты?')) { pushUndo(); E.notes = []; updateCount(); } }
    else if (id === 'edSetOff') { E.offset = Math.round(edTime()); $('edOff').value = E.offset; toast('Первая доля: ' + E.offset + ' мс'); }
    else if (id === 'edTap') {
      const now = performance.now();
      if (tapTimes.length && now - tapTimes[tapTimes.length - 1] > 2000) tapTimes = [];
      tapTimes.push(now);
      if (tapTimes.length >= 3) {
        const avg = (tapTimes[tapTimes.length - 1] - tapTimes[0]) / (tapTimes.length - 1);
        E.bpm = Math.round((60000 / avg) * 100) / 100;
        $('edBpm').value = E.bpm;
      }
      toast(tapTimes.length < 3 ? `Тап ${tapTimes.length}… (нужно минимум 3)` : `BPM: ${E.bpm}`);
    } else if (id === 'edQuant') {
      readFields();
      if (E.snap === 0) return toast('Выбери сетку: 1/1, 1/2 или 1/4');
      pushUndo();
      const seen = new Set();
      E.notes = E.notes.map((n) => ({ t: snapT(n.t), l: n.l })).filter((n) => { const k = n.t * 4 + n.l; if (seen.has(k)) return false; seen.add(k); return true; });
      E.notes.sort((a, b) => a.t - b.t || a.l - b.l);
      updateCount();
    } else if (id === 'edInsert') {
      readFields();
      const step = 60000 / E.bpm / 4, t0 = E.offset + Math.round((edTime() - E.offset) / step) * step;
      const mask = Array(16).fill(0);
      PRESETS[$('edPreset').value](mask);
      pushUndo();
      const saved = E.snap; E.snap = 0;
      mask.forEach((m, s) => { for (let l = 0; l < 4; l++) if ((m >> l) & 1) addNote(t0 + s * step, l, true); });
      E.snap = saved;
      updateCount();
    } else if (id === 'edTest') {
      if (!E.notes.length) return toast('Добавь хотя бы одну ноту');
      edPause();
      const c = editorChart();
      prime(c);
      startGame(c, 'test');
    } else if (id === 'edSave') {
      readFields();
      if (!Net.user()) { toast('Войди в аккаунт, чтобы сохранять треки'); return Net.openAuth('login'); }
      if (!E.title.trim()) return toast('Введи название');
      if (!E.notes.length) return toast('Добавь хотя бы одну ноту');
      awaitSave = true;
      Net.send({ type: 'chart_save', nick: nick(), chart: { id: E.id, title: E.title, url: E.url, bpm: E.bpm, offset: E.offset, speed, notes: E.notes.map((n) => [n.t, n.l]) } });
    }
  });

  // возврат из тестовой игры в редактор
  function edAfterTest() {
    $('gmEditor').hidden = false;
    audio.defaultPlaybackRate = audio.playbackRate = E.rate;
    startEdLoop();
  }

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
    onHide() { if (E) edPause(); if (G) exitGame(); },
  };
})();
