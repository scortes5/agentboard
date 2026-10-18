// Shell commands the window runs: an automation's "Command" step and a task's checks. They run
// in the user's shell inside the project; secrets the command asks for come in as environment
// variables and are hidden in the output.
'use strict';
const { SecretVault } = require('../secrets/SecretVault');
const { wrap } = require('../core/platform');

class CommandRunner {
  constructor({ shellEnv, vault, audit }) {
    Object.assign(this, { shellEnv, vault, audit });
  }

  async run(cmd, cwd, secrets = []) {
    const env = this.vault.envFor(cmd, secrets);
    const r = await this.shellEnv.runInShell(cmd, cwd, { env });
    this.audit?.add('command', { cmd: SecretVault.redact(String(cmd), Object.values(env)).slice(0, 500), cwd, secrets: Object.keys(env), code: r.code });
    return { ...r, out: SecretVault.redact(r.out, Object.values(env)) };
  }

  register(ipcMain) {
    ipcMain.handle('flow:exec', wrap((_e, cmd, cwd, secrets) => this.run(cmd, cwd, Array.isArray(secrets) ? secrets : [])));
  }
}

module.exports = { CommandRunner };
