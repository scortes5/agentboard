// Read-only checks the providers use to tell whether a CLI is signed in or has the
// AgentBoard tools registered. They only look at whether things exist; secrets are never read.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { IS_MAC } = require('../core/platform');

const home = (...p) => path.join(os.homedir(), ...p);
const exists = (...p) => { try { return fs.existsSync(path.join(...p)); } catch { return false; } };
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const readText = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } };

// Whether the macOS Keychain has an entry (without -w/-g: the secret is not returned).
const keychainHas = (service) => new Promise((resolve) => {
  if (!IS_MAC) return resolve(false);
  execFile('security', ['find-generic-password', '-s', service], { timeout: 4000 }, (err) => resolve(!err));
});

module.exports = { home, exists, readJson, readText, keychainHas };
