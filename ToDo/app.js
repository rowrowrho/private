'use strict';

const cfg = window.RHO_CONFIG || {};
const KEY_STORE = 'rho_todo_key';
const PRI = { '最優先': 4, '高': 3, '中': 2, '低': 1 };

let data = null;
let filter = 'today';
let busy = false;
const prev = {}; // 完了にする前の状態（チェックを外したとき元に戻す用）

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

// GASへのリクエスト。text/plain にして CORS の事前確認を避ける。合言葉は本文に入れる（URLには載せない）
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
    show('スプレッドシートと同期しました（' +
      new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) + '）');
  } catch (e) {
    if (e.message === 'auth') { setKey(''); return needLogin('合言葉が違います。'); }
    show('読み込みエラー：' + e.message, true);
  }
}

const isDone = t => t.status === '完了';

function cmp(a, b) {
  const pa = PRI[a.priority] || 0, pb = PRI[b.priority] || 0;
  const da = a.due || '9999', db = b.due || '9999';
  if ($('sort').value === 'due') return da < db ? -1 : da > db ? 1 : pb - pa;
  return pb - pa || (da < db ? -1 : da > db ? 1 : 0);
}

function render() {
  if (!data) return;
  const t = data.today;
  const { tasks, routines } = data;

  $('todayLabel').textContent = new Date(t + 'T12:00:00+09:00')
    .toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' });

  const todayTasks = tasks.filter(x => !isDone(x) && (!x.due || x.due <= t));
  const left = todayTasks.length + routines.filter(x => !isDone(x)).length;
  $('progress').textContent =
    `未完了 ${left}件 ・ 日課の完了 ${routines.filter(isDone).length}/${routines.length}`;
  $('ring').textContent = left;

  let groups;
  if (filter === 'today') {
    groups = [
      ['単発タスク（期限が今日まで・期限なし）', todayTasks.sort(cmp)],
      ['日課（毎日）', routines.slice().sort(cmp)]
    ];
  } else if (filter === 'all') {
    groups = [
      ['未完了', tasks.filter(x => !isDone(x)).sort(cmp)],
      ['完了済み', tasks.filter(isDone).sort(cmp)]
    ];
  } else {
    groups = [
      ['完了済みタスク', tasks.filter(isDone).sort(cmp)],
      ['今日完了した日課', routines.filter(isDone)]
    ];
  }

  const list = $('list');
  list.replaceChildren();
  for (const [title, items] of groups) {
    if (!items.length) continue;
    const h = document.createElement('div');
    h.className = 'group';
    h.textContent = `${title}　${items.length}件`;
    list.append(h, ...items.map(x => row(x, t)));
  }
  if (!list.children.length) {
    const e = document.createElement('div');
    e.className = 'empty';
    e.textContent = '該当するタスクはありません 🎉';
    list.append(e);
  }
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
  n.textContent = x.name;
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

  const p = document.createElement('span');
  p.className = 'pri p' + (PRI[x.priority] || 0);
  p.textContent = x.priority || '通常';

  el.append(cb, info, p);
  return el;
}

async function toggle(x, done) {
  if (busy) return;
  busy = true;
  render();
  show('保存中…');
  try {
    if (x.routine) {
      data = await api({ action: 'routine', id: x.id, done });
    } else {
      if (done) prev[x.id] = x.status;
      data = await api({ action: 'task', id: x.id, done,
        prev: done ? x.status : (prev[x.id] || '未着手') });
    }
    show(`${x.name} → ${done ? '完了' : '戻しました'}`);
  } catch (e) {
    show('保存できませんでした：' + e.message, true);
  } finally {
    busy = false;
    render();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  $('login').onsubmit = e => {
    e.preventDefault();
    const v = $('key').value.trim();
    if (!v) return;
    setKey(v);
    $('key').value = '';
    load();
  };
  $('logout').onclick = () => { setKey(''); data = null; needLogin(); };
  $('reload').onclick = load;
  $('sort').onchange = render;
  document.querySelectorAll('.tabs button').forEach(b => {
    b.onclick = () => {
      filter = b.dataset.f;
      document.querySelectorAll('.tabs button').forEach(o => o.classList.toggle('active', o === b));
      render();
    };
  });
  // スマホでアプリに戻ってきたら自動で最新にする
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && data && !busy) load();
  });
  load();
});
