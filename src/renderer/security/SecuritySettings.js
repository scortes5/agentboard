// AgentBoard — Settings → Security: the approval rules (ApprovalPolicy) and the security log
// kept by the main process (AuditLog). Plugs into Settings through settingsSections.
'use strict';
/* global $, ab, cfg, esc, settingsSections, DEFAULT_DANGER */

const AUDIT_TEXT = {
  approval: (e) => `${e.yes ? 'Approved' : 'Rejected'}${e.danger ? ' (dangerous)' : ''} by ${{ window: 'you', phone: 'your phone', rule: 'a rule' }[e.by] || e.by} · ${e.card}: ${[e.context, e.question].filter(Boolean).join(' · ')}`,
  'remote-on': (e) => `Remote control on${e.hours ? ` for ${e.hours} h` : ''}`,
  'remote-off': () => 'Remote control turned itself off',
  'remote-device': (e) => `A device used the remote: ${e.address} · ${e.browser}`,
  'remote-blocked': (e) => `Too many wrong links from ${e.address}: blocked for a few minutes`,
  'remote-refused': (e) => `Refused a dangerous approval from the phone · ${e.card}${e.question ? `: ${e.question}` : ''}`,
  command: (e) => `Command (exit ${e.code}) in ${e.cwd || '~'}: ${e.cmd}${e.secrets?.length ? ` · secrets: ${e.secrets.join(', ')}` : ''}`,
  'secret-saved': (e) => `Secret saved: ${e.name}`,
  'secret-removed': (e) => `Secret removed: ${e.name}`,
};

class SecuritySettings {
  constructor() {
    $('#dangerDefaults').onclick = () => { $('#settingsForm').approvalDanger.value = DEFAULT_DANGER.join('\n'); };
    $('#auditRefresh').onclick = () => this.renderLog();
  }

  load(f) {
    f.approvalDanger.value = cfg.approvalDanger ?? DEFAULT_DANGER.join('\n');
    f.approvalAuto.value = cfg.approvalAuto || '';
    this.renderLog();
  }

  save(f) {
    cfg.approvalDanger = f.approvalDanger.value.trim();
    cfg.approvalAuto = f.approvalAuto.value.trim();
  }

  async renderLog() {
    const list = await ab.auditRecent(150);
    $('#auditList').innerHTML = list.length
      ? list.map((e) => `<div class="audit-row ${esc(e.kind)}"><time>${esc(new Date(e.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }))}</time>
          <span>${esc((AUDIT_TEXT[e.kind] || ((x) => x.kind))(e))}</span></div>`).join('')
      : '<div class="muted small">Nothing yet.</div>';
  }
}

settingsSections.push(new SecuritySettings());
