// APEX GP — онлайн-сервер (комнаты до 8 пилотов, ретрансляция положения машин)
// Запуск: npm install && npm start   (порт берётся из переменной PORT, по умолчанию 8080)
const http = require('http');
const { WebSocketServer } = require('ws');
const bot = require('./bot');

const PORT = process.env.PORT || 8080;
const MAX_PLAYERS = 8;
const TRACK_COUNT = 5;

const server = http.createServer((req, res) => {
  if (bot.handle(req, res)) return; // запросы от Telegram
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'access-control-allow-origin': '*' });
  res.end('APEX GP server ok. Rooms: ' + rooms.size + ', players: ' + wss.clients.size);
});
const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });

const rooms = new Map();
let nextId = 1;

function code() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c; do { c = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join(''); } while (rooms.has(c));
  return c;
}
function send(ws, o) { if (ws.readyState === 1) ws.send(JSON.stringify(o)); }
function roomInfo(r) {
  return { t: 'room', code: r.code, host: r.host, track: r.track, laps: r.laps, status: r.status, pub: r.pub,
    players: [...r.players.values()].map(p => ({ id: p.id, name: p.name, c1: p.c1, c2: p.c2, flag: p.flag })) };
}
function broadcast(r, o, except) { const s = JSON.stringify(o); for (const p of r.players.values()) if (p !== except && p.ws.readyState === 1) p.ws.send(s); }
function update(r) { broadcast(r, roomInfo(r)); }

function makeRoom(pub) {
  const r = { code: code(), host: null, players: new Map(), track: 0, laps: 3, status: 'lobby', pub, results: {}, finTimer: null, created: Date.now() };
  rooms.set(r.code, r); return r;
}
function joinRoom(p, r) {
  if (r.players.size >= MAX_PLAYERS) return send(p.ws, { t: 'err', msg: 'Комната заполнена' });
  if (r.status !== 'lobby') return send(p.ws, { t: 'err', msg: 'В этой комнате уже идёт гонка' });
  leaveRoom(p);
  r.players.set(p.id, p); p.room = r; if (!r.host) r.host = p.id;
  update(r);
}
function leaveRoom(p) {
  const r = p.room; if (!r) return;
  r.players.delete(p.id); p.room = null;
  broadcast(r, { t: 'left', id: p.id });
  if (r.players.size === 0) { clearTimeout(r.finTimer); rooms.delete(r.code); return; }
  if (r.host === p.id) r.host = r.players.keys().next().value;
  if (r.status === 'race') checkFinish(r);
  update(r);
}
function checkFinish(r) {
  const all = [...r.players.values()].every(p => r.results[p.id]);
  if (all) endRace(r);
  else if (!r.finTimer && Object.keys(r.results).length) r.finTimer = setTimeout(() => endRace(r), 60000);
}
function endRace(r) {
  clearTimeout(r.finTimer); r.finTimer = null;
  if (r.status !== 'race') return;
  broadcast(r, { t: 'results', res: r.results });
  r.status = 'lobby'; r.results = {}; update(r);
}

wss.on('connection', (ws) => {
  const p = { id: 'p' + (nextId++), ws, name: 'Пилот', c1: 0xd11a1a, c2: 0xf2c200, room: null, alive: true };
  send(ws, { t: 'welcome', id: p.id });
  ws.on('pong', () => { p.alive = true; });
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    const r = p.room;
    switch (m.t) {
      case 's': if (r && r.status === 'race') broadcast(r, { t: 's', id: p.id, d: m.d }, p); break;
      case 'ev': if (r) broadcast(r, { t: 'ev', id: p.id, e: m.e }, p); break;
      case 'hello':
        p.name = String(m.name || 'Пилот').slice(0, 20);
        p.c1 = Number(m.c1) || p.c1; p.c2 = Number(m.c2) || p.c2;
        p.look = typeof m.look === 'string' ? m.look.slice(0, 800) : null; // внешность болида и шлема
        p.flag = typeof m.flag === 'string' ? m.flag.slice(0, 4) : null; break;
      case 'quick': {
        let found = null;
        for (const x of rooms.values()) if (x.pub && x.status === 'lobby' && x.players.size < MAX_PLAYERS) { found = x; break; }
        joinRoom(p, found || makeRoom(true)); break;
      }
      case 'create': joinRoom(p, makeRoom(false)); break;
      case 'join': {
        const x = rooms.get(String(m.code || '').toUpperCase());
        if (!x) send(ws, { t: 'err', msg: 'Комната не найдена' }); else joinRoom(p, x); break;
      }
      case 'leave': leaveRoom(p); break;
      case 'cfg':
        if (r && r.host === p.id && r.status === 'lobby') {
          r.track = Math.max(0, Math.min(TRACK_COUNT - 1, m.track | 0)); r.laps = Math.max(1, Math.min(10, m.laps | 0)); update(r);
        } break;
      case 'start':
        if (r && r.host === p.id && r.status === 'lobby') {
          r.status = 'race'; r.results = {};
          const order = [...r.players.values()].sort(() => Math.random() - 0.5).map((q, i) => ({ id: q.id, name: q.name, c1: q.c1, c2: q.c2, n: i + 1, look: q.look, flag: q.flag }));
          broadcast(r, { t: 'start', track: r.track, laps: r.laps, hold: 0.6 + Math.random() * 2, order });
          update(r);
        } break;
      case 'fin':
        if (r && r.status === 'race' && !r.results[p.id]) {
          r.results[p.id] = { time: Number(m.time) || 9999, best: m.best == null ? null : Number(m.best) };
          broadcast(r, { t: 'results', res: r.results }); checkFinish(r);
        } break;
    }
  });
  ws.on('close', () => leaveRoom(p));
});

// пинг — выкидываем «мёртвые» соединения
setInterval(() => {
  for (const ws of wss.clients) { if (ws._dead) { ws.terminate(); continue; } ws._dead = true; ws.ping(); }
}, 30000);
wss.on('connection', ws => ws.on('pong', () => { ws._dead = false; }));

server.listen(PORT, () => { console.log('APEX GP server on :' + PORT); bot.setup(); });
