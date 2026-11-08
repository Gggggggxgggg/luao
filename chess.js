'use strict';
// Шахматный движок: правила, легальные ходы, SAN и простой бот. Клетки 0..63, a8 = 0, h1 = 63.
// Фигуры: заглавные — белые (PNBRQK), строчные — чёрные; пустая клетка — ''.

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const KN = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
const KG = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const colorOf = (p) => (p === '' ? '' : p === p.toUpperCase() ? 'w' : 'b');

function fromFEN(fen) {
  const [pl, turn, cas, ep, half, full] = fen.split(' ');
  const b = Array(64).fill('');
  let i = 0;
  for (const ch of pl) {
    if (ch === '/') continue;
    if (/\d/.test(ch)) i += Number(ch);
    else b[i++] = ch;
  }
  return {
    b, turn,
    c: { K: cas.includes('K'), Q: cas.includes('Q'), k: cas.includes('k'), q: cas.includes('q') },
    ep: ep === '-' ? -1 : (8 - Number(ep[1])) * 8 + (ep.charCodeAt(0) - 97),
    half: Number(half) || 0, full: Number(full) || 1,
  };
}
const startState = () => fromFEN(START);

function attacked(b, sq, by) {
  const r = sq >> 3, f = sq & 7;
  const up = by === 'w' ? 'PNBRQK' : 'pnbrqk';
  const pr = by === 'w' ? r + 1 : r - 1;
  if (pr >= 0 && pr < 8) {
    for (const df of [-1, 1]) {
      const nf = f + df;
      if (nf >= 0 && nf < 8 && b[pr * 8 + nf] === up[0]) return true;
    }
  }
  for (const [dr, df] of KN) {
    const nr = r + dr, nf = f + df;
    if (nr >= 0 && nr < 8 && nf >= 0 && nf < 8 && b[nr * 8 + nf] === up[1]) return true;
  }
  for (const [dr, df] of KG) {
    const nr = r + dr, nf = f + df;
    if (nr >= 0 && nr < 8 && nf >= 0 && nf < 8 && b[nr * 8 + nf] === up[5]) return true;
  }
  for (const [dirs, rook] of [[DIAG, up[2]], [ORTH, up[3]]]) {
    for (const [dr, df] of dirs) {
      let nr = r + dr, nf = f + df;
      while (nr >= 0 && nr < 8 && nf >= 0 && nf < 8) {
        const p = b[nr * 8 + nf];
        if (p) {
          if (p === rook || p === up[4]) return true;
          break;
        }
        nr += dr; nf += df;
      }
    }
  }
  return false;
}

function pseudo(st) {
  const { b, turn: me } = st;
  const opp = me === 'w' ? 'b' : 'w';
  const out = [];
  for (let i = 0; i < 64; i++) {
    const p = b[i];
    if (!p || colorOf(p) !== me) continue;
    const r = i >> 3, f = i & 7, t = p.toLowerCase();
    if (t === 'p') {
      const dir = me === 'w' ? -1 : 1, start = me === 'w' ? 6 : 1, last = me === 'w' ? 0 : 7;
      const push = (to, cap) => {
        if (to >> 3 === last) for (const promo of 'qrbn') out.push({ from: i, to, promo, cap });
        else out.push({ from: i, to, cap });
      };
      const r1 = r + dir;
      if (b[r1 * 8 + f] === '') {
        push(r1 * 8 + f, false);
        if (r === start && b[(r + 2 * dir) * 8 + f] === '') out.push({ from: i, to: (r + 2 * dir) * 8 + f, dbl: true });
      }
      for (const df of [-1, 1]) {
        const nf = f + df;
        if (nf < 0 || nf > 7) continue;
        const to = r1 * 8 + nf, q = b[to];
        if (q && colorOf(q) !== me) push(to, true);
        else if (to === st.ep) out.push({ from: i, to, ep: true, cap: true });
      }
    } else if (t === 'n' || t === 'k') {
      for (const [dr, df] of t === 'n' ? KN : KG) {
        const nr = r + dr, nf = f + df;
        if (nr < 0 || nr > 7 || nf < 0 || nf > 7) continue;
        const q = b[nr * 8 + nf];
        if (q === '' || colorOf(q) !== me) out.push({ from: i, to: nr * 8 + nf, cap: q !== '' });
      }
      if (t === 'k') {
        const home = me === 'w' ? 60 : 4;
        if (i === home && !attacked(b, home, opp)) {
          const rook = me === 'w' ? 'R' : 'r';
          const ks = me === 'w' ? st.c.K : st.c.k, qs = me === 'w' ? st.c.Q : st.c.q;
          if (ks && b[home + 1] === '' && b[home + 2] === '' && b[home + 3] === rook
            && !attacked(b, home + 1, opp) && !attacked(b, home + 2, opp)) out.push({ from: i, to: home + 2, castle: 'K' });
          if (qs && b[home - 1] === '' && b[home - 2] === '' && b[home - 3] === '' && b[home - 4] === rook
            && !attacked(b, home - 1, opp) && !attacked(b, home - 2, opp)) out.push({ from: i, to: home - 2, castle: 'Q' });
        }
      }
    } else {
      const dirs = t === 'b' ? DIAG : t === 'r' ? ORTH : DIAG.concat(ORTH);
      for (const [dr, df] of dirs) {
        let nr = r + dr, nf = f + df;
        while (nr >= 0 && nr < 8 && nf >= 0 && nf < 8) {
          const q = b[nr * 8 + nf];
          if (q === '') out.push({ from: i, to: nr * 8 + nf, cap: false });
          else {
            if (colorOf(q) !== me) out.push({ from: i, to: nr * 8 + nf, cap: true });
            break;
          }
          nr += dr; nf += df;
        }
      }
    }
  }
  return out;
}

