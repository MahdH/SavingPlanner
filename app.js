'use strict';
/* Saving Planner — data lives in localStorage on this device. */

const STORE_KEY = 'savingplanner.v1';
const uid = () => Math.random().toString(36).slice(2, 9);

/* ---------- state ---------- */
function defaultState() {
  return {
    settings: { currency: '$', notify: true, midDay: 15 },
    sources: ['Maedeh', 'Mahdi', 'Other'],
    categories: [
      { name: 'Rent', fixed: true, auto: 1600 },
      { name: 'Trip' }, { name: 'Grocery' }, { name: 'Transportation' },
      { name: 'Entertainment' }, { name: 'Eat out' }, { name: 'Clothing' },
      { name: 'Home Appliance' }, { name: 'Other' },
    ],
    goals: [{ id: uid(), name: 'Home saving', pct: 17 }], // template for new months
    months: {},
    notified: {},
  };
}
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && s.months) return Object.assign(defaultState(), s);
  } catch (e) { /* ignore */ }
  return defaultState();
}
let S = load();
const save = () => {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) { /* ignore */ }
  if (typeof schedulePush === 'function') schedulePush();
};

/* ---------- helpers ---------- */
const pad = n => String(n).padStart(2, '0');
const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const parseKey = k => { const [y, m] = k.split('-').map(Number); return new Date(y, m - 1, 1); };
const shiftKey = (k, n) => { const d = parseKey(k); d.setMonth(d.getMonth() + n); return keyOf(d); };
const monthName = k => parseKey(k).toLocaleString(undefined, { month: 'long', year: 'numeric' });
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sum = arr => arr.reduce((a, b) => a + (Number(b.amt) || 0), 0);
const round2 = n => Math.round(n * 100) / 100;
function money(n) {
  const v = round2(n);
  const s = Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
  return (v < 0 ? '-' : '') + S.settings.currency + s;
}
const cls = n => (n < 0 ? 'neg' : n > 0 ? 'pos' : '');

function ensureMonth(k) {
  if (S.months[k]) return S.months[k];
  const m = { income: {}, expenses: {}, plan: S.goals.map(g => ({ ...g })), done: {} };
  S.categories.forEach(c => { if (c.fixed && c.auto > 0) m.expenses[c.name] = [{ id: uid(), amt: c.auto, note: 'Recurring' }]; });
  S.months[k] = m;
  return m;
}

/* ---------- calculations ---------- */
function calc(k) {
  const m = S.months[k] || { income: {}, expenses: {}, plan: S.goals, done: {} };
  const income = Object.values(m.income).reduce((a, l) => a + sum(l), 0);
  const fixedNames = new Set(S.categories.filter(c => c.fixed).map(c => c.name));
  let expenses = 0, variable = 0;
  for (const [name, list] of Object.entries(m.expenses)) {
    const t = sum(list);
    expenses += t;
    if (!fixedNames.has(name)) variable += t;
  }
  const plan = (m.plan || []).map(g => ({ ...g, amount: round2(income * (Number(g.pct) || 0) / 100), done: !!m.done[g.id] }));
  const planned = plan.reduce((a, g) => a + g.amount, 0);
  const pctTotal = plan.reduce((a, g) => a + (Number(g.pct) || 0), 0);
  const saved = plan.filter(g => g.done).reduce((a, g) => a + g.amount, 0);
  return { income, expenses, variable, balance: income - expenses, plan, planned, pctTotal, saved, afterSavings: income - expenses - planned };
}

/* ---------- ui state ---------- */
let tab = 'month';
let cur = keyOf(new Date());
const open = new Set();
const $app = document.getElementById('app');

