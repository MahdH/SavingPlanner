'use strict';
/* Saving Planner — data lives in localStorage on this device. */

const STORE_KEY = 'savingplanner.v1';
const uid = () => Math.random().toString(36).slice(2, 9);

/* ---------- state ---------- */
function defaultState() {
  return {
    settings: { currency: '$', notify: true, midDay: 15, theme: 'light' }, // theme: light | dark | auto (this device only)
    sources: ['Maedeh', 'Mahdi', 'Other'],
    categories: [
      { name: 'Rent', fixed: true, auto: 1600 },
      { name: 'Trip' }, { name: 'Grocery' }, { name: 'Transportation' },
      { name: 'Entertainment' }, { name: 'Eat out' }, { name: 'Clothing' },
      { name: 'Home Appliance' }, { name: 'Other' },
    ],
    accounts: ['Savings account', 'TFSA', 'RRSP', 'Bitcoin'], // where savings can go; edited in Settings
    goals: [{ id: uid(), name: 'Home saving', pct: 17, account: '', hue: Math.floor(Math.random() * 5) }], // template for new months
    months: {},
    notified: {},
  };
}
/* ---------- card colours: random, but stored so they stay put (0 peach, 1 mint, 2 rose, 3 sky, 4 violet) ---------- */
function randomPerm(n = 5) { const a = [...Array(n).keys()]; for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
// give goals that have no colour a random one, different from the others (all of them when force is true)
function assignGoalHues(goals, force) {
  const used = new Set(force ? [] : goals.filter(g => Number.isInteger(g.hue)).map(g => g.hue));
  const free = randomPerm().filter(h => !used.has(h)); let changed = false;
  goals.forEach(g => { if (force || !Number.isInteger(g.hue)) { g.hue = free.length ? free.shift() : Math.floor(Math.random() * 5); changed = true; } });
  return changed;
}
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && s.months) {
      const st = Object.assign(defaultState(), s);
      let changed = assignGoalHues(st.goals || []);
      if (!Array.isArray(st.settings.hueOrder) || st.settings.hueOrder.length !== 5) { st.settings.hueOrder = randomPerm(); changed = true; }
      if (changed) { try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch (e) { /* ignore */ } }   // keep the colours it picked
      return st;
    }
  } catch (e) { /* ignore */ }
  return defaultState();
}
let S = load();
const save = () => {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) { /* ignore */ }
  if (typeof schedulePush === 'function') schedulePush();
};

/* ---------- theme ---------- */
function applyTheme() {
  const t = ['light', 'dark', 'auto'].includes(S.settings && S.settings.theme) ? S.settings.theme : 'light';
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  const root = document.documentElement;
  root.dataset.theme = t; root.style.colorScheme = t === 'auto' ? 'light dark' : t;
  const m = document.getElementById('themecolor'); if (m) m.content = dark ? '#111113' : '#f6f5f4';
}
try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme); } catch (e) { /* old browsers */ }

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
  const m = S.months[k] || { income: {}, expenses: {}, plan: S.goals, done: {}, deposits: {} };
  const income = Object.values(m.income).reduce((a, l) => a + sum(l), 0);
  const fixedNames = new Set(S.categories.filter(c => c.fixed).map(c => c.name));
  let expenses = 0, variable = 0;
  for (const [name, list] of Object.entries(m.expenses)) {
    const t = sum(list);
    expenses += t;
    if (!fixedNames.has(name)) variable += t;
  }
  // a goal's target for the month is a % of that month's income
  const plan = (m.plan || []).map(g => {
    const amount = round2(income * (Number(g.pct) || 0) / 100);
    const deps = (m.deposits && m.deposits[g.id]) || [];
    const legacy = !deps.length && m.done && m.done[g.id];            // months saved before deposits existed
    const moved = deps.length ? round2(sum(deps)) : (legacy ? amount : 0);
    return { ...g, amount, deps, moved, remaining: Math.max(0, round2(amount - moved)), done: amount > 0 && moved >= amount - 0.005 };
  });
  const planned = plan.reduce((a, g) => a + g.amount, 0);
  const pctTotal = income > 0 ? Math.round(planned / income * 1000) / 10 : 0;
  const saved = plan.reduce((a, g) => a + g.moved, 0);
  return { income, expenses, variable, balance: income - expenses, plan, planned, pctTotal, saved, toMove: Math.max(0, round2(planned - saved)), afterSavings: income - expenses - planned };
}

/* ---------- ui state ---------- */
let tab = 'month';
let cur = keyOf(new Date());
const open = new Set();
let focusAfterRender = null;  // selector to focus once the next render is done
const editing = new Set();   // goal cards in edit mode
const addingDep = new Set(); // goal cards with the deposit form open
const $app = document.getElementById('app');

