// APEX GP — Telegram-бот: кнопка «Гонка» в меню, приветствие с кнопкой запуска, команды.
// Работает через webhook: Telegram сам будит бесплатный сервер Render, когда пишут боту.
// Токен берётся ТОЛЬКО из переменной окружения BOT_TOKEN (в код его не вписывать — репозиторий публичный).
const crypto = require('crypto');

const TOKEN = process.env.BOT_TOKEN || '';
const API = (process.env.TG_API || 'https://api.telegram.org') + '/bot' + TOKEN;
const GAME_URL = process.env.GAME_URL || 'https://ars727973-ux.github.io/apexgp/game/';
const PUBLIC_URL = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
const SECRET = crypto.createHash('sha256').update('apexgp:' + TOKEN).digest('hex').slice(0, 40);
const HOOK_PATH = '/tg/' + SECRET.slice(0, 16);

async function tg(method, body) {
  try {
    const r = await fetch(API + '/' + method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
    const j = await r.json();
    if (!j.ok) console.log('[bot]', method, 'ошибка:', j.description);
    return j;
  } catch (e) { console.log('[bot]', method, 'нет связи:', e.message); return { ok: false }; }
}

const playKb = (text) => ({ inline_keyboard: [[{ text: text || '🏁 Играть', web_app: { url: GAME_URL } }]] });

const TEXT = {
  start: (name) =>
    `🏎 <b>APEX GP</b> — гонки на болидах Формулы-1 прямо в Telegram.\n\n` +
    `${name ? name + ', ' : ''}жми «Играть» и выходи на старт:\n` +
    `• 340 км/ч, 5 трасс, старт по пяти красным огням с замером реакции\n` +
    `• вид из кокпита или от третьего лица\n` +
    `• реалистичные аварии: вмятины, огонь, отлетающие колёса\n` +
    `• карьера, магазин болидов и тюнинга, свой шлем и номер\n` +
    `• онлайн-гонки с друзьями до 8 пилотов\n\n` +
    `Прогресс сохраняется в твоём аккаунте Telegram.`,
  help:
    `<b>Управление</b>\n` +
    `Телефон: кнопки ◀ ▶ — руль, справа ГАЗ и ТОРМОЗ. В настройках можно включить руль свайпом или наклоном.\n` +
    `Компьютер: стрелки или WASD, C — камера, Esc — пауза.\n\n` +
    `<b>Советы</b>\n` +
    `• Газ жми, когда погаснут все пять огней. Раньше — фальстарт +5 с.\n` +
    `• Уткнулся в стену — просто жми газ, машина сама развернётся.\n` +
    `• Задний ход: остановись и держи тормоз.\n` +
    `• После аварии через 5 секунд появится кнопка «Телепорт».\n\n` +
    `/race — онлайн-гонка с друзьями`,
  race:
    `👥 <b>Онлайн-гонка</b>\n` +
    `1. Открой игру → «Онлайн» → «Создать комнату».\n` +
    `2. Отправь друзьям код комнаты из 4 букв.\n` +
    `3. Друзья: «Онлайн» → «Войти по коду».\n` +
    `4. Когда все в комнате, нажми «Старт гонки».`
};

async function onUpdate(u) {
  const m = u.message;
  if (!m || !m.chat) return;
  const chat = m.chat.id, text = (m.text || '').trim(), cmd = text.split(/[\s@]/)[0].toLowerCase();
  const name = m.from && m.from.first_name ? m.from.first_name : '';
  if (cmd === '/start' || cmd === '/play') await tg('sendMessage', { chat_id: chat, text: TEXT.start(name), parse_mode: 'HTML', reply_markup: playKb('🏁 Играть') });
  else if (cmd === '/help') await tg('sendMessage', { chat_id: chat, text: TEXT.help, parse_mode: 'HTML', reply_markup: playKb('🏁 Играть') });
  else if (cmd === '/race') await tg('sendMessage', { chat_id: chat, text: TEXT.race, parse_mode: 'HTML', reply_markup: playKb('👥 Открыть онлайн') });
  else await tg('sendMessage', { chat_id: chat, text: 'Жми кнопку, чтобы начать гонку 🏁', reply_markup: playKb('🏁 Играть') });
}

// обработчик HTTP-запросов от Telegram; возвращает true, если запрос был боту
function handle(req, res) {
  if (!TOKEN || req.method !== 'POST' || req.url !== HOOK_PATH) return false;
  if (req.headers['x-telegram-bot-api-secret-token'] !== SECRET) { res.writeHead(403); res.end(); return true; }
  let body = '';
  req.on('data', c => { body += c; if (body.length > 1e6) req.destroy(); });
  req.on('end', () => {
    res.writeHead(200); res.end('ok');
    let u; try { u = JSON.parse(body); } catch (e) { return; }
    onUpdate(u).catch(e => console.log('[bot] ошибка:', e.message));
  });
  return true;
}

async function setup() {
  if (!TOKEN) { console.log('[bot] BOT_TOKEN не задан — бот выключен, работает только онлайн-сервер'); return; }
  const me = await tg('getMe');
  if (!me.ok) { console.log('[bot] токен не подошёл'); return; }
  console.log('[bot] запущен как @' + me.result.username);
  await tg('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Гонка', web_app: { url: GAME_URL } } });
  await tg('setMyCommands', { commands: [
    { command: 'start', description: 'Начать гонку' },
    { command: 'race', description: 'Онлайн-гонка с друзьями' },
    { command: 'help', description: 'Управление и советы' }
  ] });
  await tg('setMyShortDescription', { short_description: 'Гонки на болидах F1: 340 км/ч, кокпит, аварии, карьера, онлайн.' });
  await tg('setMyDescription', { description: 'APEX GP — 3D-гонки на болидах Формулы-1. Старт по огням с замером реакции, вид из кокпита, реалистичные аварии, карьера, магазин болидов и тюнинга, онлайн с друзьями. Жми «Старт»!' });
  if (PUBLIC_URL) {
    const r = await tg('setWebhook', { url: PUBLIC_URL + HOOK_PATH, secret_token: SECRET, allowed_updates: ['message'], drop_pending_updates: false });
    if (r.ok) console.log('[bot] webhook установлен');
  } else console.log('[bot] PUBLIC_URL не известен — webhook не установлен (на Render задаётся сам)');
}

module.exports = { handle, setup, HOOK_PATH, SECRET };
