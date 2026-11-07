const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
// На Render можно подключить Disk и указать DATA_FILE=/data/data.json
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');

const MAX_FILES = 50;
const MAX_FILE_SIZE = 100_000; // символов
const MAX_CHAT_HISTORY = 100;
const MAX_MSG_LEN = 500;
const MAX_NICK_LEN = 20;
const FILE_NAME_RE = /^[a-zA-Z0-9_-]{1,32}\.[a-zA-Z0-9]{1,8}$/;

const DEFAULT_MAIN = `-- Это общий файл: его видят и правят все посетители.
-- Модули — тоже общие. Создай файл utils.lua и подключи его так:
local ok, utils = pcall(require, "utils")
if ok then
  print(utils.hello("мир"))
else
  print("Создай файл utils.lua слева, чтобы подключить модуль")
end

for i = 1, 3 do
  print("строка " .. i)
end
`;

// ---------- состояние ----------
let state = {
  files: { 'main.lua': DEFAULT_MAIN },
  chat: [],
  charts: {},
  scores: {},
};

try {
  const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  if (raw && raw.files && typeof raw.files === 'object') {
    state.files = raw.files;
    state.chat = Array.isArray(raw.chat) ? raw.chat.slice(-MAX_CHAT_HISTORY) : [];
    if (raw.charts && typeof raw.charts === 'object') state.charts = raw.charts;
    if (raw.scores && typeof raw.scores === 'object') state.scores = raw.scores;
  }
} catch (_) {
  /* первый запуск — файла ещё нет */
}
if (!state.files['main.lua']) state.files['main.lua'] = DEFAULT_MAIN;

let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fs.writeFile(DATA_FILE, JSON.stringify(state), (err) => {
      if (err) console.error('Не удалось сохранить:', err.message);
    });
  }, 2000);
}

// ---------- игра: треки, рекорды, вызовы, матчи ----------
const MAX_CHARTS = 50;
const MAX_MEASURES = 32;
const MAX_TITLE = 40;
const MAX_URL = 500;
const popcnt = (n) => (n & 1) + ((n >> 1) & 1) + ((n >> 2) & 1) + ((n >> 3) & 1);
const noteCount = (c) => c.steps.reduce((a, m) => a + popcnt(m), 0);
const rid = () => crypto.randomBytes(4).toString('hex');
const clamp = (v, a, b) => Math.min(b, Math.max(a, Number(v) || 0));

function demoChart() {
  const steps = [];
  for (let m = 0; m < 8; m++) {
    for (let s = 0; s < 16; s++) steps.push(s % 2 === 0 ? 1 << ((s / 2 + m) % 4) : 0);
  }
  return {
    id: 'demo', title: 'Демо (без музыки)', author: 'система', url: '', bpm: 120,
    offset: 1000, measures: 8, speed: 10, steps, ts: 0,
  };
}

function validateChart(c) {
  if (!c || typeof c !== 'object') return null;
  const title = cleanText(c.title, MAX_TITLE).trim();
  const url = cleanText(c.url, MAX_URL).trim();
  const bpm = Number(c.bpm);
  const offset = Math.round(Number(c.offset));
  const measures = Math.round(Number(c.measures));
  if (!title) return null;
  if (url && !/^https?:\/\/\S+$/i.test(url)) return null;
  if (!(bpm >= 40 && bpm <= 300)) return null;
  if (!(offset >= -5000 && offset <= 600000)) return null;
  if (!(measures >= 1 && measures <= MAX_MEASURES)) return null;
  if (!Array.isArray(c.steps) || c.steps.length !== measures * 16) return null;
  if (!c.steps.every((x) => Number.isInteger(x))) return null;
  const steps = c.steps.map((x) => x & 15);
  if (!steps.some(Boolean)) return null;
  return {
    title, url, bpm: Math.round(bpm * 100) / 100, offset, measures,
    speed: Math.round(clamp(c.speed || 10, 1, 20)), steps,
  };
}

