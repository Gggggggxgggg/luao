(() => {
  'use strict';
  // Шахматы: правила и проверку ходов делает сервер, клиент рисует доску и отправляет ходы.
  const root = document.getElementById('chessTab');
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const IDLE = 'rnbqkbnrpppppppp................................PPPPPPPPRNBQKBNR';
  const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
  const glyph = (p) => GLYPH[p.toLowerCase()] + '\uFE0E'; // \uFE0E — текстовый вариант, без эмодзи

  const style = document.createElement('style');
  style.textContent = `
    #chessTab { min-height: 0; overflow: auto; }
    .ch { display: grid; grid-template-columns: 270px minmax(0, 1fr) 240px; height: 100%; min-height: 0; }
    .ch > section { padding: 12px 14px; overflow: auto; min-height: 0; }
    .ch > section:first-child { border-right: 1px solid var(--line); }
    .ch > section:last-child { border-left: 1px solid var(--line); }
    .ch h3 { margin: 0 0 10px; font-size: 14px; color: var(--muted); font-weight: 600; }
    .ch h4 { margin: 16px 0 6px; font-size: 13px; color: var(--muted); font-weight: 600; }
    .ch ul, .ch ol { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
    .ch li { padding: 6px 8px; border-radius: 6px; font-size: 14px; display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; }
    .ch li button { padding: 2px 8px; font-size: 12px; }
    .ch .row { display: flex; gap: 8px; flex-wrap: wrap; }
    .ch label { display: grid; grid-template-columns: 70px 1fr; align-items: center; gap: 8px; font-size: 13px; color: var(--muted); margin-bottom: 8px; }
    .ch select { background: var(--bg); color: var(--text); border: 1px solid var(--line); border-radius: 6px; padding: 5px 8px; }
    .ch .num { color: var(--muted); font-size: 12px; }
    .ch-main { display: flex; flex-direction: column; align-items: center; gap: 8px; }
    .ch-bar { width: min(100%, 560px); display: flex; justify-content: space-between; align-items: center; font-size: 15px; }
    .ch-bar .clk { font-family: var(--mono); font-size: 20px; padding: 2px 10px; border-radius: 6px; background: var(--panel); border: 1px solid var(--line); min-width: 84px; text-align: center; }
    .ch-bar .clk.run { border-color: var(--moon); color: var(--moon); }
    .ch-bar .clk.low { color: var(--err); border-color: var(--err); }
    #chBoardWrap { position: relative; width: min(100%, 560px); }
    #chBoard { width: 100%; aspect-ratio: 1; display: grid; grid-template-columns: repeat(8, 1fr); border: 1px solid var(--line); user-select: none; -webkit-user-select: none; touch-action: manipulation; }
    .sq { position: relative; display: grid; place-items: center; cursor: pointer; font-size: calc(var(--bw, 480px) / 8 * 0.8); line-height: 1; }
    .sq.l { background: #e6d8b8; } .sq.d { background: #9b7b5a; }
    .sq.last { box-shadow: inset 0 0 0 100px rgba(242, 217, 141, .45); }
    .sq.sel { box-shadow: inset 0 0 0 100px rgba(120, 200, 255, .5); }
    .sq.chk { background-image: radial-gradient(circle, rgba(255, 50, 50, .95), rgba(255, 50, 50, 0) 72%); }
    .sq.tgt::after { content: ''; position: absolute; width: 28%; height: 28%; border-radius: 50%; background: rgba(0, 0, 0, .3); }
    .sq.cap::after { content: ''; position: absolute; inset: 4%; border-radius: 50%; border: calc(var(--bw, 480px) / 8 * 0.07) solid rgba(0, 0, 0, .3); }
    .pc { position: relative; z-index: 1; }
    .pc.w { color: #fff; text-shadow: 0 0 2px #000, 0 0 3px #000, 0 1px 2px #000; }
    .pc.b { color: #151515; text-shadow: 0 0 1px rgba(255, 255, 255, .5); }
    .sq i { position: absolute; font-style: normal; font-size: 10px; font-family: var(--sans); opacity: .6; color: #000; z-index: 0; }
    .sq i.f { right: 3px; bottom: 1px; } .sq i.r { left: 3px; top: 1px; }
    #chPromo { position: absolute; inset: 0; display: grid; place-items: center; background: rgba(0, 0, 0, .55); z-index: 5; }
    #chPromo div { display: flex; gap: 8px; background: var(--panel); padding: 10px; border-radius: 10px; border: 1px solid var(--line); }
    #chPromo button { font-size: 38px; padding: 4px 10px; line-height: 1; }
    #chStatus { min-height: 22px; font-size: 15px; text-align: center; }
    #chStatus.win { color: var(--ok); } #chStatus.lose { color: var(--err); }
    #chMoves { width: min(100%, 560px); max-height: 120px; overflow: auto; font-family: var(--mono); font-size: 13px; color: var(--muted); line-height: 1.6; }
    #chMoves b { color: var(--text); font-weight: 500; }
    #chToast { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); background: var(--panel); border: 1px solid var(--moon); padding: 8px 14px; border-radius: 8px; z-index: 80; font-size: 14px; }
    @media (max-width: 900px) {
      .ch { grid-template-columns: 1fr; height: auto; }
      .ch > section { border: 0 !important; border-top: 1px solid var(--line) !important; }
      .ch-main { order: -1; }
    }
  `;
  document.head.appendChild(style);

  root.innerHTML = `
    <div class="ch">
      <section>
        <h3>Новая партия</h3>
        <label>Время <select id="chTc"><option value="0">Без часов</option><option value="3">3 минуты</option><option value="5" selected>5 минут</option><option value="10">10 минут</option></select></label>
        <label>Цвет <select id="chColor"><option value="r">Случайно</option><option value="w">Белые</option><option value="b">Чёрные</option></select></label>
        <h4>Против компьютера</h4>
        <div class="row">
          <button data-a="bot" data-l="1">★ Лёгкий</button>
          <button data-a="bot" data-l="2">★★ Средний</button>
          <button data-a="bot" data-l="3">★★★ Сложный</button>
        </div>
        <h4>Против игроков</h4>
        <div class="row"><button data-a="open">Вызвать всех</button></div>
        <h4>Вызовы</h4><ul id="chLobby"></ul>
        <h4>Игроки онлайн</h4><ul id="chPlayers"></ul>
      </section>
      <section class="ch-main">
        <div class="ch-bar" id="chTop"><b></b><span class="clk"></span></div>
        <div id="chBoardWrap"><div id="chBoard"></div><div id="chPromo" hidden></div></div>
        <div class="ch-bar" id="chBot"><b></b><span class="clk"></span></div>
        <div id="chStatus"></div>
        <div id="chDraw" hidden>Соперник предлагает ничью <button data-a="drawyes">Принять</button> <button data-a="drawno">Отклонить</button></div>
        <div class="row" id="chBtns"></div>
        <div id="chMoves"></div>
      </section>
      <section>
        <h3>Рейтинг Эло</h3>
        <p class="muted" style="margin:0 0 8px">Считается в партиях между вошедшими в аккаунт игроками. Старт — 1200.</p>
        <ol id="chRatings"></ol>
      </section>
    </div>
    <div id="chToast" hidden></div>`;

  let you = null, players = [], lobby = [], ratings = [];
  let V = null; // текущая партия (вид с сервера)
  let sel = null; // выбранная клетка
  let timer = 0;

  function toast(t) {
    const el = $('chToast');
    el.textContent = t; el.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => (el.hidden = true), 3500);
  }

  // ---------- доска ----------
  const legalFrom = () => {
    const m = new Map();
    if (V && !V.result) for (const [f, t, p] of V.legal) { if (!m.has(f)) m.set(f, []); m.get(f).push({ to: t, promo: p }); }
    return m;
  };

  function renderBoard() {
    const b = V ? V.board : IDLE;
    const flipped = V && V.you === 'b';
    const lf = legalFrom();
    const targets = sel !== null && lf.has(sel) ? new Set(lf.get(sel).map((x) => x.to)) : new Set();
    const kingIdx = V && V.check ? b.indexOf(V.turn === 'w' ? 'K' : 'k') : -1;
    let html = '';
    for (let pos = 0; pos < 64; pos++) {
      const i = flipped ? 63 - pos : pos;
      const r = i >> 3, f = i & 7;
      const p = b[i];
      const cls = ['sq', (r + f) % 2 ? 'd' : 'l'];
      if (V && V.last && (V.last.from === i || V.last.to === i)) cls.push('last');
      if (sel === i) cls.push('sel');
      if (kingIdx === i) cls.push('chk');
      if (targets.has(i)) cls.push(p !== '.' || (b[sel] && b[sel].toLowerCase() === 'p' && (sel & 7) !== f) ? 'cap' : 'tgt');
      const rank = pos % 8 === 0 ? `<i class="r">${8 - r}</i>` : '';
      const file = pos >= 56 ? `<i class="f">${'abcdefgh'[f]}</i>` : '';
      html += `<div class="${cls.join(' ')}" data-i="${i}">${rank}${file}${p !== '.' ? `<span class="pc ${p === p.toUpperCase() ? 'w' : 'b'}">${glyph(p)}</span>` : ''}</div>`;
    }
    const bd = $('chBoard');
    bd.innerHTML = html;
    bd.style.setProperty('--bw', bd.clientWidth + 'px');
  }

  function fmtClock(ms) {
    ms = Math.max(0, ms);
    const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000);
    return ms < 10000 ? '0:' + (ms / 1000).toFixed(1).padStart(4, '0') : `${m}:${String(s).padStart(2, '0')}`;
  }

  function renderBars() {
    const mine = V ? V.you : 'w';
    const opp = mine === 'w' ? 'b' : 'w';
    const name = (c) => (V ? (c === 'w' ? V.white : V.black) : c === mine ? 'Ты' : 'Соперник');
    for (const [id, c] of [['chTop', opp], ['chBot', mine]]) {
      const bar = $(id);
      bar.firstElementChild.textContent = `${c === 'w' ? '⚪' : '⚫'} ${name(c)}`;
      bar.dataset.c = c;
    }
    updateClocks();
  }

  function updateClocks() {
    for (const id of ['chTop', 'chBot']) {
      const bar = $(id), el = bar.lastElementChild, c = bar.dataset.c;
      if (!V || !V.clock) { el.textContent = V ? '∞' : '—'; el.className = 'clk'; continue; }
      let rem = V.clock[c];
      const running = V.clock.running === c && !V.result;
      if (running) rem -= performance.now() - V.recv;
      el.textContent = fmtClock(rem);
      el.className = 'clk' + (running ? ' run' : '') + (rem < 20000 && running ? ' low' : '');
    }
  }

  function renderStatus() {
    const st = $('chStatus');
    st.className = '';
    if (!V) { st.textContent = 'Выбери режим слева: партия с компьютером или вызов игрока'; return; }
    if (V.result) {
      const r = V.result;
      if (!r.winner) st.textContent = `Ничья — ${r.reason}`;
      else {
        const won = r.winner === V.you;
        st.textContent = `${won ? 'Ты победил!' : 'Ты проиграл.'} ${r.winner === 'w' ? 'Белые' : 'Чёрные'} — ${r.reason}`;
        st.className = won ? 'win' : 'lose';
      }
      return;
    }
    const myTurn = V.turn === V.you;
    st.textContent = (myTurn ? 'Твой ход' : 'Ход соперника') + (V.check ? ' — шах!' : '');
  }

  function renderMoves() {
    const el = $('chMoves');
    if (!V) { el.innerHTML = ''; return; }
    let out = '';
    for (let i = 0; i < V.history.length; i += 2) {
      out += `<b>${i / 2 + 1}.</b> ${esc(V.history[i])} ${esc(V.history[i + 1] || '')}  `;
    }
    el.innerHTML = out;
    el.scrollTop = el.scrollHeight;
  }

  function renderButtons() {
    const el = $('chBtns');
    $('chDraw').hidden = !(V && !V.result && V.drawOffer && V.drawOffer !== V.you);
    if (!V) { el.innerHTML = ''; return; }
    el.innerHTML = V.result
      ? '<button class="run" data-a="new">Новая партия</button>'
      : `<button data-a="resign">Сдаться</button><button data-a="draw"${V.drawOffer === V.you ? ' disabled' : ''}>${V.drawOffer === V.you ? 'Ничья предложена' : 'Предложить ничью'}</button>`;
  }

  function renderLobby() {
    $('chLobby').innerHTML = lobby.map((c) => {
      const tc = c.tc ? `${c.tc} мин` : 'без часов';
      const col = { w: 'играет белыми', b: 'играет чёрными', r: 'цвет случайный' }[c.color];
      if (c.mine) {
        return `<li><span>Твой вызов (${c.to === 'all' ? 'всем' : esc(nickOf(c.to))}), ${tc}</span><button data-a="cancel">Отменить</button></li>`;
      }
      return `<li><span><b>${esc(c.nick)}</b> вызывает${c.to === 'all' ? ' всех' : ' тебя'} · ${tc} · ${col}</span>
        <span><button data-a="accept" data-from="${esc(c.from)}">Принять</button>
        ${c.to !== 'all' ? `<button data-a="decline" data-from="${esc(c.from)}">Отклонить</button>` : ''}</span></li>`;
    }).join('') || '<li class="muted">Вызовов нет</li>';
    $('chPlayers').innerHTML = players.filter((p) => p.id !== you).map((p) =>
      `<li><span>${esc(p.nick)}</span>${p.cg ? '<span class="num">в партии</span>' : `<button data-a="challenge" data-id="${esc(p.id)}">Вызвать</button>`}</li>`
    ).join('') || '<li class="muted">Других игроков пока нет</li>';
    const inc = lobby.some((c) => !c.mine);
    $('tabChess').textContent = 'Шахматы' + (inc && root.hidden ? ' ●' : '');
  }
  const nickOf = (id) => (players.find((p) => p.id === id) || {}).nick || 'игрок';

  function renderRatings() {
    $('chRatings').innerHTML = ratings.map((p) =>
      `<li><span><b>${esc(p.nick)}</b></span><span class="num">${p.r} · ${p.w}/${p.d}/${p.l}</span></li>`).join('') || '<li class="muted">Пока нет рейтинговых партий</li>';
  }

  function renderAll() { renderBoard(); renderBars(); renderStatus(); renderMoves(); renderButtons(); }

  // ---------- ходы ----------
  function sendMove(from, to, promo) {
    Net.send({ type: 'c_move', from, to, promo: promo || '' });
    sel = null;
  }

  $('chBoard').addEventListener('click', (e) => {
    const sq = e.target.closest('.sq');
    if (!sq || !V || V.result) return;
    const i = Number(sq.dataset.i);
    const lf = legalFrom();
    if (sel !== null && lf.has(sel)) {
      const opts = lf.get(sel).filter((x) => x.to === i);
      if (opts.length) {
        if (opts[0].promo) return choosePromo(sel, i);
        return sendMove(sel, i);
      }
    }
    sel = lf.has(i) && sel !== i ? i : null;
    renderBoard();
  });

  function choosePromo(from, to) {
    const white = V.you === 'w';
    const box = $('chPromo');
    box.hidden = false;
    box.innerHTML = '<div>' + ['q', 'r', 'b', 'n'].map((p) => `<button data-p="${p}" class="pc ${white ? 'w' : 'b'}">${glyph(p)}</button>`).join('') + '</div>';
    box.onclick = (e) => {
      const b = e.target.closest('button[data-p]');
      box.hidden = true;
      box.onclick = null;
      if (b) sendMove(from, to, b.dataset.p);
      else { sel = null; renderBoard(); }
    };
  }

  // ---------- кнопки ----------
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-a]');
    if (!b) return;
    const a = b.dataset.a;
    const tc = Number($('chTc').value), color = $('chColor').value;
    if (V && !V.result && ['bot', 'open', 'challenge', 'accept'].includes(a)) return toast('Сначала закончи текущую партию');
    if (a === 'bot') Net.send({ type: 'c_bot', level: Number(b.dataset.l), tc, color });
    else if (a === 'open') { Net.send({ type: 'c_challenge', to: 'all', tc, color }); toast('Вызов отправлен всем'); }
    else if (a === 'challenge') { Net.send({ type: 'c_challenge', to: b.dataset.id, tc, color }); toast('Вызов отправлен'); }
    else if (a === 'cancel') Net.send({ type: 'c_cancel' });
    else if (a === 'accept') Net.send({ type: 'c_accept', from: b.dataset.from });
    else if (a === 'decline') Net.send({ type: 'c_decline', from: b.dataset.from });
    else if (a === 'resign') { if (confirm('Сдаться?')) Net.send({ type: 'c_resign' }); }
    else if (a === 'draw') Net.send({ type: 'c_draw' });
    else if (a === 'drawyes') Net.send({ type: 'c_draw_reply', accept: true });
    else if (a === 'drawno') Net.send({ type: 'c_draw_reply', accept: false });
    else if (a === 'new') { V = null; sel = null; sessionStorage.removeItem('chessGame'); renderAll(); }
  });

  // ---------- сообщения ----------
  function setGame(g) {
    const isNew = !V || V.id !== g.id;
    V = g;
    V.recv = performance.now();
    if (isNew) { sel = null; if (!g.result) Net.showChess(); }
    if (g.result) sessionStorage.removeItem('chessGame');
    else sessionStorage.setItem('chessGame', g.id);
    renderAll();
  }

  function onMessage(m) {
    switch (m.type) {
      case 'init': {
        you = m.you;
        players = m.players || [];
        const id = sessionStorage.getItem('chessGame');
        if (id) Net.send({ type: 'c_resume', id });
        Net.send({ type: 'c_peek' });
        renderLobby();
        break;
      }
      case 'players': players = m.list; renderLobby(); break;
      case 'c_lobby': lobby = m.list; renderLobby(); break;
      case 'c_ratings': ratings = m.list; renderRatings(); break;
      case 'c_game': setGame(m.g); break;
      case 'c_info': toast(m.text); break;
      case 'c_gone': sessionStorage.removeItem('chessGame'); break;
    }
  }

  function tick() { if (!root.hidden) updateClocks(); }
  timer = setInterval(tick, 200);
  window.addEventListener('resize', () => { if (!root.hidden) renderBoard(); });

  renderAll(); renderLobby(); renderRatings();
  window.Chess = {
    onMessage,
    onShow() { Net.send({ type: 'c_peek' }); $('tabChess').textContent = 'Шахматы'; renderAll(); },
  };
})();
