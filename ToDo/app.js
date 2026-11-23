'use strict';

const cfg = window.RHO_CONFIG || {};
const KEY_STORE = 'rho_todo_key';
const PRI = { '最優先': 4, '高': 3, '中': 2, '低': 1 };

let data = null;      // タスク・日課・勉強・買い物
let yt = null;        // YouTube予約チェック（タブを開いたときに読む）
let ytError = '';
let filter = 'today';
let busy = false;
const prev = {};      // 完了にする前の状態（チェックを外したとき元に戻す用）

const $ = id => document.getElementById(id);

function show(msg, err = false) {
  $('status').textContent = msg || '';
  $('status').className = err ? 'err' : '';
}

function getKey() {
  try { return localStorage.getItem(KEY_STORE) || ''; } catch (e) { return ''; }
}
function setKey(v) {
  try { v ? localStorage.setItem(KEY_STORE, v) : localStorage.removeItem(KEY_STORE); } catch (e) {}
}

// GASへのリクエスト。text/plain で CORS の事前確認を避け、合言葉は本文に入れる（URLに載せない）
async function api(body) {
  const res = await fetch(cfg.GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...body, key: getKey() })
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'エラー');
  return json.data;
}

function needLogin(msg) {
  $('app').hidden = true;
  $('login').hidden = false;
  show(msg || '合言葉を入力してください。', !!msg);
  $('key').focus();
}

const timeNow = () => new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });

async function load() {
  if (!cfg.GAS_URL || cfg.GAS_URL.startsWith('PASTE_')) {
    return show('config.js に GAS のURLを設定してください。', true);
  }
  if (!getKey()) return needLogin();

  show('読み込み中…');
  try {
    data = await api({ action: 'list' });
    $('login').hidden = true;
    $('app').hidden = false;
    render();
    show(`スプレッドシートと同期しました（${timeNow()}）`);
    if (filter === 'youtube') loadYouTube();
  } catch (e) {
    if (e.message === 'auth') { setKey(''); return needLogin('合言葉が違います。'); }
    show('読み込みエラー：' + e.message, true);
  }
}

async function loadYouTube() {
  ytError = '';
  yt = null;
  render();
  try {
    yt = await api({ action: 'youtube' });
  } catch (e) {
    ytError = e.message;
  }
  render();
}

/* ---------- 表示 ---------- */

const isDone = t => t.status === '完了' || t.status === '購入済み';

function cmp(a, b) {
  const pa = PRI[a.priority] || 0, pb = PRI[b.priority] || 0;
  const da = a.due || '9999', db = b.due || '9999';
  if ($('sort').value === 'due') return da < db ? -1 : da > db ? 1 : pb - pa;
  return pb - pa || (da < db ? -1 : da > db ? 1 : 0);
}

const HINTS = {
  today: ['例：明日アカペラ動画を撮る ／ カルテ完了', '「〇〇完了」で完了、それ以外はタスク追加。先頭に 明日・11/30 などで期限つき'],
  tasks: ['例：12/1 申請の書類をそろえる', '「〇〇完了」で完了、それ以外はタスク追加'],
  study: ['例：音響の基礎', 'テーマを書くと追加。「〇〇完了」で完了'],
  shop: ['例：牛乳 2本', '品名を書くと追加（後ろに数量もOK）。「〇〇買った」で購入済み']
};

function render() {
  if (!data) return;
  const t = data.today;

  $('todayLabel').textContent = new Date(t + 'T12:00:00+09:00')
    .toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' });
  const todayTasks = data.tasks.filter(x => !isDone(x) && (!x.due || x.due <= t));
  const left = todayTasks.length + data.routines.filter(x => !isDone(x)).length;
  $('progress').textContent =
    `未完了 ${left}件 ・ 日課の完了 ${data.routines.filter(isDone).length}/${data.routines.length}`;
  $('ring').textContent = left;

  $('sortRow').hidden = !(filter === 'today' || filter === 'tasks');
  $('cmdForm').hidden = filter === 'youtube';
  if (HINTS[filter]) {
    $('cmd').placeholder = HINTS[filter][0];
    $('cmdHint').textContent = HINTS[filter][1] + '（先頭に「買い物 」「勉強 」でどのタブからでも追加）';
  }

  const list = $('list');
  list.replaceChildren();

  if (filter === 'youtube') return renderYouTube(list);

  let groups = [];
  if (filter === 'today') {
    groups = [
      ['単発タスク（期限が今日まで・期限なし）', todayTasks.sort(cmp)],
      ['日課（毎日）', data.routines.slice().sort(cmp)]
    ];
  } else if (filter === 'tasks') {
    groups = [
      ['未完了', data.tasks.filter(x => !isDone(x)).sort(cmp)],
      ['完了済み', data.tasks.filter(isDone).sort(cmp)]
    ];
  } else if (filter === 'study') {
    groups = [
      ['これから', data.study.filter(x => !isDone(x))],
      ['完了', data.study.filter(isDone)]
    ];
  } else if (filter === 'shop') {
    groups = [
      ['買うもの', data.shop.filter(x => !isDone(x))],
      ['購入済み（最近10件）', data.shop.filter(isDone).slice(-10).reverse()]
    ];
  }

  for (const [title, items] of groups) {
    if (!items.length) continue;
    list.append(groupTitle(`${title}　${items.length}件`), ...items.map(x => row(x, t)));
  }
  if (!list.children.length) list.append(emptyBox('まだ何もありません。下の欄から追加できます ✍️'));
}

