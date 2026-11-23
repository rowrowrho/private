
'use strict';

const cfg = window.RHO_CONFIG || {};
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const API = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(cfg.SPREADSHEET_ID)}`;

let tokenClient = null;
let accessToken = null;
let tasks = [];
let routines = [];
let filter = 'today';
let busy = false;

const $ = id => document.getElementById(id);

const today = () => {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
};

const tomorrow = () => {
  const d = new Date(`${today()}T12:00:00+09:00`);
  d.setDate(d.getDate() + 1);
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
};

function show(message, error = false) {
  const el = $('status');
  el.textContent = message;
  el.style.color = error ? '#a32828' : '#53647a';
}

function init() {
  $('todayLabel').textContent = new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'full',
    timeZone: 'Asia/Tokyo'
  }).format(new Date());

  $('authBtn').onclick = login;
  $('sendBtn').onclick = sendCommand;

  $('command').addEventListener('keydown', e => {
    if (e.key === 'Enter') sendCommand();
  });

  document.querySelectorAll('.tabs button').forEach(button => {
    button.onclick = () => {
      filter = button.dataset.filter;
      document.querySelectorAll('.tabs button').forEach(b => {
        b.classList.toggle('active', b === button);
      });
      render();
    };
  });

  if (!cfg.GOOGLE_CLIENT_ID ||
      cfg.GOOGLE_CLIENT_ID.startsWith('PASTE_')) {
    show('config.js にGoogle OAuthクライアントIDを設定してください。', true);
  }
}

function login() {
  if (!cfg.GOOGLE_CLIENT_ID ||
      cfg.GOOGLE_CLIENT_ID.startsWith('PASTE_')) {
    return show('OAuthクライアントIDが未設定です。', true);
  }

  if (!window.google?.accounts?.oauth2) {
    return show('Google認証ライブラリを読み込めませんでした。', true);
  }

  if (accessToken) {
    accessToken = null;
    tasks = [];
    routines = [];
    $('authBtn').textContent = 'Googleでログイン';
    render();
    return show('ログアウトしました。');
  }

  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: cfg.GOOGLE_CLIENT_ID,
    scope: SCOPE,
    callback: async response => {
      if (response.error) {
        return show('認証失敗：' + response.error, true);
      }
      accessToken = response.access_token;
      $('authBtn').textContent = 'ログアウト';
      await load();
    }
  });

  tokenClient.requestAccessToken({ prompt: 'consent' });
}

async function sheets(path, options = {}) {
  if (!accessToken) throw Error('ログインしてください');

  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 401) {
      accessToken = null;
      $('authBtn').textContent = 'Googleでログイン';
    }
    throw Error(result.error?.message || `API error ${response.status}`);
  }

  return result;
}

const range = value => encodeURIComponent(value);

async function load() {
  try {
    show('スプレッドシートから読み込み中…');

    const result = await sheets(
      `/values:batchGet?ranges=${range("'タスク一覧'!A2:J500")}` +
      `&ranges=${range("'日課マスター'!A2:H500")}`
    );

    tasks = (result.valueRanges?.[0]?.values || [])
      .map((r, i) => ({
        row: i + 2,
        id: r[0] || '',
        name: r[1] || '',
        kind: r[2] || '',
        area: r[3] || '',
        priority: r[4] || '',
        due: r[5] || '',
        status: r[6] || '未着手',
        minutes: r[7] || '',
        memo: r[8] || ''
      }))
      .filter(t => t.id && t.name);

    routines = (result.valueRanges?.[1]?.values || [])
      .map(r => ({
        id: r[0] || '',
        name: r[1] || '',
        area: r[2] || '',
        frequency: r[3] || '',
        priority: r[4] || '',
        setting: r[6] || ''
      }))
      .filter(r => r.id && r.name);

    render();
    show('Googleスプレッドシートと接続しました。');

  } catch (error) {
    show('読み込みエラー：' + error.message, true);
  }
}

function relevant(task) {
  return !task.due || task.due <= today();
}

function allItems() {
  const base = tasks.map(t => ({ ...t, routine: false }));

  const daily = routines
    .filter(r => r.frequency === '毎日')
    .map(r => ({
      ...r,
      status: '未確認',
      due: today(),
      routine: true
    }));

  return [...base, ...daily];
}

function priority(value) {
  return {
    '最優先': 4,
    '高': 3,
    '中': 2,
    '低': 1
  }[value] || 0;
}

function render() {
  const all = allItems();
  const now = all.filter(t =>
    (!t.routine && relevant(t) && t.status !== '完了') ||
    t.routine
  );
  const done = all.filter(t => t.status === '完了');

  let shown = filter === 'today'
    ? now
    : filter === 'done'
      ? done
      : all;

  shown = shown.slice().sort(
    (a, b) => priority(b.priority) - priority(a.priority)
  );

  const list = $('taskList');
  list.replaceChildren();

  if (!shown.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = accessToken
      ? '該当するタスクはありません。'
      : 'ログインすると表示されます。';
    list.append(empty);
  }

  for (const task of shown) {
    const row = document.createElement('article');
    row.className = 'task' +
      (task.status === '完了' ? ' is-done' : '');

    const left = document.createElement('div');
    left.className = 'task-left';

    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = task.status === '完了';
    check.disabled = busy || task.routine;
    check.setAttribute('aria-label', task.name + 'を完了にする');
    check.onchange = () => complete(task, check.checked);

    const info = document.createElement('div');

    const name = document.createElement('div');
    name.className = 'task-name';
    name.textContent = task.name;

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = [
      task.area || '',
      task.due || (task.routine ? '日課' : ''),
      task.status
    ].filter(Boolean).join(' · ');

    info.append(name, meta);
    left.append(check, info);

    const badge = document.createElement('span');
    badge.className = 'priority';
    badge.textContent = task.priority || '通常';

    row.append(left, badge);
    list.append(row);
  }

  const active = now.filter(t => t.status !== '完了');

  $('progressLabel').textContent =
    `今日の未完了 ${active.length}件 ・ 完了済み ${done.length}件`;

  $('progressRing').textContent = String(active.length);
}

async function complete(task, checked = true) {
  if (task.routine) {
    return show('日課の完了記録は次期バージョンで対応予定です。', true);
  }

  if (busy) return;
  busy = true;
  render();

  try {
    const cell = `'タスク一覧'!G${task.row}`;
    const status = checked ? '完了' : '未着手';

    await sheets(
      `/values/${range(cell)}?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        body: JSON.stringify({
          range: cell,
          majorDimension: 'ROWS',
          values: [[status]]
        })
      }
    );

    task.status = status;
    show(`${task.name} → ${status}`);

  } catch (error) {
    show('更新失敗：' + error.message, true);

  } finally {
    busy = false;
    render();
  }
}

