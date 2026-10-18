// Every menu action and its default shortcut; Settings → Shortcuts overrides them
// (cfg.shortcuts = { action: "CmdOrCtrl+Shift+X" }, empty = no shortcut).
'use strict';

module.exports = [
  { id: 'new:claude', label: 'New Claude', key: 'CmdOrCtrl+Shift+1', section: 'Agents' },
  { id: 'new:codex', label: 'New Codex', key: 'CmdOrCtrl+Shift+2', section: 'Agents' },
  { id: 'new:gemini', label: 'New Gemini', key: 'CmdOrCtrl+Shift+3', section: 'Agents' },
  { id: 'new:shell', label: 'New Terminal', key: 'CmdOrCtrl+Shift+4', section: 'Agents' },
  { id: 'new:note', label: 'New Note', key: 'CmdOrCtrl+Shift+N', section: 'Board' },
  { id: 'new:group', label: 'New Group', key: 'CmdOrCtrl+Shift+G', section: 'Board' },
  { id: 'tasks', label: 'Tasks', key: 'CmdOrCtrl+Shift+T', section: 'Panels' },
  { id: 'diagram', label: 'Diagram', key: 'CmdOrCtrl+Shift+D', section: 'Panels' },
  { id: 'flows', label: 'Automations', key: 'CmdOrCtrl+Shift+F', section: 'Panels' },
  { id: 'usage', label: 'Usage and Savings', key: 'CmdOrCtrl+Shift+U', section: 'Panels' },
  { id: 'palette', label: 'Search or Run…', key: 'CmdOrCtrl+Shift+P', section: 'Panels' },
  { id: 'sidebar', label: 'Agent List', key: 'CmdOrCtrl+Shift+A', section: 'Panels' },
  { id: 'space:next', label: 'Next Project', key: 'CmdOrCtrl+Alt+Right', section: 'Projects' },
  { id: 'space:prev', label: 'Previous Project', key: 'CmdOrCtrl+Alt+Left', section: 'Projects' },
  { id: 'space:all', label: 'All Projects', key: 'CmdOrCtrl+Alt+0', section: 'Projects' },
  { id: 'arrange', label: 'Arrange Cards', key: 'CmdOrCtrl+Shift+O', section: 'Board' },
  { id: 'fit', label: 'Fit All', key: 'CmdOrCtrl+0', section: 'Board' },
  { id: 'zoom:in', label: 'Zoom In', key: 'CmdOrCtrl+=', section: 'Board' },
  { id: 'zoom:out', label: 'Zoom Out', key: 'CmdOrCtrl+-', section: 'Board' },
  { id: 'shortcuts', label: 'Keyboard Shortcuts…', key: 'CmdOrCtrl+/', section: 'Panels' },
  { id: 'settings', label: 'Settings…', key: 'CmdOrCtrl+,', section: 'Panels' },
];
