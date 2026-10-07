/* Trend TV v0.1 — CRT typing companion.
   Works both inside Tauri (live fetcher via Rust) and in a plain
   browser preview (falls back to the bundled snapshot). */

import snapshot from './snapshot.json';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';

const CHANNELS = [
  { id: 'all',        num: 'CH-00', label: 'ALL',        desc: 'everything trending' },
  { id: 'production', num: 'CH-01', label: 'Production', desc: 'frameworks, infra, AI' },
  { id: 'visual',     num: 'CH-02', label: 'Visual',     desc: 'UI, design, frontend' },
  { id: 'audio',      num: 'CH-03', label: 'Audio',      desc: 'music & sound tools' },
  { id: 'devtools',   num: 'CH-04', label: 'DevTools',   desc: 'CLI & dev utilities' },
  { id: 'games',      num: 'CH-05', label: 'Games',      desc: 'engines & game code' },
];

const THEMES = [
  { id: 'green', label: 'Green CRT' },
  { id: 'amber', label: 'Amber' },
  { id: 'vhs',   label: 'VHS Blue' },
  { id: 'bw',    label: 'B&W 1950s' },
];

/* keyword categorization — mirrors the Rust backend, used for
   browser-preview mode where we only have the raw snapshot */
function categorize(lang, desc) {
  const t = `${lang} ${desc}`.toLowerCase();
  const has = (...ws) => ws.some(w => t.includes(w));
  if (has('audio', 'music', 'sound', 'synth', 'midi', 'dsp', 'spotify')) return 'audio';
  if (has('game', 'godot', 'unity', 'unreal', 'engine', 'bevy')) return 'games';
  if (has('css', 'ui', 'design', 'frontend', 'tailwind', 'react', 'vue', 'svelte',
          'component', 'animation', 'three.js', 'webgl', 'shader', 'canvas', 'figma')) return 'visual';
  if (has('cli', 'terminal', 'shell', 'linter', 'formatter', 'git ', 'devtools',
          'debug', 'build tool', 'bundler', 'compiler')) return 'devtools';
  return 'production';
}

/* ── state ── */
const state = {
  channel: localStorage.getItem('tc.channel') || 'all',
  theme: localStorage.getItem('tc.theme') || 'green',
  items: [],          // all items for current channel
  bag: [],            // shuffled queue (no repeats until exhausted)
  seen: JSON.parse(localStorage.getItem('tc.seen') || '[]'),
  current: null,
  signalLost: false,
  timers: [],
};

const $ = (id) => document.getElementById(id);
// __TAURI_INTERNALS__ exists whenever we run inside a Tauri webview,
// regardless of the global-injection setting
const inTauri = typeof window.__TAURI_INTERNALS__ !== 'undefined' || !!window.__TAURI__;

/* ── data layer ── */
async function loadFeed() {
  try {
    if (inTauri) {
      const payload = await invoke('get_feed');
      // payload: { items: [...], signal_lost: bool }
      state.signalLost = !!payload.signal_lost;
      return payload.items || [];
    }
    // browser preview: bundled snapshot
    const res = await fetch('./src/snapshot.json');
    const raw = res.ok ? await res.json() : snapshot;
    state.signalLost = false;
    return raw.map(it => ({ ...it, category: categorize(it.lang, it.desc) }));
  } catch (e) {
    console.warn('feed load failed, using bundled snapshot', e);
    state.signalLost = false;
    return snapshot.map(it => ({ ...it, category: categorize(it.lang, it.desc) }));
  }
}

function itemsForChannel(ch) {
  if (ch === 'all') return state.allItems;
  return state.allItems.filter(i => i.category === ch);
}

/* ── bag randomizer with seen-history ── */
function refillBag() {
  const pool = itemsForChannel(state.channel);
  if (!pool.length) { state.bag = []; return; }
  // fresh (unseen) first, then seen ones as fallback
  const fresh = pool.filter(i => !state.seen.includes(i.name));
  const stale = pool.filter(i => state.seen.includes(i.name));
  const shuffle = (a) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  state.bag = [...shuffle(fresh), ...shuffle(stale)];
}

function nextItem() {
  if (!state.bag.length) refillBag();
  if (!state.bag.length) return null;
  const item = state.bag.shift();
  state.seen.push(item.name);
  if (state.seen.length > 200) state.seen = state.seen.slice(-200);
  localStorage.setItem('tc.seen', JSON.stringify(state.seen));
  return item;
}