function computeBoard() {
  const charts = {};
  const totals = {};
  for (const [cid, byNick] of Object.entries(state.scores)) {
    if (!Object.hasOwn(state.charts, cid)) continue;
    const list = Object.values(byNick)
      .map((s) => ({ nick: s.nick, score: s.score, acc: s.acc }))
      .sort((a, b) => b.score - a.score);
    charts[cid] = list.slice(0, 10);
    for (const e of list) {
      const t = (totals['n_' + e.nick] ||= { nick: e.nick, total: 0, charts: 0 });
      t.total += e.score;
      t.charts++;
    }
  }
  const global = Object.values(totals).sort((a, b) => b.total - a.total).slice(0, 20);
  return { charts, global };
}

function sendTo(ws, obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

const byId = (id) => {
  for (const c of wss.clients) if (c.id === id) return c;
  return null;
};

function playersList() {
  return [...wss.clients].filter((c) => c.nick).map((c) => ({ id: c.id, nick: c.nick, busy: !!c.match }));
}
function sendPlayers() {
  broadcast({ type: 'players', list: playersList() });
}

// вызовы на матч: id вызывающего -> { to: id | 'all', chartId, ts }
const challenges = new Map();

function lobbyFor(ws) {
  const list = [];
  for (const [from, ch] of challenges) {
    if (from === ws.id || ch.to === 'all' || ch.to === ws.id) {
      const o = byId(from);
      list.push({ from, nick: o?.nick || 'Гость', to: ch.to, chartId: ch.chartId, mine: from === ws.id });
    }
  }
  return list;
}
function sendLobby() {
  for (const c of wss.clients) sendTo(c, { type: 'lobby', list: lobbyFor(c) });
}

function startMatch(a, b, chartId) {
  for (const [from, ch] of challenges) {
    if (from === a.id || from === b.id || ch.to === a.id || ch.to === b.id) challenges.delete(from);
  }
  const mt = { id: rid(), chartId, players: [a, b], results: new Map() };
  a.match = b.match = mt;
  for (const [x, y] of [[a, b], [b, a]]) {
    sendTo(x, { type: 'match_start', matchId: mt.id, chartId, opponent: { id: y.id, nick: y.nick } });
  }
  sendLobby();
  sendPlayers();
}

function leaveMatch(ws) {
  const mt = ws.match;
  if (!mt) return;
  ws.match = null;
  const opp = mt.players.find((p) => p !== ws);
  if (opp && opp.match === mt) {
    opp.match = null;
    sendTo(opp, { type: 'match_abort', nick: ws.nick });
  }
  sendPlayers();
}

function handleGame(ws, m, now) {
  const num = (v, a, b) => clamp(v, a, b);
  switch (m.type) {
    case 'hello':
      ws.nick = cleanText(m.nick, MAX_NICK_LEN).trim() || 'Гость';
      sendPlayers();
      sendLobby();
      return true;

    case 'chart_save': {
      const v = validateChart(m.chart);
      if (!v) return sendTo(ws, { type: 'error', text: 'Некорректный трек (проверь название, ссылку, BPM и ноты)' }), true;
      const id = m.chart.id;
      let chart;
      let changed = false;
      if (typeof id === 'string' && Object.hasOwn(state.charts, id) && id !== 'demo') {
        const old = state.charts[id];
        changed = JSON.stringify([old.steps, old.bpm, old.offset]) !== JSON.stringify([v.steps, v.bpm, v.offset]);
        chart = { ...old, ...v };
        if (changed) delete state.scores[id];
      } else {
        if (Object.keys(state.charts).length >= MAX_CHARTS) {
          return sendTo(ws, { type: 'error', text: 'Слишком много треков, удали ненужные' }), true;
        }
        chart = { id: rid(), author: cleanText(m.nick, MAX_NICK_LEN).trim() || ws.nick || 'Гость', ts: now, ...v };
      }
      state.charts[chart.id] = chart;
      broadcast({ type: 'chart', chart });
      if (changed) broadcast({ type: 'board', board: computeBoard() });
      scheduleSave();
      return true;
    }

    case 'chart_delete': {
      const id = String(m.id);
      if (id === 'demo' || !Object.hasOwn(state.charts, id)) return true;
      delete state.charts[id];
      delete state.scores[id];
      broadcast({ type: 'chart_delete', id });
      broadcast({ type: 'board', board: computeBoard() });
      scheduleSave();
      return true;
    }

    case 'score': {
      const id = String(m.chartId);
      if (!Object.hasOwn(state.charts, id)) return true;
      const nick = cleanText(m.nick, MAX_NICK_LEN).trim() || 'Гость';
      const score = Math.round(num(m.score, 0, 1e9));
      const acc = num(m.acc, 0, 100);
      if (score > noteCount(state.charts[id]) * 600) return true; // больше максимума быть не может
      const byNick = (state.scores[id] ||= {});
      const key = 'n_' + nick;
      if (!byNick[key] || byNick[key].score < score) {
        byNick[key] = { nick, score, acc: Math.round(acc * 100) / 100, ts: now };
        broadcast({ type: 'board', board: computeBoard() });
        scheduleSave();
      }
      return true;
    }

    case 'challenge': {
      if (ws.match || !Object.hasOwn(state.charts, String(m.chartId))) return true;
      const to = m.to === 'all' ? 'all' : String(m.to);
      if (to !== 'all' && (to === ws.id || !byId(to))) return true;
      challenges.set(ws.id, { to, chartId: String(m.chartId), ts: now });
      sendLobby();
      return true;
    }

    case 'cancel':
      if (challenges.delete(ws.id)) sendLobby();
      return true;

    case 'decline': {
      const ch = challenges.get(String(m.from));
      if (ch && ch.to === ws.id) {
        challenges.delete(String(m.from));
        sendTo(byId(String(m.from)), { type: 'declined', nick: ws.nick });
        sendLobby();
      }
      return true;
    }

    case 'accept': {
      const from = String(m.from);
      const ch = challenges.get(from);
      const challenger = byId(from);
      if (!ch || !challenger || challenger === ws || challenger.match || ws.match) return true;
      if (ch.to !== 'all' && ch.to !== ws.id) return true;
      startMatch(challenger, ws, ch.chartId);
      return true;
    }

    case 'match_progress': {
      const mt = ws.match;
      if (!mt) return true;
      const opp = mt.players.find((p) => p !== ws);
      sendTo(opp, {
        type: 'opp_progress', score: num(m.score, 0, 1e9), combo: num(m.combo, 0, 1e5), acc: num(m.acc, 0, 100),
      });
      return true;
    }

    case 'match_finish': {
      const mt = ws.match;
      if (!mt || mt.results.has(ws)) return true;
      mt.results.set(ws, {
        score: Math.round(num(m.score, 0, 1e9)), acc: num(m.acc, 0, 100), maxCombo: Math.round(num(m.maxCombo, 0, 1e5)),
      });
      if (mt.results.size === 2) {
        const [a, b] = mt.players;
        const ra = mt.results.get(a);
        const rb = mt.results.get(b);
        const w = ra.score === rb.score ? 'draw' : ra.score > rb.score ? 'a' : 'b';
        sendTo(a, { type: 'match_result', you: ra, opp: rb, oppNick: b.nick, winner: w === 'draw' ? 'draw' : w === 'a' ? 'you' : 'opp' });
        sendTo(b, { type: 'match_result', you: rb, opp: ra, oppNick: a.nick, winner: w === 'draw' ? 'draw' : w === 'b' ? 'you' : 'opp' });
        a.match = b.match = null;
        sendPlayers();
      }
      return true;
    }

    case 'match_leave':
      if (ws.match && !ws.match.results.has(ws)) leaveMatch(ws);
      return true;

    default:
      return false;
  }
}

if (!Object.keys(state.charts).length) state.charts.demo = demoChart();

// ---------- HTTP ----------
const app = express();
app.get('/healthz', (_req, res) => res.send('ok'));
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 256 * 1024 });