async function addTask(name, due = '') {
  if (busy) return;

  busy = true;
  $('sendBtn').disabled = true;

  try {
    const id = 'T' + Date.now();

    const row = [
      id,
      name,
      '単発',
      'その他',
      '中',
      due,
      '未着手',
      '',
      'アプリから追加',
      today()
    ];

    await sheets(
      `/values/${range("'タスク一覧'!A:J")}:append` +
      '?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS',
      {
        method: 'POST',
        body: JSON.stringify({ values: [row] })
      }
    );

    await load();
    show('追加しました：' + name);

  } catch (error) {
    show('追加失敗：' + error.message, true);

  } finally {
    busy = false;
    $('sendBtn').disabled = false;
  }
}

async function sendCommand() {
  const raw = $('command').value.trim();
  if (!raw) return;

  if (!accessToken) {
    return show('まずGoogleでログインしてください。', true);
  }

  // 今日のタスク確認
  if (/^(今日(は|の)?(何|なに|やること)|今日のToDo|一覧|リスト)/.test(raw)) {
    filter = 'today';

    document.querySelectorAll('.tabs button').forEach(b => {
      b.classList.toggle('active', b.dataset.filter === 'today');
    });

    render();
    show('今日のタスクを表示しました。');
    $('command').value = '';
    return;
  }

  // 完了登録
  if (/(完了|終わった|済んだ|できた)(よ|！|!|。)?$/.test(raw)) {
    const key = raw.replace(
      /(を)?(完了|終わった|済んだ|できた)(よ|！|!|。)?$/,
      ''
    ).trim();

    const matches = tasks.filter(t =>
      t.status !== '完了' &&
      (t.name.includes(key) || key.includes(t.name))
    );

    if (matches.length === 1) {
      await complete(matches[0]);
      $('command').value = '';

    } else {
      show(
        matches.length === 0
          ? '一致する未完了タスクが見つかりません。'
          : '候補が複数あります。タスク名を詳しく入力してください。',
        true
      );
    }
    return;
  }

  // 新規タスク登録
  let name = raw;
  let due = '';

  if (/^(明日|あした)/.test(raw)) {
    due = tomorrow();
    name = raw.replace(/^(明日|あした)(までに|は|に)?/, '').trim();

  } else if (/^(今日|きょう)/.test(raw)) {
    due = today();
    name = raw.replace(/^(今日|きょう)(までに|は|に)?/, '').trim();
  }

  name = name.replace(
    /(を)?(追加して|登録して|やる予定|やらなきゃ|する予定)(ね|よ)?$/,
    ''
  ).trim();

  if (!name) {
    return show('追加するタスク名を入力してください。', true);
  }

  await addTask(name, due);
  $('command').value = '';
}

window.addEventListener('DOMContentLoaded', init);
