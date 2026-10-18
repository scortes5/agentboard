#!/usr/bin/env node
// node-pty 1.1.0 publishes spawn-helper without the execute bit on Mac: without this,
// opening a terminal fails with "posix_spawnp failed". Runs on `npm install`.
'use strict';
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'node_modules', 'node-pty', 'prebuilds');
let n = 0;
try {
  for (const arch of fs.readdirSync(dir)) {
    const f = path.join(dir, arch, 'spawn-helper');
    if (fs.existsSync(f)) { fs.chmodSync(f, 0o755); n++; }
  }
} catch {}
if (n) console.log(`node-pty: spawn-helper ejecutable (${n})`);