/* ---------- reminders ---------- */
function daysInMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); }
function reminderState(now = new Date()) {
  const k = keyOf(now), day = now.getDate(), last = daysInMonth(now);
  const m = S.months[k];
  const c = calc(k);
  const pending = c.plan.filter(g => !g.done);
  if (!S.goals.length && !(m && m.plan.length)) return null;
  if (day >= last - 2 && pending.length) return { id: `${k}-end`, k, kind: 'end', title: 'End-of-month savings', body: `Time to move your savings: ${pending.map(g => `${g.name} ${money(g.remaining)} left`).join(', ')}.` };
  if (day >= (S.settings.midDay || 15) && pending.length) return { id: `${k}-mid`, k, kind: 'mid', title: 'Mid-month savings check-in', body: `${c.plan.length - pending.length}/${c.plan.length} savings moved so far. Still to move: ${pending.map(g => `${g.name} ${money(g.remaining)}`).join(', ')}.` };
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
let cfgHueAssigned = false;   // true when goals from the household had no colour and we picked one
let screen = 'app', authMode = 'signin', msg = '';

function isPristine(m) {
  return !Object.values(m.income || {}).some(l => l.length) && !(m.done && Object.values(m.done).some(Boolean)) && !(m.deposits && Object.values(m.deposits).some(l => l.length)) &&
    Object.values(m.expenses || {}).every(l => l.every(e => e.note === 'Recurring'));
}
const configOf = () => ({ sources: S.sources, categories: S.categories, goals: S.goals, accounts: S.accounts, currency: S.settings.currency, midDay: S.settings.midDay });
function applyConfig(c) {
  if (!c || typeof c !== 'object') return;
  if (c.sources) S.sources = c.sources;
  if (c.categories) S.categories = c.categories;
  if (c.goals) { S.goals = c.goals; if (assignGoalHues(S.goals)) cfgHueAssigned = true; }
  if (c.accounts) S.accounts = c.accounts;
  if (c.currency) S.settings.currency = c.currency;
  if (c.midDay) S.settings.midDay = c.midDay;
}
function setStatus(t) { cloud.status = t; const el = document.getElementById('syncstatus'); if (el) el.textContent = t; }
function softRender() {
  const a = document.activeElement;
  if (a && a.closest && a.closest('#app') && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) { setTimeout(softRender, 1500); return; }
  render();
}
const renderSoon = () => setTimeout(softRender, 220); // lets a click on Done/Edit land before the card re-renders
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
  if (cfgHueAssigned) { synced.config = ''; cfgHueAssigned = false; }   // push the new colours so the other phone shows the same ones
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
      if (cfgHueAssigned) { cfgHueAssigned = false; synced.config = ''; schedulePush(); }
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
  const th = S.settings.theme; S = defaultState(); S.settings.theme = th; saveLocal(); // do not leave household data on a device after sign-out; the theme stays
  cloud.hid = null; authMode = 'signin'; msg = ''; screen = 'auth'; render();
}

/* ---------- design helpers (Lucide icons, one stroke weight, one size family) ---------- */
const IC = {
  calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
  'chevron-left': '<path d="m15 18-6-6 6-6"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  bell: '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>',
  'log-out': '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  shuffle: '<path d="m18 14 4 4-4 4"/><path d="m18 2 4 4-4 4"/><path d="M2 18h1.973a4 4 0 0 0 3.3-1.7l5.454-8.6a4 4 0 0 1 3.3-1.7H22"/><path d="M2 6h1.972a4 4 0 0 1 3.6 2.2"/><path d="M22 18h-6.041a4 4 0 0 1-3.3-1.8l-.359-.45"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
};
const ic = (n, s = 16) => `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n]}</svg>`;
const HUES = ['#3b82f6', '#16a34a', '#d97706', '#db2777', '#7c3aed', '#ea580c', '#0891b2'];
function avatar(name, i) {
  return `<span class="avatar" style="--c:${HUES[i % HUES.length]}">${esc(String(name).trim().charAt(0).toUpperCase() || '?')}</span>`;
}
const tone = n => (n < 0 ? 'neg' : '');
const iconBtn = (act, icon, label, attrs = '') => `<button class="icon-btn" data-act="${act}" ${attrs} aria-label="${label}">${ic(icon)}</button>`;
const monthNav = title => `<header class="monthnav">${iconBtn('prev', 'chevron-left', 'Previous month')}<h1>${title}</h1>${iconBtn('next', 'chevron-right', 'Next month')}</header>`;
const stat = (label, value, extra = '') => `<div class="stat"><div class="label">${label}</div><div class="num ${extra}">${value}</div></div>`;