/* ── typing engine ── */
function clearTimers() {
  state.timers.forEach(t => clearTimeout(t));
  state.timers = [];
}
const later = (fn, ms) => state.timers.push(setTimeout(fn, ms));

function typeInto(el, text, speed, done) {
  let i = 0;
  el.textContent = '';
  const step = () => {
    if (i < text.length) {
      el.textContent += text[i++];
      // variable per-char delay → mechanical feel
      const jitter = speed * (0.4 + Math.random() * 1.2);
      later(step, jitter);
    } else if (done) done();
  };
  step();
}

function showItem(item) {
  state.current = item;
  const screen = $('screen');
  screen.classList.remove('glitch');
  screen.classList.add('glitch-in');
  later(() => screen.classList.remove('glitch-in'), 350);

  $('f-meta').textContent = '';
  const speed = 26;
  typeInto($('f-name'), item.name, speed + 8, () => {
    typeInto($('f-cat'), `${item.category.toUpperCase()} · ${item.lang || 'unknown'}`, speed, () => {
      typeInto($('f-desc'), item.desc || '(no description)', speed * 0.55, () => {
        $('f-meta').textContent = `★ ${item.stars || '?'}   ${item.today || ''}`;
        // typing finished → hold static 5s for the user to read
        later(glitchOutAndNext, 5000);
      });
    });
  });
}

function glitchOutAndNext() {
  const screen = $('screen');
  screen.classList.add('glitch');
  later(() => {
    screen.classList.remove('glitch');
    const item = nextItem();
    if (item) showItem(item);
  }, 380);
}

/* ── channel switching with static burst ── */
function switchChannel(id) {
  if (id === state.channel) return;
  state.channel = id;
  localStorage.setItem('tc.channel', id);
  clearTimers();
  const st = $('static');
  st.classList.remove('hidden');
  later(() => {
    st.classList.add('hidden');
    updateChBadge();
    renderGuide();
    refillBag();
    const item = nextItem();
    if (item) showItem(item);
    else showEmptyChannel();
  }, 550);
}

function showEmptyChannel() {
  ['f-name', 'f-cat', 'f-desc', 'f-meta'].forEach(id => $(id).textContent = '');
  typeInto($('f-name'), '~ NO SIGNAL ON THIS CHANNEL ~', 30, () => {
    later(() => switchChannel('all'), 2000);
  });
}

function updateChBadge() {
  const ch = CHANNELS.find(c => c.id === state.channel);
  $('ch-badge').textContent = `${ch.num} · ${ch.label.toUpperCase()}`;
}

/* ── TV guide UI ── */
function renderGuide() {
  const wrap = $('guide-channels');
  wrap.innerHTML = '';
  CHANNELS.forEach(ch => {
    const div = document.createElement('div');
    div.className = 'ch-item' + (ch.id === state.channel ? ' active' : '');
    const n = itemsForChannel(ch.id).length;
    div.textContent = `▸ ${ch.num}  ${ch.label}  —  ${ch.desc} (${n})`;
    div.onclick = () => { switchChannel(ch.id); toggleGuide(false); };
    wrap.appendChild(div);
  });
  const tw = $('guide-themes');
  tw.innerHTML = '';
  THEMES.forEach(t => {
    const div = document.createElement('div');
    div.className = 'theme-chip' + (t.id === state.theme ? ' active' : '');
    div.textContent = t.label;
    div.onclick = () => setTheme(t.id);
    tw.appendChild(div);
  });
}

function toggleGuide(force) {
  const g = $('guide');
  const show = force !== undefined ? force : g.classList.contains('hidden');
  g.classList.toggle('hidden', !show);
  if (show) renderGuide();
}

function setTheme(id) {
  state.theme = id;
  document.body.dataset.theme = id;
  localStorage.setItem('tc.theme', id);
  renderGuide();
}

/* ── open repo ── */
async function openCurrent() {
  if (!state.current) return;
  const url = `https://github.com/${state.current.name}`;
  if (inTauri) {
    try {
      await openUrl(url);
      return;
    } catch (e) { console.warn(e); }
  }
  window.open(url, '_blank');
}

/* ── boot ── */
async function boot() {
  document.body.dataset.theme = state.theme;
  $('gear').onclick = () => toggleGuide();
  $('guide-close').onclick = () => toggleGuide(false);
  $('screen').onclick = (e) => { if (!e.target.closest('.guide')) openCurrent(); };

  state.allItems = await loadFeed();
  if (state.signalLost) $('standby').classList.remove('hidden');
  updateChBadge();
  refillBag();
  const item = nextItem();
  if (item) showItem(item);
}

boot();
