// AgentBoard — how numbers and times are written across the interface, in one place.
'use strict';

const fmt = {
  // 1234 → "1.2k", 3400000 → "3.4M" (usage panel).
  count: (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n))),
  // Tokens of a task: "42k", "1.3M".
  tokens: (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n || 0)),
  // Time a task has been working: "45s", "3m 07s", "1h 12m".
  elapsed: (ms) => {
    const s = Math.max(0, Math.round(ms / 1000));
    return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${Math.floor(s / 3600)}h ${Math.floor(s / 60) % 60}m`;
  },
  // A typical duration: "12 s", "8 min", "1.5 h".
  duration: (ms) => (ms >= 3600e3 ? `${(ms / 3600e3).toFixed(1)} h` : ms >= 60e3 ? `${Math.round(ms / 60e3)} min` : `${Math.round(ms / 1e3)} s`),
  // How long to wait: "29 min", "1 h 05 min".
  wait: (ms) => {
    const m = Math.max(1, Math.round(ms / 60000));
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
  },
  // "15:30"
  clock: (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
};