/* ---------- reminders ---------- */
function daysInMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); }
function reminderState(now = new Date()) {
  const k = keyOf(now), day = now.getDate(), last = daysInMonth(now);
  const m = S.months[k];
  const c = calc(k);
  const pending = c.plan.filter(g => !g.done);
  if (!S.goals.length && !(m && m.plan.length)) return null;
  if (day >= last - 2 && pending.length) return { id: `${k}-end`, k, kind: 'end', title: 'End-of-month savings', body: `Time to move your savings: ${pending.map(g => `${g.name} ${money(g.amount)}`).join(', ')}.` };
  if (day >= (S.settings.midDay || 15) && pending.length) return { id: `${k}-mid`, k, kind: 'mid', title: 'Mid-month savings check-in', body: `${c.plan.length - pending.length}/${c.plan.length} savings moved so far. Pending: ${pending.map(g => `${g.name} ${money(g.amount)}`).join(', ')}.` };
  return null;
}
async function maybeNotify() {
  const r = reminderState();
  if (!r || !S.settings.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
  if (S.notified[r.id]) return;
  S.notified[r.id] = true; save();
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) await reg.showNotification(r.title, { body: r.body, icon: 'icons/icon.svg', tag: r.id });
    else new Notification(r.title, { body: r.body });
  } catch (e) { /* ignore */ }
}


/* ---------- shared database (Supabase) ---------- */
const SB_KEY = 'savingplanner.sb', CLOUD_KEY = 'savingplanner.cloud', LOCAL_ONLY_KEY = 'savingplanner.localonly';
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* ignore */ } };
function sbConfig() {
  const clean = c => c && c.url && c.anonKey ? { url: c.url.trim().replace(/\/(rest|auth)\/v1.*$/, '').replace(/\/+$/, ''), anonKey: c.anonKey.trim() } : null;
  try { const l = clean(JSON.parse(lsGet(SB_KEY))); if (l) return l; } catch (e) { /* ignore */ }
  return clean(window.SP_CONFIG);
}
let sb = null, channel = null, pushTimer = null, pushing = false;
const cloud = { on: false, hid: null, name: '', code: '', email: '', status: '' };
const synced = { config: '', months: {} };
let screen = 'app', authMode = 'signin', msg = '';

function isPristine(m) {
  return !Object.values(m.income || {}).some(l => l.length) && !(m.done && Object.values(m.done).some(Boolean)) &&
    Object.values(m.expenses || {}).every(l => l.every(e => e.note === 'Recurring'));
}
const configOf = () => ({ sources: S.sources, categories: S.categories, goals: S.goals, currency: S.settings.currency, midDay: S.settings.midDay });
function applyConfig(c) {
  if (!c || typeof c !== 'object') return;
  if (c.sources) S.sources = c.sources;
  if (c.categories) S.categories = c.categories;
  if (c.goals) S.goals = c.goals;
  if (c.currency) S.settings.currency = c.currency;
  if (c.midDay) S.settings.midDay = c.midDay;
}
function setStatus(t) { cloud.status = t; const el = document.getElementById('syncstatus'); if (el) el.textContent = t; }
function softRender() {
  const a = document.activeElement;
  if (a && a.closest && a.closest('#app') && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) { setTimeout(softRender, 1500); return; }
  render();
}
function saveLocal() { try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) { /* ignore */ } }