/* ---------- screens before sign-in ---------- */
function cardScreen(title, body) {
  return `<div class="auth"><div class="wordmark">Saving Planner</div><h1 class="auth-title">${title}</h1>
    <div class="group pad">${body}</div>${msg ? `<p class="warn" role="alert">${esc(msg)}</p>` : ''}</div>`;
}
function viewSetup() {
  return cardScreen('Connect your shared database', `<p class="note">Create a free Supabase project, run <code>supabase/schema.sql</code>, then paste the Project URL and anon key from Project Settings → API.</p>
    <form data-act="setup" class="stack"><input type="text" placeholder="https://xxxx.supabase.co" required>
    <input type="text" placeholder="Anon public key" required>
    <div class="btnrow"><button class="btn primary">Connect</button><button type="button" class="btn" data-act="localonly">Use on this device only</button></div></form>`);
}
function viewAuth() {
  const up = authMode === 'signup';
  return cardScreen(up ? 'Create your account' : 'Welcome back', `<form data-act="auth" class="stack">
    <input type="email" placeholder="Email" autocomplete="email" required>
    <input type="password" placeholder="Password, at least 6 characters" minlength="6" autocomplete="${up ? 'new-password' : 'current-password'}" required>
    <div class="btnrow"><button class="btn primary">${up ? 'Sign up' : 'Sign in'}</button>
    <button type="button" class="btn ghost" data-act="authmode">${up ? 'I have an account' : 'Create account'}</button></div></form>`);
}
function viewHousehold() {
  return cardScreen('Set up your household', `<p class="note">Signed in as ${esc(cloud.email)}. One of you creates the household, the other joins with its invite code.</p>
    <form data-act="hh-create" class="inline"><input type="text" placeholder="Household name"><button class="btn primary">Create</button></form>
    <p class="note">Data already on this device is uploaded to the new household.</p>
    <form data-act="hh-join" class="inline"><input type="text" placeholder="Invite code" required><button class="btn">Join</button></form>
    <div class="btnrow"><button class="btn ghost" data-act="signout">${ic('log-out')}Sign out</button></div>`);
}
function accountSection() {
  if (!sbConfig()) return `<h2>Shared database</h2><div class="group pad"><p class="note">Keep your data in sync between your phones.</p><button class="btn primary" data-act="gosetup">Set up shared database</button></div>`;
  if (!cloud.on) return '';
  return `<h2>Household</h2><div class="group">
    <div class="line"><span>Signed in as</span><b>${esc(cloud.email)}</b></div>
    <div class="line"><span>${esc(cloud.name)}</span><span id="syncstatus" class="muted">${esc(cloud.status)}</span></div>
    <div class="line"><span>Invite code for your partner</span><b class="code">${esc(cloud.code)}</b></div>
    <div class="line"><button class="btn ghost" data-act="signout">${ic('log-out')}Sign out</button></div></div>`;
}

