/* Trend TV v0.1 — CRT typing companion.
   Works both inside Tauri (live fetcher via Rust) and in a plain
   browser preview (falls back to the bundled snapshot). */

import snapshot from './snapshot.json';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import * as snd from './sounds.js';

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

const CABINETS = [
  { id: 'slim',    label: 'Slim bezel' },
  { id: 'woody70', label: 'Woody 70s' },
];

// volume presets — default LOW, barely audible, never scare the user
const VOLUMES = [
  { id: 'off',  v: 0,    label: 'Off' },
  { id: 'low',  v: 0.12, label: 'Low' },
  { id: 'med',  v: 0.35, label: 'Med' },
  { id: 'high', v: 0.7,  label: 'High' },
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
  cabinet: localStorage.getItem('tc.cabinet') || 'slim',
  chKnobAngle: 0,
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
      if (text[i - 1] !== ' ') snd.clack();
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
  snd.staticBurst(0.55, 0.5);
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
    div.onclick = () => { snd.knobClick(); setTheme(t.id); };
    tw.appendChild(div);
  });
  const cw = $('guide-cabinets');
  cw.innerHTML = '';
  CABINETS.forEach(c => {
    const div = document.createElement('div');
    div.className = 'theme-chip' + (c.id === state.cabinet ? ' active' : '');
    div.textContent = c.label;
    div.onclick = () => { snd.knobClick(); setCabinet(c.id); };
    cw.appendChild(div);
  });
  const vw = $('guide-volume');
  vw.innerHTML = '';
  const curVol = snd.getVolume();
  VOLUMES.forEach(v => {
    const div = document.createElement('div');
    const active = Math.abs(curVol - v.v) < 0.01 ||
      (v.id === 'off' && curVol === 0);
    div.className = 'theme-chip' + (active ? ' active' : '');
    div.textContent = v.label;
    div.onclick = () => { setVolumeStep(v.v); };
    vw.appendChild(div);
  });
}

function setCabinet(id) {
  state.cabinet = id;
  document.body.dataset.cabinet = id;
  localStorage.setItem('tc.cabinet', id);
  renderGuide();
}

function setVolumeStep(v) {
  snd.setVolume(v);
  snd.knobClick();
  syncVolKnob();
  renderGuide();
}

/* ── physical knobs (woody70 cabinet) ── */
function syncVolKnob() {
  const knob = $('knob-vol');
  if (!knob) return;
  // map 0..0.7 → -135°..+135°
  const angle = -135 + (snd.getVolume() / 0.7) * 270;
  knob.style.transform = `rotate(${angle}deg)`;
}

function turnChKnob() {
  snd.knobClick();
  state.chKnobAngle += 60; // detent click per channel
  $('knob-ch').style.transform = `rotate(${state.chKnobAngle}deg)`;
  const idx = CHANNELS.findIndex(c => c.id === state.channel);
  const next = CHANNELS[(idx + 1) % CHANNELS.length];
  switchChannel(next.id);
}

function turnVolKnob() {
  const cur = snd.getVolume();
  // cycle off → low → med → high → off
  const idx = VOLUMES.findIndex(v => Math.abs(cur - v.v) < 0.01);
  const next = VOLUMES[(idx + 1) % VOLUMES.length];
  setVolumeStep(next.v);
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
  // URL overrides for testing/sharing: ?cabinet=woody70&theme=amber
  const q = new URLSearchParams(location.search);
  if (q.get('cabinet')) state.cabinet = q.get('cabinet');
  if (q.get('theme')) state.theme = q.get('theme');
  document.body.dataset.theme = state.theme;
  document.body.dataset.cabinet = state.cabinet;
  $('gear').onclick = () => { snd.knobClick(); toggleGuide(); };
  $('guide-close').onclick = () => toggleGuide(false);
  $('screen').onclick = (e) => { if (!e.target.closest('.guide')) openCurrent(); };
  $('screen').addEventListener('mouseenter', () => snd.degauss());
  $('knob-ch').onclick = (e) => { e.stopPropagation(); turnChKnob(); };
  $('knob-vol').onclick = (e) => { e.stopPropagation(); turnVolKnob(); };
  syncVolKnob();
  // browsers gate audio behind the first gesture; play power-on then
  snd.armAudioUnlock(() => snd.powerOn());

  state.allItems = await loadFeed();
  if (state.signalLost) $('standby').classList.remove('hidden');
  updateChBadge();
  refillBag();
  const item = nextItem();
  if (item) showItem(item);
}

boot();