function schedulePush() {
  if (!cloud.on) return;
  setStatus('Saving…');
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushNow, 600);
}
async function pushNow() {
  if (!cloud.on || pushing) { if (pushing) schedulePush(); return; }
  pushing = true;
  try {
    const cfg = JSON.stringify(configOf());
    if (cfg !== synced.config) {
      const { error } = await sb.from('households').update({ config: configOf() }).eq('id', cloud.hid);
      if (error) throw error;
      synced.config = cfg;
    }
    const rows = [];
    for (const [k, m] of Object.entries(S.months)) {
      const j = JSON.stringify(m);
      if (j === synced.months[k]) continue;
      if (synced.months[k] === undefined && isPristine(m)) continue;
      rows.push({ household_id: cloud.hid, month: k, data: m, updated_at: new Date().toISOString() });
    }
    if (rows.length) {
      const { error } = await sb.from('months').upsert(rows, { onConflict: 'household_id,month' });
      if (error) throw error;
      rows.forEach(r => { synced.months[r.month] = JSON.stringify(r.data); });
    }
    setStatus('Synced ✓');
  } catch (e) {
    setStatus('Offline — will retry');
    clearTimeout(pushTimer); pushTimer = setTimeout(pushNow, 10000);
  } finally { pushing = false; }
}
async function pull() {
  const [h, m] = await Promise.all([
    sb.from('households').select('name,invite_code,config').eq('id', cloud.hid).single(),
    sb.from('months').select('month,data').eq('household_id', cloud.hid),
  ]);
  if (h.error) throw h.error; if (m.error) throw m.error;
  cloud.name = h.data.name; cloud.code = h.data.invite_code;
  if (h.data.config && Object.keys(h.data.config).length) applyConfig(h.data.config);
  synced.config = JSON.stringify(h.data.config && Object.keys(h.data.config).length ? configOf() : {});
  // keep local months that have not been uploaded yet; otherwise the cloud copy wins
  const next = {};
  m.data.forEach(r => { next[r.month] = r.data; synced.months[r.month] = JSON.stringify(r.data); });
  for (const [k, v] of Object.entries(S.months)) if (!(k in next) && synced.months[k] === undefined) next[k] = v;
  S.months = next;
  saveLocal();
  lsSet(CLOUD_KEY, JSON.stringify({ hid: cloud.hid, name: cloud.name, code: cloud.code, email: cloud.email }));
}
function subscribe() {
  if (channel) sb.removeChannel(channel);
  channel = sb.channel('hh-' + cloud.hid)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'months', filter: `household_id=eq.${cloud.hid}` }, p => {
      if (p.eventType === 'DELETE') { delete S.months[p.old.month]; delete synced.months[p.old.month]; }
      else {
        const j = JSON.stringify(p.new.data);
        if (j === synced.months[p.new.month]) return;
        S.months[p.new.month] = p.new.data; synced.months[p.new.month] = j;
      }
      saveLocal(); softRender();
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'households', filter: `id=eq.${cloud.hid}` }, p => {
      const j = JSON.stringify(p.new.config || {});
      if (j === synced.config) return;
      applyConfig(p.new.config); synced.config = JSON.stringify(configOf()); saveLocal(); softRender();
    })
    .subscribe();
}
async function enterApp(offline) {
  cloud.on = true;
  if (!offline) {
    try { setStatus('Syncing…'); await pull(); await pushNow(); subscribe(); setStatus('Synced ✓'); }
    catch (e) { setStatus('Offline — showing saved data'); }
  } else setStatus('Offline — showing saved data');
  screen = 'app'; render();
}
async function routeAfterAuth(session) {
  cloud.email = session.user.email;
  const { data, error } = await sb.from('members').select('household_id').eq('user_id', session.user.id).maybeSingle();
  if (error) { msg = error.message; screen = 'auth'; return render(); }
  if (!data) { screen = 'household'; return render(); }
  cloud.hid = data.household_id;
  await enterApp(false);
}
async function initCloud() {
  const cfg = sbConfig();
  if (!cfg) { screen = lsGet(LOCAL_ONLY_KEY) ? 'app' : 'setup'; return render(); }
  if (!window.supabase) { msg = 'Could not load the database library.'; screen = 'setup'; return render(); }
  sb = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
  sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT' && cloud.on) { stopCloud(); screen = 'auth'; render(); } });
  let session = null;
  try { session = (await sb.auth.getSession()).data.session; } catch (e) { /* offline */ }
  const cached = (() => { try { return JSON.parse(lsGet(CLOUD_KEY)); } catch (e) { return null; } })();
  if (!session && cached && !navigator.onLine) { Object.assign(cloud, cached); return enterApp(true); }
  if (!session) { screen = 'auth'; return render(); }
  if (cached && !navigator.onLine) { Object.assign(cloud, cached); return enterApp(true); }
  await routeAfterAuth(session);
}
function stopCloud() {
  cloud.on = false; clearTimeout(pushTimer);
  if (channel && sb) sb.removeChannel(channel); channel = null;
  synced.config = ''; synced.months = {};
}
async function signOut() {
  if (cloud.on) await pushNow();
  try { await sb.auth.signOut(); } catch (e) { /* ignore */ }
  stopCloud(); lsSet(CLOUD_KEY, null);
  S = defaultState(); saveLocal(); // do not leave household data on a device after sign-out
  cloud.hid = null; authMode = 'signin'; msg = ''; screen = 'auth'; render();
}