/* ---------- views ---------- */
function entryRows(kind, name, list) {
  const rows = list.map(e => `<div class="entry"><span>${esc(e.note || 'Entry')}</span><span class="entry-r"><span class="amt">${money(e.amt)}</span>
    ${iconBtn('del', 'x', 'Delete entry', `data-kind="${kind}" data-name="${esc(name)}" data-id="${e.id}"`)}</span></div>`).join('');
  return `<div class="entries">${rows}
    <form class="addform" data-act="add" data-kind="${kind}" data-name="${esc(name)}">
      <input type="number" step="0.01" inputmode="decimal" placeholder="Amount" required aria-label="Amount">
      <input type="text" placeholder="Note" aria-label="Note"><button class="btn primary">Add</button></form></div>`;
}
function section(kind, names, m, label) {
  const data = kind === 'i' ? m.income : m.expenses;
  const all = [...new Set([...names.map(n => n.name || n), ...Object.keys(data)])];
  const fixed = new Set(S.categories.filter(c => c.fixed).map(c => c.name));
  const total = all.reduce((a, n) => a + sum(data[n] || []), 0);
  return `<div class="sec-head"><h2>${label}</h2><span class="muted num-sm">${money(total)}</span></div><div class="group">` + all.map(n => {
    const list = data[n] || [], isOpen = open.has(`${kind}:${n}`), v = sum(list);
    return `<button class="row" data-act="toggle" data-key="${kind}:${esc(n)}" aria-expanded="${isOpen}">
      ${kind === 'i' ? avatar(n, Math.max(0, S.sources.indexOf(n))) : ''}<span class="name">${esc(n)}${kind === 'e' && fixed.has(n) ? '<span class="badge">Fixed</span>' : ''}</span>
      <span class="amt ${v ? '' : 'zero'}">${money(v)}</span><span class="chev ${isOpen ? 'open' : ''}">${ic('chevron-down', 14)}</span></button>${isOpen ? entryRows(kind, n, list) : ''}`;
  }).join('') + '</div>';
}
function viewMonth() {
  const m = ensureMonth(cur), c = calc(cur);
  const r = reminderState();
  const isNow = cur === keyOf(new Date());
  const notice = isNow && r ? `<div class="notice">${ic('bell', 18)}<div><b>${esc(r.title)}</b><span>${esc(r.body)}</span></div></div>` : '';
  return `${monthNav(monthName(cur))}${notice}
  <section class="hero"><div class="label">Balance</div>
    <div class="big ${tone(c.balance)}">${money(c.balance)}</div>
    <div class="sub">${money(c.afterSavings)} after planned savings of ${money(c.planned)}</div>
    <div class="stats">${stat('Income', money(c.income))}${stat('Expenses', money(c.expenses))}${stat('Spent, no fixed', money(c.variable))}</div></section>
  ${section('i', S.sources, m, 'Income')}
  ${section('e', S.categories, m, 'Expenses')}`;
}
function acctOptions(selected) {
  const list = S.accounts.includes(selected) || !selected ? S.accounts : [...S.accounts, selected];
  return `<option value="">Choose account</option>` + list.map(a => `<option value="${esc(a)}" ${a === selected ? 'selected' : ''}>${esc(a)}</option>`).join('');
}
const shortDate = d => { try { return new Date(d + 'T00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch (e) { return ''; } };
function nextHue() { const used = new Set(S.goals.map(g => g.hue)); const free = randomPerm().filter(h => !used.has(h)); return free.length ? free[0] : Math.floor(Math.random() * 5); }
// a goal's colour: the goal's own stored colour (the template is the source of truth), never a shared default
function hueOf(g) {
  const t = S.goals.find(x => x.id === g.id);
  if (t && Number.isInteger(t.hue)) return t.hue;
  if (Number.isInteger(g.hue)) return g.hue;
  return Math.max(0, S.goals.findIndex(x => x.id === g.id)) % 5;
}
function goalCard(g) {
  const ed = editing.has(g.id), adding = addingDep.has(g.id);
  const pct = g.amount > 0 ? Math.min(100, g.moved / g.amount * 100) : 0;
  const over = g.moved > g.amount + 0.005 ? round2(g.moved - g.amount) : 0;
  const deps = g.deps.map(d => `<div class="dep"><span class="dep-main"><b>${esc(d.account || 'No account')}</b>${d.date ? `<small>${shortDate(d.date)}</small>` : ''}</span>
    <span class="amt">${money(d.amt)}</span>${ed ? iconBtn('dep-del', 'x', 'Delete deposit', `data-goal="${g.id}" data-id="${d.id}"`) : ''}</div>`).join('');
  const title = ed ? `<input type="text" value="${esc(g.name)}" data-act="goal-name" data-id="${g.id}" aria-label="Goal name">`
    : `<div class="goal-id"><div class="goal-name">${esc(g.name)}</div><div class="goal-sub">${g.pct}% of income</div></div>`;
  return `<article class="goal ${g.done ? 'done' : ''}" data-hue="${hueOf(g)}">
    <div class="goal-head">${title}<b class="goal-amt">${money(g.amount)}</b>
      ${iconBtn('goal-edit', ed ? 'check' : 'pencil', ed ? 'Done editing' : 'Edit goal', `data-id="${g.id}"`)}${iconBtn('goal-del', 'x', 'Remove goal', `data-id="${g.id}"`)}</div>
    ${ed ? `<label class="target"><span>Monthly target</span>
      <input type="number" min="0" max="100" step="0.5" value="${g.pct}" data-act="goal-val" data-id="${g.id}" aria-label="Percent of income"><em>% of income</em></label>` : ''}
    <div class="prog"><div class="track"><i style="width:${pct}%"></i></div>
      <div class="prog-l"><span><b>${money(g.moved)}</b> of ${money(g.amount)}</span>
        <span class="${g.done ? 'ok' : ''}">${g.done ? (over ? `Done, ${money(over)} over` : 'Done') : `${money(g.remaining)} left`}</span></div></div>
    ${deps ? `<div class="deps">${deps}</div>` : ''}
    ${adding ? `<form class="depform" data-act="dep-add" data-id="${g.id}">
      <input type="number" min="0" step="0.01" inputmode="decimal" placeholder="Deposit amount" required aria-label="Deposit amount">
      <div class="inline"><select required aria-label="Account for this deposit">${acctOptions(g.account || '')}</select><button class="btn primary">Add</button><button type="button" class="btn ghost" data-act="dep-cancel" data-id="${g.id}">Cancel</button></div>
      ${g.remaining > 0 ? `<button type="button" class="btn ghost sm fill" data-act="dep-fill" data-left="${g.remaining}">Fill remaining ${money(g.remaining)}</button>` : ''}
    </form>` : `<button class="btn ghost sm add-dep" data-act="dep-open" data-id="${g.id}">${ic('plus', 14)}Add deposit</button>`}
  </article>`;
}
function viewSavings() {
  const m = ensureMonth(cur), c = calc(cur);
  const goals = c.plan.map(goalCard).join('');
  const byAcct = {};
  c.plan.forEach(g => g.deps.forEach(d => { const k = d.account || 'No account'; byAcct[k] = (byAcct[k] || 0) + (Number(d.amt) || 0); }));
  const accts = Object.entries(byAcct);
  const warns = (c.income > 0 && c.planned > c.income ? '<p class="warn">Your savings targets are more than this month\'s income.</p>' : '') +
    (c.afterSavings < 0 && c.income > 0 && c.planned <= c.income ? '<p class="warn">Expenses plus savings are more than this month\'s income.</p>' : '');
  return `${monthNav(monthName(cur))}
  <section class="hero"><div class="label">Planned savings</div><div class="big">${money(c.planned)}</div>
    <div class="sub">${c.pctTotal}% of ${money(c.income)} income</div>
    <div class="stats">${stat('Moved so far', money(c.saved))}${stat('Still to move', money(c.toMove))}${stat('Left after savings', money(c.afterSavings), tone(c.afterSavings))}</div></section>
  <div class="sec-head"><h2>Savings goals</h2></div>${warns}
  <div class="bento">${goals}
  <form class="group pad stack addgoal" data-act="goal-add"><b>New goal</b>
    <input type="text" placeholder="Name, like Home down payment" required aria-label="Goal name">
    <input type="number" min="0" max="100" step="0.5" placeholder="Monthly target, % of income" required aria-label="Monthly target, percent of income">
    <button class="btn primary">Add goal</button></form>
  ${accts.length ? `<section class="group"><div class="card-title">Where it went</div>${accts.map(([k, v]) => `<div class="line"><span>${esc(k)}</span><b class="num-md">${money(v)}</b></div>`).join('')}</section>` : ''}
  </div>
  <p class="note">Log each deposit as you make it. The account you use becomes the default next month.</p>`;
}
function viewHistory() {
  const keys = Object.keys(S.months).filter(k => !isPristine(S.months[k])).sort().reverse();
  let totalSaved = 0, totalBal = 0;
  const rows = keys.map(k => { const c = calc(k); totalSaved += c.saved; totalBal += c.balance;
    return `<button class="ledger" data-act="goto" data-key="${k}"><span class="name">${monthName(k)}</span><span>${money(c.income)}</span><span>${money(c.expenses)}</span>
      <span class="${tone(c.balance)}">${money(c.balance)}</span><span>${money(c.saved)}</span></button>`; }).join('');
  return `<header class="monthnav plain"><h1>History</h1></header>
  <section class="hero"><div class="label">Total saved</div><div class="big">${money(totalSaved)}</div>
    <div class="sub">Cumulative balance ${money(totalBal)}</div></section>
  <div class="sec-head"><h2>Month by month</h2></div>
  <div class="group"><div class="ledger-scroll"><div class="ledger head"><span>Month</span><span>Income</span><span>Spent</span><span>Balance</span><span>Saved</span></div>
  ${rows || '<div class="empty">No months yet.</div>'}</div></div>
  <p class="note">Tap a month to open it. Bring in old sheet data under Settings, Import.</p>`;
}
function viewSettings() {
  const cats = S.categories.map((c, i) => `<div class="line edit"><input type="text" value="${esc(c.name)}" data-act="cat-name" data-i="${i}" aria-label="Category name">
    <label class="moved"><input type="checkbox" data-act="cat-fixed" data-i="${i}" ${c.fixed ? 'checked' : ''}><span>Fixed</span></label>
    ${c.fixed ? `<input type="number" class="narrow" placeholder="Auto" value="${c.auto || ''}" data-act="cat-auto" data-i="${i}" aria-label="Amount added every month">` : ''}
    ${iconBtn('cat-del', 'x', 'Remove category', `data-i="${i}"`)}</div>`).join('');
  const srcs = S.sources.map((s, i) => `<div class="line edit">${avatar(s, i)}<input type="text" value="${esc(s)}" data-act="src-name" data-i="${i}" aria-label="Name">
    ${iconBtn('src-del', 'x', 'Remove source', `data-i="${i}"`)}</div>`).join('');
  const accs = S.accounts.map((a, i) => `<div class="line edit"><input type="text" value="${esc(a)}" data-act="acc-name" data-i="${i}" aria-label="Account name">
    ${iconBtn('acc-del', 'x', 'Remove account', `data-i="${i}"`)}</div>`).join('');
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  return `<header class="monthnav plain"><h1>Settings</h1></header>
  <h2>Appearance</h2><div class="group pad"><div class="seg" role="group" aria-label="Theme">
    ${[['light', 'Light'], ['dark', 'Dark'], ['auto', 'System']].map(([v, l]) => `<button data-act="theme" data-v="${v}" aria-pressed="${(S.settings.theme || 'light') === v}">${l}</button>`).join('')}</div>
    <div class="btnrow"><button class="btn" data-act="shuffle">${ic('shuffle')}Shuffle card colours</button></div></div>
  ${accountSection()}
  <h2>Reminders</h2><div class="group">
    <label class="line"><span>Remind me mid-month and at month end</span><input type="checkbox" class="switch" data-act="notify" ${S.settings.notify ? 'checked' : ''}></label>
    <div class="line"><span>Mid-month reminder day</span><input type="number" min="1" max="28" class="narrow" value="${S.settings.midDay}" data-act="midday"></div>
    <div class="line"><button class="btn primary" data-act="perm">${ic('bell')}Enable notifications</button><span class="muted">${perm}</span></div>
    <div class="line"><button class="btn" data-act="ics">${ic('calendar')}Add to my calendar</button></div></div>
  <p class="note">Notifications show when you open the app on or after the reminder date. The calendar file repeats every month, even when the app is closed.</p>
  <h2>Currency</h2><div class="group"><div class="line"><span>Symbol</span><input type="text" class="narrow" value="${esc(S.settings.currency)}" data-act="currency"></div></div>
  <h2>People</h2><div class="group">${srcs}</div>
  <form class="inline" data-act="src-add"><input type="text" placeholder="Add a person or source" required><button class="btn">${ic('plus')}Add</button></form>
  <h2>Savings accounts</h2><div class="group">${accs}</div>
  <form class="inline" data-act="acc-add"><input type="text" placeholder="Add an account, like RESP" required><button class="btn">${ic('plus')}Add</button></form>
  <p class="note">These show up as choices on each savings goal.</p>
  <h2>Expense categories</h2><div class="group">${cats}</div>
  <form class="inline" data-act="cat-add"><input type="text" placeholder="Add a category" required><button class="btn">${ic('plus')}Add</button></form>
  <p class="note">Fixed categories, like rent, are left out of "Spent, no fixed". Give one an amount to add it to every new month.</p>
  <h2>Backup and import</h2><div class="group pad">
    <div class="btnrow"><button class="btn" data-act="export">Download backup</button>
    <label class="btn">Restore backup<input type="file" accept=".json" data-act="restore" hidden></label></div>

    </div>
  <h2>Import past months</h2><div class="group pad">${importPanel()}</div>
  ${cloud.on ? '' : '<div class="btnrow" style="margin-top:20px"><button class="btn danger" data-act="wipe">Erase all data</button></div>'}`;
}

const views = { month: viewMonth, savings: viewSavings, history: viewHistory, settings: viewSettings };
const screens = { setup: viewSetup, auth: viewAuth, household: viewHousehold, loading: () => '' };
function render() {
  $app.innerHTML = screen === 'app' ? views[tab]() : screens[screen]();
  $app.classList.toggle('wide', screen === 'app' && tab === 'savings');
  document.getElementById('tabs').hidden = screen !== 'app';
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  tintCards();
  if (focusAfterRender) { const el = document.querySelector(focusAfterRender); focusAfterRender = null; if (el) el.focus(); }
}
// Savings tab only: one soft random colour per card, different for each; the big total card (.hero) stays neutral
function tintCards() {
  if (screen !== 'app' || tab !== 'savings') return;   // colour is only for the Savings cards; every other screen stays plain
  let i = 0; const order = S.settings.hueOrder && S.settings.hueOrder.length === 5 ? S.settings.hueOrder : [3, 4, 1, 0, 2];
  $app.querySelectorAll('.group:not(.inner), .goal').forEach(el => {
    if (el.closest('.auth')) return;
    el.classList.add('tint');
    if (!el.dataset.hue) el.dataset.hue = order[i++ % 5];
  });
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
/* ---------- import: paste or upload, review the months found, tick the ones to import ---------- */
const imp = { text: '', month: keyOf(new Date()), parsed: null, sel: new Set(), mode: 'skip' };
function parseImport(text, fallbackMonth) {
  const months = {}; let bad = 0;
  const incomeNames = new Set(S.sources.map(x => x.toLowerCase()));
  text.split(/\r?\n/).forEach(line => {
    line = line.trim(); if (!line) return;
    const p = line.split(/[,\t;]/).map(x => x.trim().replace(/^"|"$/g, ''));
    if (/^(amount|total)$/i.test(p[p.length - 1])) return; // header row
    let k, type, cat, amtS;
    if (p.length >= 4 && /^\d{4}-\d{2}/.test(p[0])) { k = p[0].slice(0, 7); [, type, cat, amtS] = p; }       // month,type,category,amount
    else if (p.length === 3) { k = fallbackMonth; [type, cat, amtS] = p; }                                   // type,category,amount
    else if (p.length === 2) { k = fallbackMonth; [cat, amtS] = p; type = incomeNames.has(cat.toLowerCase()) ? 'income' : 'expense'; } // category,amount
    else { bad++; return; }
    const amt = parseFloat(String(amtS).replace(/[^0-9.\-]/g, ''));
    if (!k || !cat || isNaN(amt)) { if (!/amount|total/i.test(amtS || '')) bad++; return; } // skip header lines quietly
    const m = months[k] = months[k] || { income: {}, expenses: {}, rows: 0 };
    const kind = /^inc/i.test(type) ? 'income' : 'expenses';
    (m[kind][cat] = m[kind][cat] || []).push(amt); m.rows++;
  });
  return { months, bad };
}
function applyImport() {
  const { months } = imp.parsed; let n = 0, skipped = 0;
  for (const k of [...imp.sel].sort()) {
    const src = months[k]; if (!src) continue;
    const had = S.months[k] && !isPristine(S.months[k]);
    if (had && imp.mode === 'skip') { skipped++; continue; }
    const m = S.months[k] = S.months[k] || { income: {}, expenses: {}, plan: [], done: {} }; // history: no auto rent, no plan
    if (had && imp.mode === 'replace') { m.income = {}; m.expenses = {}; }
    if (!had) { m.income = {}; m.expenses = {}; }      // drop auto-filled rent so imported numbers are the truth
    for (const kind of ['income', 'expenses']) for (const [cat, list] of Object.entries(src[kind])) {
      m[kind][cat] = (m[kind][cat] || []).concat(list.map(amt => ({ id: uid(), amt, note: 'Imported' })));
    }
    n++;
  }
  return { n, skipped };
}
const sumArr = o => Object.values(o).reduce((a, l) => a + l.reduce((x, y) => x + y, 0), 0);
function importPanel() {
  const ms = imp.parsed ? Object.keys(imp.parsed.months).sort().reverse() : [];
  let review = '';
  if (imp.parsed) {
    review = ms.length ? `<div class="sec-head slim"><b>Months found (${ms.length})</b>
      <span><button class="btn ghost sm" data-act="imp-all">Select all</button><button class="btn ghost sm" data-act="imp-none">None</button></span></div>
      <div class="group inner">${ms.map(k => { const m = imp.parsed.months[k], has = S.months[k] && !isPristine(S.months[k]);
        return `<label class="line"><input type="checkbox" data-act="imp-sel" data-key="${k}" ${imp.sel.has(k) ? 'checked' : ''}>
          <span class="grow"><b>${monthName(k)}</b>${has ? '<span class="badge">Has data</span>' : ''}<small>${money(sumArr(m.income))} in · ${money(sumArr(m.expenses))} out · ${m.rows} rows</small></span></label>`; }).join('')}</div>
      <fieldset class="modes"><legend>If a month already has data</legend>
        ${[['skip', 'Skip it'], ['add', 'Add to it'], ['replace', 'Replace it']].map(([v, l]) => `<label class="moved"><input type="radio" name="impmode" data-act="imp-mode" value="${v}" ${imp.mode === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}</fieldset>
      <div class="btnrow"><button class="btn primary" data-act="imp-apply" ${imp.sel.size ? '' : 'disabled'}>Import ${imp.sel.size} month${imp.sel.size === 1 ? '' : 's'}</button>
        <button class="btn ghost" data-act="imp-clear">Cancel</button></div>`
      : '<p class="warn">No usable rows found. Check the format below.</p>';
    if (imp.parsed.bad) review += `<p class="note">${imp.parsed.bad} line(s) were skipped because they could not be read.</p>`;
  }
  return `<div class="field-row"><label class="note nm">Month for lines without a date</label><input type="month" data-act="imp-month" value="${esc(imp.month)}"></div>
    <textarea id="csv" data-act="imp-text" placeholder="2024-11,income,Mahdi,3000&#10;2024-11,expense,Rent,1600&#10;&#10;or just: Grocery,420.50">${esc(imp.text)}</textarea>
    <div class="btnrow"><button class="btn primary" data-act="imp-review">Review</button>
      <label class="btn">Choose CSV file<input type="file" accept=".csv,.txt,text/csv" data-act="imp-file" hidden></label></div>
    <p class="note">Each line is <code>month,type,category,amount</code>, like <code>2024-11,expense,Grocery,420.50</code>. Lines with only <code>category,amount</code> go into the month picked above, and are counted as income when the name is one of your people.</p>${review}`;
}
function findGoal(id) { return ensureMonth(cur).plan.find(g => g.id === id); }
function syncTemplate(g) { const t = S.goals.find(x => x.id === g.id); if (t) { t.name = g.name; t.pct = g.pct; t.account = g.account || ''; if (Number.isInteger(g.hue)) t.hue = g.hue; } } // the template is what new months start from

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
    case 'goal-del': { const id = t.dataset.id, n = ((m.deposits || {})[id] || []).length;
      if (n && !confirm(`This goal has ${n} deposit${n === 1 ? '' : 's'} logged this month. Remove it anyway?`)) return;
      editing.delete(id); addingDep.delete(id); m.plan = m.plan.filter(g => g.id !== id); if (m.deposits) delete m.deposits[id]; S.goals = S.goals.filter(g => g.id !== id); save(); break; }
    case 'goal-edit': editing.has(t.dataset.id) ? editing.delete(t.dataset.id) : editing.add(t.dataset.id); break;
    case 'dep-open': addingDep.add(t.dataset.id); focusAfterRender = `form.depform[data-id="${t.dataset.id}"] input`; break;
    case 'dep-cancel': addingDep.delete(t.dataset.id); break;
    case 'dep-del': { const l = m.deposits[t.dataset.goal]; m.deposits[t.dataset.goal] = l.filter(d => d.id !== t.dataset.id); save(); break; }
    case 'dep-fill': { const f = t.closest('form'); f.querySelector('input').value = t.dataset.left; f.querySelector('input').focus(); return; }
    case 'shuffle': { S.settings.hueOrder = randomPerm(); assignGoalHues(S.goals, true); save(); break; }   // new random colours; goal colours are shared with your partner
    case 'theme': S.settings.theme = t.dataset.v; applyTheme(); save(); break;
    case 'acc-del': S.accounts.splice(+t.dataset.i, 1); save(); break;
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
    case 'imp-review': { const ta = document.getElementById('csv'); if (ta) imp.text = ta.value; imp.parsed = parseImport(imp.text, imp.month); imp.sel = new Set(Object.keys(imp.parsed.months)); break; }
    case 'imp-all': imp.sel = new Set(Object.keys(imp.parsed.months)); break;
    case 'imp-none': imp.sel = new Set(); break;
    case 'imp-clear': imp.parsed = null; imp.sel = new Set(); imp.text = ''; break;
    case 'imp-apply': { const r = applyImport(); save(); imp.parsed = null; imp.sel = new Set(); imp.text = '';
      alert(`Imported ${r.n} month${r.n === 1 ? '' : 's'}${r.skipped ? `, skipped ${r.skipped} that already had data` : ''}.`); break; }
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
document.addEventListener('input', e => { if (e.target.dataset && e.target.dataset.act === 'imp-text') imp.text = e.target.value; });
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
    case 'dep-add': { const mo = ensureMonth(cur), g = findGoal(f.dataset.id); if (!g) return;
      const amt = round2(parseFloat(v1)); if (!(amt > 0)) return;
      const acct = f.querySelector('select').value, today = new Date(), inMonth = keyOf(today) === cur;
      mo.deposits = mo.deposits || {}; (mo.deposits[g.id] = mo.deposits[g.id] || []).push({ id: uid(), amt, account: acct, date: inMonth ? `${keyOf(today)}-${pad(today.getDate())}` : '' });
      g.account = acct; syncTemplate(g); addingDep.delete(g.id); break; }
    case 'goal-add': { const g = { id: uid(), name: v1.trim(), pct: Math.max(0, parseFloat(v2) || 0), account: '', hue: nextHue() }; S.goals.push(g); ensureMonth(cur).plan.push({ ...g }); break; }
    case 'acc-add': { const n = v1.trim(); if (n && !S.accounts.includes(n)) S.accounts.push(n); break; }
    case 'cat-add': S.categories.push({ name: v1.trim() }); break;
    case 'src-add': S.sources.push(v1.trim()); break;
  }
  save(); render();
});
document.addEventListener('change', e => {
  const t = e.target, a = t.dataset.act; if (!a) return;
  const i = +t.dataset.i;
  switch (a) {
    case 'goal-name': { const g = findGoal(t.dataset.id); g.name = t.value; syncTemplate(g); save(); renderSoon(); return; }
    case 'goal-val': { const g = findGoal(t.dataset.id); g.pct = Math.max(0, parseFloat(t.value) || 0); syncTemplate(g); save(); renderSoon(); return; }
    case 'acc-name': { const old = S.accounts[i], nv = t.value.trim();
      if (nv && nv !== old && !S.accounts.includes(nv)) { S.accounts[i] = nv;
        S.goals.forEach(g => { if (g.account === old) g.account = nv; });
        Object.values(S.months).forEach(mo => { (mo.plan || []).forEach(g => { if (g.account === old) g.account = nv; });
          Object.values(mo.deposits || {}).forEach(l => l.forEach(d => { if (d.account === old) d.account = nv; })); }); } break; }
    case 'cat-name': S.categories[i].name = t.value.trim() || S.categories[i].name; break;
    case 'cat-fixed': S.categories[i].fixed = t.checked; break;
    case 'cat-auto': S.categories[i].auto = parseFloat(t.value) || 0; break;
    case 'src-name': S.sources[i] = t.value.trim() || S.sources[i]; break;
    case 'currency': S.settings.currency = t.value || '$'; break;
    case 'notify': S.settings.notify = t.checked; break;
    case 'imp-sel': t.checked ? imp.sel.add(t.dataset.key) : imp.sel.delete(t.dataset.key); render(); return;
    case 'imp-mode': imp.mode = t.value; return;
    case 'imp-month': imp.month = t.value || keyOf(new Date()); return;
    case 'imp-file': { const f = t.files[0]; if (!f) return;
      f.text().then(txt => { imp.text = txt; imp.parsed = parseImport(txt, imp.month); imp.sel = new Set(Object.keys(imp.parsed.months)); render(); }); return; }
    case 'midday': S.settings.midDay = Math.min(28, Math.max(1, parseInt(t.value) || 15)); break;
    case 'restore': {
      const file = t.files[0]; if (!file) return;
      file.text().then(txt => { try { const d = JSON.parse(txt); if (!d.months) throw 0; S = Object.assign(defaultState(), d); S.settings = Object.assign(defaultState().settings, d.settings); save(); applyTheme(); render(); alert('Backup restored.'); } catch (_) { alert('That file is not a valid backup.'); } });
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
applyTheme();
screen = 'loading';
render();
initCloud().then(maybeNotify);