function apply(st, m) {
  const b = st.b.slice();
  const p = b[m.from], me = st.turn;
  const c = { ...st.c };
  b[m.from] = '';
  let cap = b[m.to];
  if (m.ep) { b[m.to + (me === 'w' ? 8 : -8)] = ''; cap = 'x'; }
  b[m.to] = m.promo ? (me === 'w' ? m.promo.toUpperCase() : m.promo) : p;
  if (m.castle === 'K') { b[m.to - 1] = b[m.to + 1]; b[m.to + 1] = ''; }
  if (m.castle === 'Q') { b[m.to + 1] = b[m.to - 2]; b[m.to - 2] = ''; }
  if (p === 'K') { c.K = false; c.Q = false; }
  if (p === 'k') { c.k = false; c.q = false; }
  for (const sq of [m.from, m.to]) {
    if (sq === 63) c.K = false;
    if (sq === 56) c.Q = false;
    if (sq === 7) c.k = false;
    if (sq === 0) c.q = false;
  }
  return {
    b, turn: me === 'w' ? 'b' : 'w', c, ep: m.dbl ? (m.from + m.to) / 2 : -1,
    half: p.toLowerCase() === 'p' || cap ? 0 : st.half + 1, full: st.full + (me === 'b' ? 1 : 0),
  };
}

const kingSq = (st, color) => st.b.indexOf(color === 'w' ? 'K' : 'k');
const inCheck = (st) => attacked(st.b, kingSq(st, st.turn), st.turn === 'w' ? 'b' : 'w');

function legal(st) {
  const me = st.turn, opp = me === 'w' ? 'b' : 'w';
  return pseudo(st).filter((m) => {
    const s2 = apply(st, m);
    return !attacked(s2.b, kingSq(s2, me), opp);
  });
}

function insufficient(b) {
  const rest = b.filter((p) => p && p.toLowerCase() !== 'k');
  if (!rest.length) return true;
  if (rest.length === 1 && 'bBnN'.includes(rest[0])) return true;
  if (rest.every((p) => p === 'b' || p === 'B')) {
    const squares = new Set();
    b.forEach((p, i) => { if (p === 'b' || p === 'B') squares.add(((i >> 3) + (i & 7)) % 2); });
    return squares.size === 1;
  }
  return false;
}

// ongoing | checkmate | stalemate | fifty | insufficient
function status(st, legalMoves) {
  const l = legalMoves || legal(st);
  if (!l.length) return inCheck(st) ? 'checkmate' : 'stalemate';
  if (st.half >= 100) return 'fifty';
  if (insufficient(st.b)) return 'insufficient';
  return 'ongoing';
}

