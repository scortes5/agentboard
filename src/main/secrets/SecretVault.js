// Secrets (passwords, API keys, logins) for automations. Each value is encrypted with the
// operating system's keychain (Electron safeStorage) and kept in secrets.json in the app's data
// folder. The window can list the names but never read a value back: values only leave the
// vault as environment variables of the automation commands that ask for them, and are hidden
// in what those commands print. Agents' prompts never get them.
'use strict';
const fs = require('fs');
const path = require('path');
const { wrap } = require('../core/platform');

const NAME_RE = /^[A-Z_][A-Z0-9_]{0,63}$/;
const MAX_VALUE = 16 * 1024;
const MASK = '••••••';

class SecretVault {
  // crypto: Electron's safeStorage (tests pass a stand-in with the same methods).
  constructor({ dataDir, crypto }) {
    this.file = path.join(dataDir, 'secrets.json');
    this.crypto = crypto;
  }

  // Without a system keyring (some Linux setups) Electron would store them as plain text.
  ensureEncryption() {
    if (!this.crypto.isEncryptionAvailable() || this.crypto.getSelectedStorageBackend?.() === 'basic_text') {
      throw new Error('This computer has no keychain to encrypt secrets with (on Linux, install and unlock GNOME Keyring or KWallet).');
    }
  }

  read() {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { return {}; }
  }

  write(all) {
    fs.writeFileSync(this.file, JSON.stringify(all, null, 2), { mode: 0o600 });
  }

  list() {
    return Object.entries(this.read()).map(([name, s]) => ({ name, updatedAt: s.updatedAt })).sort((a, b) => a.name.localeCompare(b.name));
  }

  set(name, value) {
    if (!NAME_RE.test(name || '')) throw new Error('Use a name like APP_PASSWORD: capital letters, digits and _.');
    if (!value || String(value).length > MAX_VALUE) throw new Error('Write the value (up to 16 KB).');
    this.ensureEncryption();
    const all = this.read();
    all[name] = { value: this.crypto.encryptString(String(value)).toString('base64'), updatedAt: Date.now() };
    this.write(all);
    return this.list();
  }

  remove(name) {
    const all = this.read();
    delete all[name];
    this.write(all);
    return this.list();
  }

  // Names a command mentions ($NAME, ${NAME} or %NAME% on Windows).
  static referenced(cmd) {
    return [...String(cmd || '').matchAll(/\$\{?([A-Z_][A-Z0-9_]*)\}?|%([A-Z_][A-Z0-9_]*)%/g)].map((m) => m[1] || m[2]);
  }

  // The values for a command: the secrets it mentions plus the ones its step lists by name.
  envFor(cmd, names = []) {
    const all = this.read();
    const wanted = [...new Set([...SecretVault.referenced(cmd), ...names])].filter((n) => all[n]);
    if (wanted.length) this.ensureEncryption();
    return Object.fromEntries(wanted.map((n) => [n, this.crypto.decryptString(Buffer.from(all[n].value, 'base64'))]));
  }

  // Output with every secret value replaced, so it can be shown and passed on.
  static redact(text, values) {
    return values.filter((v) => v.length >= 4).sort((a, b) => b.length - a.length)
      .reduce((out, v) => out.split(v).join(MASK), String(text));
  }

  register(ipcMain) {
    ipcMain.handle('secrets:list', () => this.list());
    ipcMain.handle('secrets:set', wrap((_e, name, value) => this.set(name, value)));
    ipcMain.handle('secrets:remove', wrap((_e, name) => this.remove(name)));
  }
}

module.exports = { SecretVault, NAME_RE };
