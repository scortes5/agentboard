// Ollama and LM Studio running on this machine, with their models. Only 127.0.0.1 is asked.
'use strict';
const http = require('http');

function localJson(port, pathname) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: pathname, timeout: 1500 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { body += d; if (body.length > 2e6) req.destroy(); });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

class LocalModels {
  constructor({ shellEnv }) {
    this.shellEnv = shellEnv;
  }

  async list() {
    const [tags, lms, ollamaInstalled] = await Promise.all([localJson(11434, '/api/tags'), localJson(1234, '/v1/models'), this.shellEnv.which('ollama')]);
    return {
      ollama: { installed: ollamaInstalled, running: !!tags, models: (tags?.models || []).map((m) => m.name).filter(Boolean) },
      lmstudio: { running: !!lms, models: (lms?.data || []).map((m) => m.id).filter(Boolean) },
    };
  }

  register(ipcMain) {
    ipcMain.handle('local:models', () => this.list());
  }
}

module.exports = { LocalModels };
