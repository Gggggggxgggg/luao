const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
// На Render можно подключить Disk и указать DATA_FILE=/data/data.json
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');

const MAX_FILES = 50;
const MAX_FILE_SIZE = 100_000; // символов
const MAX_CHAT_HISTORY = 100;
const MAX_MSG_LEN = 500;
const MAX_NICK_LEN = 20;
const FILE_NAME_RE = /^[a-zA-Z0-9_-]{1,32}\.lua$/;

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
};

try {
  const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  if (raw && raw.files && typeof raw.files === 'object') {
    state.files = raw.files;
    state.chat = Array.isArray(raw.chat) ? raw.chat.slice(-MAX_CHAT_HISTORY) : [];
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
  ws.on('pong', () => (ws.isAlive = true));

  // простой лимит: не больше 60 сообщений в секунду с одного клиента
  let windowStart = Date.now();
  let count = 0;

  ws.send(JSON.stringify({ type: 'init', files: state.files, chat: state.chat, online: wss.clients.size }));
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
        if (!(name in state.files)) return;
        const content = cleanText(m.content, MAX_FILE_SIZE);
        state.files[name] = content;
        broadcast({ type: 'file', name, content }, ws);
        scheduleSave();
        break;
      }
      case 'create': {
        const name = String(m.name);
        if (!FILE_NAME_RE.test(name) || name in state.files) return;
        if (Object.keys(state.files).length >= MAX_FILES) return;
        const content = `local M = {}\n\nfunction M.hello(name)\n  return "Привет, " .. name .. "!"\nend\n\nreturn M\n`;
        state.files[name] = content;
        broadcast({ type: 'file', name, content, created: true });
        scheduleSave();
        break;
      }
      case 'delete': {
        const name = String(m.name);
        if (name === 'main.lua' || !(name in state.files)) return;
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
        if (!(name in state.files)) return;
        pushChat({ system: true, text: `${nick} запустил ${name}`, ts: now });
        break;
      }
      default:
        break; // ping и неизвестные сообщения игнорируем
    }
  });

  ws.on('close', broadcastOnline);
});

// выкидываем «мёртвые» соединения
setInterval(() => {
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
