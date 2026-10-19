// AgentBoard — checks after each task: when the agent says DONE, the project's verify command
// (tests, lint) runs; if it fails, the output goes back to the same agent, a few times at most,
// before the task is marked blocked.
'use strict';
/* global cfg, esc, ab, toast, save, cardData, runtime, renderTasks, finishTask, startTaskAgain, projectOfPath, taskPipeline */

const tail = (text, n) => text.split('\n').slice(-n).join('\n');

class ChecksStep {
  // The task's project command, or the default one in Settings → Tasks.
  commandFor(t) {
    const project = cfg.projects.find((p) => p.path === t.cwd || p.path === projectOfPath(t.cwd || ''));
    return (project?.verify ?? '').trim() || (cfg.verifyCmd || '').trim();
  }

  async onMarker(t, marker) {
    const cmd = marker.status === 'done' && !t.reviewOf ? this.commandFor(t) : '';
    if (!cmd) return false;
    t.status = 'verifying'; t.summary = marker.text;
    save(); renderTasks();
    const r = await ab.flowExec(cmd, t.workdir || t.cwd);
    const result = r.ok ? r.value : { code: -1, out: r.error };
    if (result.code === 0) { finishTask(t, 'done', `${marker.text} · checks passed`); return true; }
    this.sendBack(t, cmd, result);
    return true;
  }

  sendBack(t, cmd, result) {
    t.checkFailures = (t.checkFailures || 0) + 1;
    const c = t.cardId && cardData(t.cardId);
    const lastLine = result.out.trim().split('\n').pop() || `exit code ${result.code}`;
    if (t.checkFailures > (cfg.verifyRetries ?? 2) || !c || !runtime.get(c.id)?.alive) {
      finishTask(t, 'blocked', `Checks failed (${cmd}): ${lastLine}`.slice(0, 300));
      return;
    }
    toast(`Checks failed for <b>${esc(t.text.slice(0, 50))}</b>; sent back to its agent (try ${t.checkFailures}).`, 5000);
    startTaskAgain(t);
    ab.ptyPaste(c.id, `The project's checks (\`${cmd}\`) failed after your change. Fix the cause, run them again, and end with a new «DONE: …» line.\n\n${tail(result.out, 60)}`);
  }
}

taskPipeline.use(new ChecksStep());