function cardScreen(title, body) {
  return `<div class="monthbar"><h1>Saving Planner</h1></div><h2>${title}</h2><div class="list" style="padding:14px">${body}</div>${msg ? `<div class="warn">${esc(msg)}</div>` : ''}`;
}
function viewSetup() {
  return cardScreen('Connect your shared database', `<p class="note">Create a free Supabase project, run <code>supabase/schema.sql</code>, then paste the Project URL and anon key (Project Settings → API).</p>
    <form data-act="setup"><div class="field"><input type="text" placeholder="https://xxxx.supabase.co" required></div>
    <div class="field"><input type="text" placeholder="anon public key" required></div>
    <div class="btnrow"><button class="btn">Connect</button><button type="button" class="btn sec" data-act="localonly">Use on this device only</button></div></form>`);
}
function viewAuth() {
  const up = authMode === 'signup';
  return cardScreen(up ? 'Create your account' : 'Sign in', `<form data-act="auth">
    <div class="field"><input type="email" placeholder="Email" autocomplete="email" required></div>
    <div class="field"><input type="password" placeholder="Password (min 6 characters)" minlength="6" autocomplete="${up ? 'new-password' : 'current-password'}" required></div>
    <div class="btnrow"><button class="btn">${up ? 'Sign up' : 'Sign in'}</button>
    <button type="button" class="btn sec" data-act="authmode">${up ? 'I have an account' : 'Create account'}</button></div></form>`);
}
function viewHousehold() {
  return cardScreen('Set up your household', `<p class="note">Signed in as ${esc(cloud.email)}. One of you creates the household; the other joins with its invite code.</p>
    <form data-act="hh-create"><div class="field"><input type="text" placeholder="Household name (e.g. Mahdi & Maedeh)"><button class="btn">Create</button></div></form>
    <p class="note">Existing data on this device will be uploaded to the new household.</p>
    <form data-act="hh-join"><div class="field"><input type="text" placeholder="Invite code" required><button class="btn">Join</button></div></form>
    <div class="btnrow"><button class="btn sec" data-act="signout">Sign out</button></div>`);
}
function accountSection() {
  if (!sbConfig()) return `<h2>Shared database</h2><div class="btnrow"><button class="btn" data-act="gosetup">Set up shared database</button></div>`;
  if (!cloud.on) return '';
  return `<h2>Shared household</h2><div class="card"><div class="l">Signed in as ${esc(cloud.email)} · ${esc(cloud.name)}</div>
    <div class="l">Invite code for your partner: <b style="font-size:1.1rem">${esc(cloud.code)}</b></div>
    <div class="l" id="syncstatus">${esc(cloud.status)}</div></div>
    <div class="btnrow"><button class="btn sec" data-act="signout">Sign out</button></div>`;
}