// ключ позиции для троекратного повторения (взятие на проходе учитывается, только если оно возможно)
function posKey(st) {
  let ep = '-';
  if (st.ep >= 0) {
    const me = st.turn;
    const pawn = me === 'w' ? 'P' : 'p';
    const rowFrom = me === 'w' ? st.ep + 8 : st.ep - 8;
    const f = st.ep & 7;
    if ((f > 0 && st.b[rowFrom - 1] === pawn) || (f < 7 && st.b[rowFrom + 1] === pawn)) ep = String(st.ep);
  }
  return st.b.map((p) => p || '.').join('') + st.turn + (st.c.K ? 'K' : '') + (st.c.Q ? 'Q' : '') + (st.c.k ? 'k' : '') + (st.c.q ? 'q' : '') + ep;
}

function san(st, m, legalList) {
  const files = 'abcdefgh';
  let core;
  if (m.castle) {
    core = m.castle === 'K' ? 'O-O' : 'O-O-O';
  } else {
    const p = st.b[m.from], t = p.toUpperCase();
    let s = '';
    if (t === 'P') {
      if (m.cap) s += files[m.from & 7];
    } else {
      s += t;
      const others = (legalList || legal(st)).filter((o) => o !== m && st.b[o.from] === p && o.to === m.to);
      if (others.length) {
        const sameFile = others.some((o) => (o.from & 7) === (m.from & 7));
        const sameRank = others.some((o) => (o.from >> 3) === (m.from >> 3));
        if (!sameFile) s += files[m.from & 7];
        else if (!sameRank) s += 8 - (m.from >> 3);
        else s += files[m.from & 7] + (8 - (m.from >> 3));
      }
    }
    if (m.cap) s += 'x';
    s += files[m.to & 7] + (8 - (m.to >> 3));
    if (m.promo) s += '=' + m.promo.toUpperCase();
    core = s;
  }
  const nx = apply(st, m);
  if (inCheck(nx)) core += legal(nx).length ? '+' : '#';
  return core;
}

// ---------- простой бот ----------
const VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
function evaluate(st) { // с точки зрения белых
  let s = 0;
  for (let i = 0; i < 64; i++) {
    const p = st.b[i];
    if (!p) continue;
    const t = p.toLowerCase(), r = i >> 3, f = i & 7;
    const white = p === p.toUpperCase();
    const center = 3.5 - Math.max(Math.abs(f - 3.5), Math.abs(r - 3.5)) + 0.5; // 0..3
    let v = VAL[t];
    if (t === 'n' || t === 'b') v += center * 8;
    if (t === 'p') v += (white ? 6 - r : r - 1) * 6 + (f > 1 && f < 6 ? center * 2 : 0);
    if (t === 'q') v += center * 2;
    s += white ? v : -v;
  }
  return s;
}

function order(st, moves) {
  return moves
    .map((m) => ({ m, k: (m.cap ? 10 * (VAL[(st.b[m.to] || 'p').toLowerCase()] || 100) - VAL[st.b[m.from].toLowerCase()] : 0) + (m.promo ? 800 : 0) }))
    .sort((a, b) => b.k - a.k)
    .map((x) => x.m);
}

function search(st, depth, alpha, beta, ply) {
  const moves = legal(st);
  if (!moves.length) return inCheck(st) ? -99000 + ply : 0;
  if (depth === 0) return (st.turn === 'w' ? 1 : -1) * evaluate(st);
  let best = -Infinity;
  for (const m of order(st, moves)) {
    const v = -search(apply(st, m), depth - 1, -beta, -alpha, ply + 1);
    if (v > best) best = v;
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  return best;
}

// level: 1 — делает ошибки, 2 — думает на 2 хода, 3 — на 3 хода
function bestMove(st, level, moves) {
  const list = moves || legal(st);
  if (!list.length) return null;
  const depth = Math.min(3, Math.max(1, level));
  const scored = order(st, list).map((m) => ({ m, v: -search(apply(st, m), depth - 1, -Infinity, Infinity, 1) + Math.random() * (level === 1 ? 120 : 6) }));
  scored.sort((a, b) => b.v - a.v);
  return scored[0].m;
}

module.exports = { startState, fromFEN, legal, apply, status, inCheck, posKey, san, bestMove, colorOf };