function groupTitle(text) {
  const h = document.createElement('div');
  h.className = 'group';
  h.textContent = text;
  return h;
}

function emptyBox(text) {
  const e = document.createElement('div');
  e.className = 'empty';
  e.textContent = text;
  return e;
}

function row(x, t) {
  const el = document.createElement('article');
  el.className = 'task' + (isDone(x) ? ' is-done' : '');

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = isDone(x);
  cb.disabled = busy;
  cb.setAttribute('aria-label', x.name + 'を完了にする');
  cb.onchange = () => toggle(x, cb.checked);

  const info = document.createElement('div');
  info.className = 'info';
  const n = document.createElement('div');
  n.className = 'name';
  n.textContent = x.name + (x.qty ? '　' + x.qty : '');
  const m = document.createElement('div');
  m.className = 'meta';
  m.textContent = [x.area, x.routine ? '日課' : '', x.due ? '期限 ' + x.due : '',
    x.status, x.minutes ? x.minutes + '分' : ''].filter(Boolean).join(' · ');
  if (!x.routine && x.due && x.due < t && !isDone(x)) {
    const l = document.createElement('span');
    l.className = 'late';
    l.textContent = ' · 期限切れ';
    m.append(l);
  }
  info.append(n, m);
  if (x.memo) {
    const me = document.createElement('div');
    me.className = 'memo';
    me.textContent = x.memo;
    info.append(me);
  }
  el.append(cb, info);

  if (x.priority !== undefined) {
    const p = document.createElement('span');
    p.className = 'pri p' + (PRI[x.priority] || 0);
    p.textContent = x.priority || '通常';
    el.append(p);
  }
  return el;
}

function renderYouTube(list) {
  if (ytError) {
    list.append(emptyBox('YouTubeを読み込めませんでした：' + ytError));
    return;
  }
  if (!yt) {
    list.append(emptyBox('YouTubeを確認中…'));
    return;
  }
  const filled = yt.slots.filter(s => s.video).length;
  const head = document.createElement('p');
  head.className = 'yt-head';
  head.textContent = `${yt.channel} ・ 次の${yt.slots.length}枠のうち ${filled}枠 予約済み（${yt.checkedAt} 確認）`;
  list.append(head, groupTitle('投稿枠（月・金・日 20:00）'));

  for (const s of yt.slots) {
    const el = document.createElement('article');
    el.className = 'task plain';
    const info = document.createElement('div');
    info.className = 'info';
    const n = document.createElement('div');
    n.className = 'name';
    n.textContent = `${s.at.slice(5, 10).replace('-', '/')}（${s.dow}）${s.at.slice(11)}`;
    const m = document.createElement('div');
    m.className = 'meta';
    m.textContent = s.video
      ? s.video + (s.videoAt.slice(11) !== s.at.slice(11) ? `（${s.videoAt.slice(11)} に予約）` : '')
      : 'まだ予約されていません';
    info.append(n, m);
    const badge = document.createElement('span');
    badge.className = s.video ? 'slot-ok' : 'slot-ng';
    badge.textContent = s.video ? '予約済み' : '未予約';
    el.append(info, badge);
    list.append(el);
  }

  const extra = yt.scheduled.filter(v => !yt.slots.some(s => s.video === v.title && s.videoAt === v.at));
  if (extra.length) {
    list.append(groupTitle('そのほかの予約'));
    extra.forEach(v => list.append(simpleRow(v.title, v.at + ' 公開予定')));
  }
  if (yt.recent.length) {
    list.append(groupTitle('最近公開した動画'));
    yt.recent.forEach(v => list.append(simpleRow(v.title, v.at + ' 公開')));
  }
}

function simpleRow(title, meta) {
  const el = document.createElement('article');
  el.className = 'task plain';
  const info = document.createElement('div');
  info.className = 'info';
  const n = document.createElement('div');
  n.className = 'name';
  n.textContent = title;
  const m = document.createElement('div');
  m.className = 'meta';
  m.textContent = meta;
  info.append(n, m);
  el.append(info);
  return el;
}

/* ---------- 書きこみ ---------- */

async function run(body, okMsg) {
  if (busy) return false;
  busy = true;
  render();
  show('保存中…');
  try {
    data = await api(body);
    show(okMsg);
    return true;
  } catch (e) {
    show('保存できませんでした：' + e.message, true);
    return false;
  } finally {
    busy = false;
    render();
  }
}