/* ---------- views ---------- */
function entryRows(kind, name, list) {
  const key = `${kind}:${name}`;
  const rows = list.map(e => `<div class="entry"><span>${esc(e.note || 'Entry')}</span><span>${money(e.amt)}
    <button data-act="del" data-kind="${kind}" data-name="${esc(name)}" data-id="${e.id}" aria-label="Delete entry">✕</button></span></div>`).join('');
  return `<div class="entries">${rows}
    <form class="addform" data-act="add" data-kind="${kind}" data-name="${esc(name)}">
      <input type="number" step="0.01" inputmode="decimal" placeholder="Amount" required>
      <input type="text" placeholder="Note (optional)">
      <button class="btn">Add</button></form></div>`;
}
function section(kind, names, m, label) {
  const data = kind === 'i' ? m.income : m.expenses;
  const all = [...new Set([...names.map(n => n.name || n), ...Object.keys(data)])];
  const fixed = new Set(S.categories.filter(c => c.fixed).map(c => c.name));
  const total = all.reduce((a, n) => a + sum(data[n] || []), 0);
  return `<h2>${label} · ${money(total)}</h2><div class="list ${kind === 'i' ? 'inc' : 'exp'}">` + all.map(n => {
    const list = data[n] || [], isOpen = open.has(`${kind}:${n}`);
    return `<button class="row head" data-act="toggle" data-key="${kind}:${esc(n)}"><span>${esc(n)}${kind === 'e' && fixed.has(n) ? '<span class="tag">fixed</span>' : ''}</span>
      <span class="amt">${money(sum(list))} ${isOpen ? '▾' : '▸'}</span></button>${isOpen ? entryRows(kind, n, list) : ''}`;
  }).join('') + '</div>';
}
function viewMonth() {
  const m = ensureMonth(cur), c = calc(cur);
  const r = reminderState();
  const isNow = cur === keyOf(new Date());
  const banner = isNow && r ? `<div class="banner">${esc(r.title)}<small>${esc(r.body)}</small></div>` : '';
  return `<div class="monthbar"><button data-act="prev" aria-label="Previous month">‹</button><h1>${monthName(cur)}</h1><button data-act="next" aria-label="Next month">›</button></div>
  ${banner}
  <div class="cards">
    <div class="card inc"><div class="l">Income</div><div class="v">${money(c.income)}</div></div>
    <div class="card exp"><div class="l">Expenses</div><div class="v">${money(c.expenses)}</div></div>
    <div class="card"><div class="l">Spendings (without fixed)</div><div class="v">${money(c.variable)}</div></div>
    <div class="card"><div class="l">Planned savings</div><div class="v">${money(c.planned)}</div></div>
    <div class="card bal"><div class="l">Balance (income − expenses)</div><div class="v ${cls(c.balance)}">${money(c.balance)}</div>
      <div class="l">After planned savings: <b class="${cls(c.afterSavings)}">${money(c.afterSavings)}</b></div></div>
  </div>
  ${section('i', S.sources, m, 'Income')}
  ${section('e', S.categories, m, 'Expenses')}`;
}
function viewSavings() {
  const m = ensureMonth(cur), c = calc(cur);
  const goals = c.plan.map(g => `<div class="goal">
    <div class="top"><input type="text" value="${esc(g.name)}" data-act="goal-name" data-id="${g.id}" aria-label="Goal name">
      <input type="number" min="0" max="100" step="0.5" value="${g.pct}" data-act="goal-pct" data-id="${g.id}" aria-label="Percent"> %
      <button class="btn sec" data-act="goal-del" data-id="${g.id}" aria-label="Remove goal">✕</button></div>
    <div class="bar"><i style="width:${Math.min(100, g.pct)}%"></i></div>
    <div class="sub"><b>${money(g.amount)}</b>
      <label><input type="checkbox" data-act="goal-done" data-id="${g.id}" ${g.done ? 'checked' : ''}> Moved to savings</label></div></div>`).join('');
  return `<div class="monthbar"><button data-act="prev">‹</button><h1>${monthName(cur)}</h1><button data-act="next">›</button></div>
  <div class="cards">
    <div class="card inc"><div class="l">Income this month</div><div class="v">${money(c.income)}</div></div>
    <div class="card"><div class="l">Allocated</div><div class="v">${c.pctTotal}% · ${money(c.planned)}</div></div>
    <div class="card"><div class="l">Actually moved</div><div class="v">${money(c.saved)}</div></div>
    <div class="card"><div class="l">Left after expenses & savings</div><div class="v ${cls(c.afterSavings)}">${money(c.afterSavings)}</div></div>
  </div>
  <h2>Savings plan (% of income)</h2>
  ${c.pctTotal > 100 ? '<div class="warn">Your goals add up to more than 100% of income.</div>' : ''}
  ${c.afterSavings < 0 && c.income > 0 ? '<div class="warn">Expenses plus savings exceed this month\'s income.</div>' : ''}
  <div class="list">${goals || '<div class="goal note">No goals yet — add one below.</div>'}</div>
  <form class="field" data-act="goal-add"><input type="text" placeholder="Goal (e.g. Vacation)" required>
    <input type="number" min="0" max="100" step="0.5" placeholder="%" style="width:80px" required><button class="btn">Add goal</button></form>
  <p class="note">Changes apply to ${monthName(cur)} and to new months. Past months keep their own plan.</p>`;
}
function viewHistory() {
  const keys = Object.keys(S.months).filter(k => !isPristine(S.months[k])).sort().reverse();
  let totalSaved = 0, totalBal = 0;
  const rows = keys.map(k => { const c = calc(k); totalSaved += c.saved; totalBal += c.balance;
    return `<tr class="clickable" data-act="goto" data-key="${k}"><td>${monthName(k)}</td><td>${money(c.income)}</td><td>${money(c.expenses)}</td>
      <td class="${cls(c.balance)}">${money(c.balance)}</td><td>${money(c.saved)}</td></tr>`; }).join('');
  return `<div class="monthbar"><h1>History</h1></div>
  <div class="cards"><div class="card"><div class="l">Total saved (moved)</div><div class="v">${money(totalSaved)}</div></div>
    <div class="card"><div class="l">Cumulative balance</div><div class="v ${cls(totalBal)}">${money(totalBal)}</div></div></div>
  <h2>Month by month</h2>
  <table><tr><th>Month</th><th>Income</th><th>Spent</th><th>Balance</th><th>Saved</th></tr>${rows || '<tr><td colspan="5">No data yet</td></tr>'}</table>
  <p class="note">Tap a month to open it. Import your past sheet data under Settings → Import.</p>`;
}
function viewSettings() {
  const cats = S.categories.map((c, i) => `<div class="field"><input type="text" value="${esc(c.name)}" data-act="cat-name" data-i="${i}">
    <label><input type="checkbox" data-act="cat-fixed" data-i="${i}" ${c.fixed ? 'checked' : ''}> fixed</label>
    ${c.fixed ? `<input type="number" style="width:90px" placeholder="auto/mo" value="${c.auto || ''}" data-act="cat-auto" data-i="${i}">` : ''}
    <button class="btn sec" data-act="cat-del" data-i="${i}">✕</button></div>`).join('');
  const srcs = S.sources.map((s, i) => `<div class="field"><input type="text" value="${esc(s)}" data-act="src-name" data-i="${i}">
    <button class="btn sec" data-act="src-del" data-i="${i}">✕</button></div>`).join('');
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  return `<div class="monthbar"><h1>Settings</h1></div>
  ${accountSection()}
  <h2>Reminders</h2>
  <div class="field"><label><input type="checkbox" data-act="notify" ${S.settings.notify ? 'checked' : ''}> Remind me mid-month and at month end</label></div>
  <div class="field">Mid-month reminder on day <input type="number" min="1" max="28" style="width:70px" value="${S.settings.midDay}" data-act="midday"></div>
  <div class="btnrow"><button class="btn" data-act="perm">Enable notifications (${perm})</button>
    <button class="btn sec" data-act="ics">Add to my calendar (.ics)</button></div>
  <p class="note">Notifications show when you open the app on/after the reminder date. For alerts that arrive even when the app is closed, import the calendar file — it repeats monthly on the mid-month day and the last day of each month.</p>
  <h2>Currency</h2><div class="field"><input type="text" style="max-width:80px" value="${esc(S.settings.currency)}" data-act="currency"></div>
  <h2>Income sources (people)</h2>${srcs}
  <form class="field" data-act="src-add"><input type="text" placeholder="New source" required><button class="btn">Add</button></form>
  <h2>Expense categories</h2>${cats}
  <form class="field" data-act="cat-add"><input type="text" placeholder="New category" required><button class="btn">Add</button></form>
  <p class="note">"Fixed" categories (e.g. Rent) are left out of "Spendings (without fixed)". Set an auto amount to pre-fill it every new month.</p>
  <h2>Backup & import</h2>
  <div class="btnrow"><button class="btn sec" data-act="export">Download backup (JSON)</button>
    <label class="btn sec">Restore backup<input type="file" accept=".json" data-act="restore" hidden></label></div>
  <p class="note">Import past months from your sheet — paste CSV lines in the form <code>month,type,category,amount</code>, e.g. <code>2024-11,expense,Grocery,420.50</code> or <code>2024-11,income,Mahdi,3000</code>.</p>
  <textarea id="csv" placeholder="2024-11,income,Mahdi,3000&#10;2024-11,expense,Rent,1600"></textarea>
  <div class="btnrow"><button class="btn" data-act="csv">Import CSV</button>${cloud.on ? '' : '<button class="btn danger" data-act="wipe">Erase all data</button>'}</div>`;
}
const views = { month: viewMonth, savings: viewSavings, history: viewHistory, settings: viewSettings };
const screens = { setup: viewSetup, auth: viewAuth, household: viewHousehold, loading: () => '' };
function render() {
  $app.innerHTML = screen === 'app' ? views[tab]() : screens[screen]();
  document.getElementById('tabs').hidden = screen !== 'app';
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
}

