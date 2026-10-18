// AgentBoard — rules for permission requests (Settings → Security). A request whose command or
// file matches a "dangerous" rule is flagged in red, left out of Approve All and can't be approved
// from the phone; one that matches an "approve automatically" rule (and no dangerous one) is
// approved for you. Rules are one per line: plain text matches anywhere (ignoring case), and
// /…/ is a regular expression.
'use strict';
/* global cfg */

// A .env file (.env, .env.local, .env.production…), but not .env.example and not process.env in code.
const ENV_FILE_RULE = '/(?<![\\w$])\\.env(?![\\w.-]*(example|sample|template))/';

const DEFAULT_DANGER = [
  'rm -rf', 'rm -fr', 'git push --force', 'git push -f', 'git reset --hard', 'git clean -fd',
  'sudo ', 'chmod -R 777', 'mkfs', 'dd if=', '/curl[^|]*\\|\\s*(ba|z)?sh/', '/wget[^|]*\\|\\s*(ba|z)?sh/',
  'DROP TABLE', 'DROP DATABASE', ENV_FILE_RULE, 'id_rsa', '.ssh/', 'npm publish', 'kubectl delete', 'terraform destroy',
];

class ApprovalPolicy {
  static rules(text) {
    return String(text || '').split('\n').map((l) => l.trim()).filter(Boolean).map((r) => {
      const m = /^\/(.+)\/([a-z]*)$/.exec(r);
      if (m) { try { return new RegExp(m[1], m[2].includes('i') ? m[2] : `${m[2]}i`); } catch { return null; } }
      const lower = r.toLowerCase();
      return { test: (s) => s.toLowerCase().includes(lower) };
    }).filter(Boolean);
  }

  // Lists saved before 1.5.1 have a plain ".env" line, which also flagged .env.example and process.env.
  danger() {
    const text = cfg.approvalDanger ?? DEFAULT_DANGER.join('\n');
    return ApprovalPolicy.rules(text.split('\n').map((l) => (l.trim() === '.env' ? ENV_FILE_RULE : l)).join('\n'));
  }
  auto() { return ApprovalPolicy.rules(cfg.approvalAuto || ''); }

  // 'danger' | 'auto' | 'ask' for a request { question, context }.
  classify(a) {
    const text = `${a.context}\n${a.question}`;
    if (this.danger().some((r) => r.test(text))) return 'danger';
    if (this.auto().some((r) => r.test(text))) return 'auto';
    return 'ask';
  }
}

const approvalPolicy = new ApprovalPolicy();
