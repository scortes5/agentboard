// AgentBoard — shared state of the window: the board (cfg), each card's runtime, and small helpers.
/* global Terminal, FitAddon, WebLinksAddon */
'use strict';

/* global ab */ // exposed by preload.js as window.ab
const $ = (s, el = document) => el.querySelector(s);

const MIN_ZOOM = 0.3, MAX_ZOOM = 2;
const HEAD_H = 32;            // card header height (does not scale)
const DEFAULT_W = 720, DEFAULT_H = 440;
const BUSY_MS = 1500;         // recent output => "working"

let cfg = null;
let platform = 'darwin';
let agentAvailable = {};
const runtime = new Map();     // id -> { el, term, fit, statusEl, gitEl, lastData, busySince, alive }
let zTop = 1;
let focusedId = null;

const board = $('#board');
const world = $('#world');

// ---------- Utilities ----------
const uid = () => Math.random().toString(36).slice(2, 10);
const basename = (p) => (p || '').split(/[\\/]/).filter(Boolean).pop() || p;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const isMac = () => platform === 'darwin';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let saveTimer = null;
function save() {
  syncGroups();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => ab.saveConfig(cfg), 400);
}
function saveNow() {
  syncGroups();
  clearTimeout(saveTimer);
  return ab.saveConfig(cfg);
}

function cardData(id) { return cfg.cards.find((c) => c.id === id); }
function agentOf(card) { return cfg.agents[card.agent] || cfg.agents.shell; }