/* ---------- actions ---------- */
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
}
function makeICS() {
  const now = new Date(), stamp = now.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const mk = (title, rule, start) => `BEGIN:VEVENT\r\nUID:${uid()}@savingplanner\r\nDTSTAMP:${stamp}\r\nDTSTART;VALUE=DATE:${start}\r\nRRULE:${rule}\r\nSUMMARY:${title}\r\nDESCRIPTION:Open Saving Planner and move your planned savings.\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:${title}\r\nTRIGGER:PT9H\r\nEND:VALARM\r\nEND:VEVENT\r\n`;
  const d0 = `${now.getFullYear()}${pad(now.getMonth() + 1)}`;
  const midDay = S.settings.midDay || 15;
  return 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//SavingPlanner//EN\r\n' +
    mk('Mid-month savings check-in', `FREQ=MONTHLY;BYMONTHDAY=${midDay}`, `${d0}${pad(midDay)}`) +
    mk('End-of-month: make your savings happen', 'FREQ=MONTHLY;BYMONTHDAY=-1', `${d0}${pad(daysInMonth(now))}`) +
    'END:VCALENDAR\r\n';
}
function importCSV(text) {
  let n = 0;
  text.split(/\r?\n/).forEach(line => {
    const p = line.split(',').map(s => s.trim());
    if (p.length < 4 || !/^\d{4}-\d{2}$/.test(p[0])) return;
    const amt = parseFloat(p[3]); if (isNaN(amt)) return;
    const kind = /^inc/i.test(p[1]) ? 'income' : 'expenses';
    if (!S.months[p[0]]) S.months[p[0]] = { income: {}, expenses: {}, plan: [], done: {} }; // history: no auto rent, no plan
    (S.months[p[0]][kind][p[2]] = S.months[p[0]][kind][p[2]] || []).push({ id: uid(), amt, note: 'Imported' });
    n++;
  });
  return n;
}
function findGoal(id) { return ensureMonth(cur).plan.find(g => g.id === id); }
function syncTemplate(g) { const t = S.goals.find(x => x.id === g.id); if (t) { t.name = g.name; t.pct = g.pct; } }

