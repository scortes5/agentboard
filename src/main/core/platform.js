// Platform flags and the small helpers every main-process module shares.
'use strict';

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

// IPC handlers that can fail answer { ok, value } or { ok: false, error } instead of throwing
// across the bridge, so the UI always gets a message it can show.
const wrap = (fn) => async (...args) => {
  try { return { ok: true, value: await fn(...args) }; } catch (err) { return { ok: false, error: err.message }; }
};

// "Fix the Login! Página" → "fix-the-login-pagina": safe for branch, folder and account names.
const slugify = (text, max = 40) => String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, max);

module.exports = { IS_WIN, IS_MAC, wrap, slugify };