function broadcast(obj, except) {
  const data = JSON.stringify(obj);
  for (const client of wss.clients) {
    if (client !== except && client.readyState === 1) client.send(data);
  }
}

function broadcastOnline() {
  broadcast({ type: 'online', count: wss.clients.size });
}

function cleanText(value, max) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, max);
}

function pushChat(msg) {
  state.chat.push(msg);
  if (state.chat.length > MAX_CHAT_HISTORY) state.chat.shift();
  broadcast({ type: 'chat', msg });
  scheduleSave();
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.id = rid();
  ws.nick = null;
  ws.match = null;
  ws.on('pong', () => (ws.isAlive = true));

  // простой лимит: не больше 60 сообщений в секунду с одного клиента
  let windowStart = Date.now();
  let count = 0;

  sendTo(ws, {
    type: 'init', files: state.files, chat: state.chat, online: wss.clients.size,
    charts: state.charts, board: computeBoard(), you: ws.id, players: playersList(), lobby: lobbyFor(ws),
  });
  broadcastOnline();

  ws.on('message', (buf) => {
    const now = Date.now();
    if (now - windowStart > 1000) {
      windowStart = now;
      count = 0;
    }
    if (++count > 60) return;

    let m;
    try {
      m = JSON.parse(buf.toString());
    } catch {
      return;
    }

    switch (m.type) {
      case 'edit': {
        const name = String(m.name);
        if (!(Object.hasOwn(state.files, name))) return;
        const content = cleanText(m.content, MAX_FILE_SIZE);
        state.files[name] = content;
        broadcast({ type: 'file', name, content }, ws);
        scheduleSave();
        break;
      }
      case 'create': {
        const name = String(m.name);
        if (!FILE_NAME_RE.test(name) || Object.hasOwn(state.files, name)) return;
        if (Object.keys(state.files).length >= MAX_FILES) return;
        const template = `local M = {}\n\nfunction M.hello(name)\n  return "Привет, " .. name .. "!"\nend\n\nreturn M\n`;
        const content =
          typeof m.content === 'string'
            ? cleanText(m.content, MAX_FILE_SIZE)
            : name.endsWith('.lua') ? template : '';
        state.files[name] = content;
        broadcast({ type: 'file', name, content, created: true });
        scheduleSave();
        break;
      }
      case 'delete': {
        const name = String(m.name);
        if (name === 'main.lua' || !(Object.hasOwn(state.files, name))) return;
        delete state.files[name];
        broadcast({ type: 'delete', name });
        scheduleSave();
        break;
      }
      case 'chat': {
        const text = cleanText(m.text, MAX_MSG_LEN).trim();
        if (!text) return;
        const nick = cleanText(m.nick, MAX_NICK_LEN).trim() || 'Гость';
        pushChat({ nick, text, ts: now });
        break;
      }
      case 'ran': {
        const nick = cleanText(m.nick, MAX_NICK_LEN).trim() || 'Гость';
        const name = String(m.name);
        if (!(Object.hasOwn(state.files, name))) return;
        pushChat({ system: true, text: `${nick} запустил ${name}`, ts: now });
        break;
      }
      default:
        handleGame(ws, m, now); // игровые сообщения; ping и неизвестные игнорируются
    }
  });

  ws.on('close', () => {
    leaveMatch(ws);
    let changed = false;
    for (const [from, c] of challenges) {
      if (from === ws.id || c.to === ws.id) {
        challenges.delete(from);
        changed = true;
      }
    }
    broadcastOnline();
    sendPlayers();
    if (changed) sendLobby();
  });
});

// выкидываем «мёртвые» соединения
setInterval(() => {
  const now = Date.now();
  let expired = false;
  for (const [from, c] of challenges) {
    if (now - c.ts > 5 * 60 * 1000) {
      challenges.delete(from);
      expired = true;
    }
  }
  if (expired) sendLobby();
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

server.listen(PORT, () => console.log(`Слушаю порт ${PORT}`));