document.addEventListener('click', e => {
  const t = e.target.closest('[data-act],[data-tab]'); if (!t) return;
  if (t.dataset.tab) { tab = t.dataset.tab; render(); return; }
  const a = t.dataset.act, m = S.months[cur];
  switch (a) {
    case 'prev': cur = shiftKey(cur, -1); break;
    case 'next': cur = shiftKey(cur, 1); break;
    case 'goto': cur = t.dataset.key; tab = 'month'; break;
    case 'toggle': open.has(t.dataset.key) ? open.delete(t.dataset.key) : open.add(t.dataset.key); break;
    case 'del': { const d = m[t.dataset.kind === 'i' ? 'income' : 'expenses']; d[t.dataset.name] = d[t.dataset.name].filter(x => x.id !== t.dataset.id); save(); break; }
    case 'goal-del': { m.plan = m.plan.filter(g => g.id !== t.dataset.id); S.goals = S.goals.filter(g => g.id !== t.dataset.id); save(); break; }
    case 'cat-del': S.categories.splice(+t.dataset.i, 1); save(); break;
    case 'src-del': S.sources.splice(+t.dataset.i, 1); save(); break;
    case 'signout': signOut(); return;
    case 'authmode': authMode = authMode === 'signup' ? 'signin' : 'signup'; msg = ''; break;
    case 'localonly': lsSet(LOCAL_ONLY_KEY, '1'); screen = 'app'; msg = ''; break;
    case 'gosetup': lsSet(LOCAL_ONLY_KEY, null); screen = 'setup'; msg = ''; break;
    case 'perm':
      if ('Notification' in window) Notification.requestPermission().then(() => { render(); maybeNotify(); });
      else alert('Notifications are not supported in this browser. Use the calendar file instead.');
      return;
    case 'ics': download('saving-planner-reminders.ics', makeICS(), 'text/calendar'); return;
    case 'export': download(`saving-planner-${keyOf(new Date())}.json`, JSON.stringify(S, null, 2), 'application/json'); return;
    case 'csv': { const n = importCSV(document.getElementById('csv').value); save(); alert(`Imported ${n} row(s).`); break; }
    case 'wipe': if (confirm('Erase ALL data on this device? This cannot be undone.')) { S = defaultState(); save(); } break;
    default: return;
  }
  render();
});
async function doAuth(email, password) {
  msg = 'Working…'; render();
  try {
    if (authMode === 'signup') {
      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) throw error;
      if (!data.session) { authMode = 'signin'; msg = 'Account created. Check your email to confirm it, then sign in.'; return render(); }
      authMode = 'signin'; msg = ''; return routeAfterAuth(data.session);
    }
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    msg = ''; await routeAfterAuth(data.session);
  } catch (e) { msg = e.message || 'Something went wrong.'; render(); }
}
async function doCreateHousehold(name) {
  try {
    const { data, error } = await sb.rpc('create_household', { p_name: name, p_config: configOf() });
    if (error) throw error;
    cloud.hid = data; msg = ''; await enterApp(false);
  } catch (e) { msg = e.message; render(); }
}
async function doJoinHousehold(code) {
  try {
    const { data, error } = await sb.rpc('join_household', { p_code: code });
    if (error) throw error;
    S.months = {}; // the household's data replaces whatever is on this device
    cloud.hid = data; msg = ''; await enterApp(false);
  } catch (e) { msg = e.message; render(); }
}
document.addEventListener('submit', e => {
  const f = e.target.closest('form[data-act]'); if (!f) return;
  e.preventDefault();
  const [i1, i2] = f.querySelectorAll('input'), v1 = i1.value, v2 = i2 ? i2.value : '';
  switch (f.dataset.act) {
    case 'setup': lsSet(SB_KEY, JSON.stringify({ url: v1.trim().replace(/\/+$/, ''), anonKey: v2.trim() })); msg = ''; initCloud(); return;
    case 'auth': doAuth(v1.trim(), v2); return;
    case 'hh-create': doCreateHousehold(v1.trim()); return;
    case 'hh-join': doJoinHousehold(v1); return;
    case 'add': {
      const d = ensureMonth(cur)[f.dataset.kind === 'i' ? 'income' : 'expenses'];
      (d[f.dataset.name] = d[f.dataset.name] || []).push({ id: uid(), amt: parseFloat(v1), note: v2.trim() }); break;
    }
    case 'goal-add': { const g = { id: uid(), name: v1.trim(), pct: parseFloat(v2) || 0 }; S.goals.push(g); ensureMonth(cur).plan.push({ ...g }); break; }
    case 'cat-add': S.categories.push({ name: v1.trim() }); break;
    case 'src-add': S.sources.push(v1.trim()); break;
  }
  save(); render();
});
document.addEventListener('change', e => {
  const t = e.target, a = t.dataset.act; if (!a) return;
  const i = +t.dataset.i;
  switch (a) {
    case 'goal-name': { const g = findGoal(t.dataset.id); g.name = t.value; syncTemplate(g); break; }
    case 'goal-pct': { const g = findGoal(t.dataset.id); g.pct = Math.max(0, parseFloat(t.value) || 0); syncTemplate(g); break; }
    case 'goal-done': ensureMonth(cur).done[t.dataset.id] = t.checked; break;
    case 'cat-name': S.categories[i].name = t.value.trim() || S.categories[i].name; break;
    case 'cat-fixed': S.categories[i].fixed = t.checked; break;
    case 'cat-auto': S.categories[i].auto = parseFloat(t.value) || 0; break;
    case 'src-name': S.sources[i] = t.value.trim() || S.sources[i]; break;
    case 'currency': S.settings.currency = t.value || '$'; break;
    case 'notify': S.settings.notify = t.checked; break;
    case 'midday': S.settings.midDay = Math.min(28, Math.max(1, parseInt(t.value) || 15)); break;
    case 'restore': {
      const file = t.files[0]; if (!file) return;
      file.text().then(txt => { try { const d = JSON.parse(txt); if (!d.months) throw 0; S = Object.assign(defaultState(), d); save(); render(); alert('Backup restored.'); } catch (_) { alert('That file is not a valid backup.'); } });
      return;
    }
    default: return;
  }
  save(); render();
});

/* ---------- boot ---------- */
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
document.addEventListener('visibilitychange', async () => {
  if (document.hidden) return;
  if (cloud.on) { try { await pushNow(); await pull(); setStatus('Synced ✓'); } catch (e) { setStatus('Offline — showing saved data'); } }
  softRender(); maybeNotify();
});
window.addEventListener('online', () => { if (cloud.on) { pushNow(); pull().then(() => { subscribe(); softRender(); }).catch(() => {}); } });
screen = 'loading';
render();
initCloud().then(maybeNotify);