function toggle(x, done) {
  const msg = `${x.name} → ${done ? (x.row ? '購入済み' : '完了') : '戻しました'}`;
  if (x.routine) return run({ action: 'routine', id: x.id, done }, msg);
  if (x.row) return run({ action: 'shop', row: x.row, name: x.name, done }, msg);
  if (data.study.includes(x)) return run({ action: 'study', id: x.id, done }, msg);
  if (done) prev[x.id] = x.status;
  return run({ action: 'task', id: x.id, done, prev: done ? x.status : (prev[x.id] || '未着手') }, msg);
}

/* ---------- かんたん命令 ---------- */

const ymd = d => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(d);

function parseDue(text) {
  const base = new Date(data.today + 'T12:00:00+09:00');
  let m;
  if ((m = text.match(/^(今日|きょう)(まで|までに|は|に)?\s*/))) return [data.today, text.slice(m[0].length)];
  if ((m = text.match(/^(明日|あした)(まで|までに|は|に)?\s*/))) return [ymd(new Date(base.getTime() + 864e5)), text.slice(m[0].length)];
  if ((m = text.match(/^(明後日|あさって)(まで|までに|は|に)?\s*/))) return [ymd(new Date(base.getTime() + 2 * 864e5)), text.slice(m[0].length)];
  if ((m = text.match(/^(\d{1,2})[\/月](\d{1,2})日?(まで|までに|に)?\s*/))) {
    let y = Number(data.today.slice(0, 4));
    const d = `${y}-${('0' + m[1]).slice(-2)}-${('0' + m[2]).slice(-2)}`;
    return [d < data.today ? `${y + 1}${d.slice(4)}` : d, text.slice(m[0].length)];
  }
  return ['', text];
}

const DONE_RE = /^(.+?)\s*(を)?\s*(完了|終わった|おわった|できた|済み|すんだ|買った|かった)(よ|！|!|。)?$/;

async function sendCmd() {
  let text = $('cmd').value.trim();
  if (!text || !data || busy) return;

  let target = filter === 'study' ? 'study' : filter === 'shop' ? 'shop' : 'task';
  let m;
  if ((m = text.match(/^(買い物|かいもの)[:：\s]\s*/))) { target = 'shop'; text = text.slice(m[0].length); }
  else if ((m = text.match(/^勉強[:：\s]\s*/))) { target = 'study'; text = text.slice(m[0].length); }

  let ok = false;
  const done = text.match(DONE_RE);

  if (done) {
    const key = done[1].replace(/\s+/g, '');
    const pool = target === 'shop' ? data.shop : target === 'study' ? data.study : [...data.tasks, ...data.routines];
    const hits = pool.filter(x => !isDone(x) && (x.name.replace(/\s+/g, '').includes(key) || key.includes(x.name.replace(/\s+/g, ''))));
    if (hits.length === 1) ok = await toggle(hits[0], true);
    else return show(hits.length ? `候補が${hits.length}件あります（${hits.map(h => h.name).join('／')}）。もう少し詳しく書いてね` : `「${key}」に当てはまる未完了のものが見つかりません`, true);
  } else if (target === 'shop') {
    const q = text.match(/^(.+?)\s+(\d+\S*)$/);
    ok = await run({ action: 'addShop', name: q ? q[1] : text, qty: q ? q[2] : '' }, `買い物リストに追加：${q ? q[1] : text}`);
  } else if (target === 'study') {
    ok = await run({ action: 'addStudy', name: text }, `勉強リストに追加：${text}`);
  } else {
    const [due, name] = parseDue(text);
    if (!name.trim()) return show('タスク名を入れてね', true);
    ok = await run({ action: 'addTask', name: name.trim(), due }, `タスク追加：${name.trim()}${due ? '（期限 ' + due + '）' : ''}`);
  }
  if (ok) $('cmd').value = '';
}

/* ---------- 起動 ---------- */

window.addEventListener('DOMContentLoaded', () => {
  $('login').onsubmit = e => {
    e.preventDefault();
    const v = $('key').value.trim();
    if (!v) return;
    setKey(v);
    $('key').value = '';
    load();
  };
  $('logout').onclick = () => { setKey(''); data = null; yt = null; needLogin(); };
  $('reload').onclick = load;
  $('sort').onchange = render;
  $('cmdForm').onsubmit = e => { e.preventDefault(); sendCmd(); };
  document.querySelectorAll('.tabs button').forEach(b => {
    b.onclick = () => {
      filter = b.dataset.f;
      document.querySelectorAll('.tabs button').forEach(o => o.classList.toggle('active', o === b));
      if (filter === 'youtube' && !yt && !ytError) loadYouTube();
      render();
    };
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && data && !busy) load();
  });
  load();
});
