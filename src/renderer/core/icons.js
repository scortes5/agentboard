// AgentBoard — line icons (monochrome, same stroke), in the style of SF Symbols.
// In HTML: <button data-icon="search">; in JS: icon('search').
'use strict';

const ICON_PATHS = {
  sidebar: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M9 4v16"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M2.8 12h2.4M18.8 12h2.4M4.9 19.1l1.7-1.7M17.4 6.6l1.7-1.7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>',
  more: '<circle cx="5.5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor"/>',
  focus: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  folder: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v8A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
  fit: '<path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5"/><rect x="8.5" y="8.5" width="7" height="7" rx="1"/>',
  note: '<path d="M6 3.5h8l4 4v13H6z"/><path d="M14 3.5v4h4M9 12h6M9 15.5h6"/>',
  group: '<rect x="3.5" y="3.5" width="17" height="17" rx="3" stroke-dasharray="3 2.4"/>',
  tasks: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8.5 12.3l2.4 2.4 4.8-5.2"/>',
  diagram: '<rect x="3" y="4" width="6.5" height="5" rx="1.2"/><rect x="14.5" y="4" width="6.5" height="5" rx="1.2"/><rect x="8.75" y="15" width="6.5" height="5" rx="1.2"/><path d="M6.25 9v2.5h11.5V9M12 11.5V15"/>',
  flows: '<circle cx="5.5" cy="6.5" r="2.5"/><circle cx="18.5" cy="12" r="2.5"/><circle cx="5.5" cy="17.5" r="2.5"/><path d="M8 6.5h3.5a3 3 0 0 1 3 3v0a2.5 2.5 0 0 0 1.5 2.3M8 17.5h3.5a3 3 0 0 0 3-3v0a2.5 2.5 0 0 1 1.5-2.3"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" stroke="none"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  branch: '<circle cx="7" cy="5.5" r="2"/><circle cx="7" cy="18.5" r="2"/><circle cx="17" cy="8" r="2"/><path d="M7 7.5v9M17 10c0 4-10 3-10 6.5"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  trash: '<path d="M4.5 7h15M10 7V4.5h4V7M6.5 7l1 12.5h9l1-12.5"/>',
  diff: '<path d="M12 4.5v7M8.5 8h7M8.5 18h7"/>',
  wand: '<path d="M4 20L15 9M13.5 7.5l3 3"/><path d="M17 3v3M15.5 4.5h3M20 9v2M19 10h2M9 3.5v2M8 4.5h2"/>',
  chat: '<path d="M4.5 5.5h15a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5V17H4.5A1.5 1.5 0 0 1 3 15.5V7a1.5 1.5 0 0 1 1.5-1.5z"/>',
  bolt: '<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>',
  agent: '<circle cx="12" cy="9" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/>',
  terminal: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M7 9.5l3 2.5-3 2.5M12.5 15h4.5"/>',
  decision: '<path d="M12 3.5l8.5 8.5-8.5 8.5L3.5 12z"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  idea: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  alert: '<path d="M12 4l9 15.5H3z"/><path d="M12 10v4.5M12 17.2v.3"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M7.5 14h9"/>',
  code: '<path d="M8.5 7L3.5 12l5 5M15.5 7l5 5-5 5"/>',
  chart: '<path d="M4 20h16"/><path d="M7 16v-5M12 16V7M17 16v-8"/>',
  layers: '<path d="M12 3.5l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  home: '<path d="M4 11l8-6.5 8 6.5V20H4z"/><path d="M10 20v-5h4v5"/>',
  send: '<path d="M4 12l16-7.5-6 16-2.5-6.5z"/>',
  list: '<path d="M8.5 7h11M8.5 12h11M8.5 17h11"/><path d="M4.5 7h.01M4.5 12h.01M4.5 17h.01"/>',
  pause: '<path d="M9 6v12M15 6v12"/>',
  lock: '<rect x="5" y="11" width="14" height="9.5" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  dot: '<circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/>',
};

function icon(name, size = 15) {
  const p = ICON_PATHS[name];
  if (!p) return '';
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}

// <button data-icon="search">Text</button> → icon + text
function hydrateIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]:not([data-icon-done])')) {
    el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon, +el.dataset.iconSize || 15));
    el.dataset.iconDone = '1';
  }
}

// ---------- Contextual help ----------
// After 2 s with the cursor over a control that has a `title`, show a box explaining
// what it does. Replaces the native tooltip (which appears sooner and looks different).
(function helpTips() {
  const DELAY = 2000;
  const tip = document.createElement('div');
  tip.id = 'helptip';
  tip.setAttribute('role', 'tooltip');
  let target = null, timer = null;

  // move title → data-tip so the system does not show its own tooltip
  const textOf = (el) => {
    const t = el.getAttribute('title');
    if (t) { el.dataset.tip = t; el.removeAttribute('title'); }
    return el.dataset.tip || '';
  };
  const hide = () => {
    clearTimeout(timer); timer = null; target = null;
    tip.classList.remove('show');
  };
  const show = (el, text) => {
    (el.closest('dialog[open]') || document.body).appendChild(tip);
    tip.textContent = text;
    tip.classList.add('show');
    const r = el.getBoundingClientRect();
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let x = r.left + r.width / 2 - w / 2;
    let y = r.bottom + 8;
    if (y + h > innerHeight - 8) y = r.top - h - 8; // no room below: show above
    x = Math.max(8, Math.min(x, innerWidth - w - 8));
    tip.style.left = `${Math.round(x)}px`;
    tip.style.top = `${Math.round(Math.max(8, y))}px`;
  };

  document.addEventListener('pointerover', (e) => {
    const el = e.target.closest?.('[title], [data-tip]');
    if (el === target) return;
    hide();
    if (!el || el.closest('.xterm')) return;
    const text = textOf(el);
    if (!text) return;
    target = el;
    timer = setTimeout(() => { if (target === el && el.isConnected) show(el, text); }, DELAY);
  }, true);
  document.addEventListener('pointerout', (e) => { if (target && !target.contains(e.relatedTarget)) hide(); }, true);
  for (const ev of ['pointerdown', 'keydown', 'wheel']) document.addEventListener(ev, hide, true);
  window.addEventListener('blur', hide);
})();
hydrateIcons();
