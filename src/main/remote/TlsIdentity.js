// The remote page's HTTPS certificate: made once on this computer and kept in the app's data
// folder, so the token never crosses the Wi-Fi in clear text. It is self-signed, so the phone
// asks once to trust it; the SHA-256 fingerprint in Settings lets you check it is this one.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class TlsIdentity {
  constructor({ dataDir, generate = TlsIdentity.generate }) {
    this.file = path.join(dataDir, 'remote-tls.json');
    this.generate = generate;
  }

  static async generate() {
    const selfsigned = require('selfsigned');
    const pems = await selfsigned.generate([{ name: 'commonName', value: 'AgentBoard remote' }], { days: 825, keySize: 2048, algorithm: 'sha256' });
    return { key: pems.private, cert: pems.cert };
  }

  static fingerprint(cert) {
    return new crypto.X509Certificate(cert).fingerprint256;
  }

  // { key, cert, fingerprint }, made the first time.
  async get() {
    if (!this.cached) {
      let id = null;
      try { id = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch {}
      if (!id?.key || !id?.cert) {
        id = await this.generate();
        fs.writeFileSync(this.file, JSON.stringify(id), { mode: 0o600 });
      }
      this.cached = { ...id, fingerprint: TlsIdentity.fingerprint(id.cert) };
    }
    return this.cached;
  }
}

module.exports = { TlsIdentity };
