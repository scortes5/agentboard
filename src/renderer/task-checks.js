// AgentBoard — what happens when an agent says it is done, before the task counts as done:
//   1. Checks: the project's verify command (tests, lint) runs; if it fails, the output goes
//      back to the same agent, up to a few times, before the task is marked blocked.
//   2. Cross-review: another subscription reads the changes without editing them and either
//      approves or sends the problems back to the first agent.
'use strict';
/* global cfg, esc, ab, toast, save, cardData, runtime, renderTasks, finishTask, startTaskAgain, addTask, taskById, autoAgents,
   projectOfPath */

const STATUS_DONE = 'done';

// The verify command for a task: its project's own, or the default one in Settings → Tasks.
function verifyCommandFor(t) {
  const project = cfg.projects.find((p) => p.path === t.cwd || p.path === projectOfPath(t.cwd || ''));
  return (project?.verify ?? '').trim() || (cfg.verifyCmd || '').trim();
}

const tail = (text, n) => text.split('\n').slice(-n).join('\n');

// An agent printed DONE or BLOCKED.
async function onTaskMarker(t, marker) {
  const cmd = marker.status === STATUS_DONE && !t.reviewOf ? verifyCommandFor(t) : '';
  if (!cmd) return finishTask(t, marker.status, marker.text);

  t.status = 'verifying'; t.summary = marker.text;
  save(); renderTasks();
  const r = await ab.flowExec(cmd, t.workdir || t.cwd);
  const result = r.ok ? r.value : { code: -1, out: r.error };
  if (result.code === 0) return finishTask(t, STATUS_DONE, `${marker.text} · checks passed`);

  t.checkFailures = (t.checkFailures || 0) + 1;
  const c = t.cardId && cardData(t.cardId);
  const lastLine = result.out.trim().split('\n').pop() || `exit code ${result.code}`;
  if (t.checkFailures > (cfg.verifyRetries ?? 2) || !c || !runtime.get(c.id)?.alive) {
    return finishTask(t, 'blocked', `Checks failed (${cmd}): ${lastLine}`.slice(0, 300));
  }
  toast(`Checks failed for <b>${esc(t.text.slice(0, 50))}</b>; sent back to its agent (try ${t.checkFailures}).`, 5000);
  startTaskAgain(t);
  await ab.ptyPaste(c.id, `The project's checks (\`${cmd}\`) failed after your change. Fix the cause, run them again, and end with a new «DONE: …» line.\n\n${tail(result.out, 60)}`);
}

// ---------- Cross-review ----------
function reviewPrompt(t) {
  const orig = taskById(t.reviewOf);
  const from = orig?.base || orig?.checkpoint;
  const how = from ? `git diff ${from} (run in ${orig.workdir || orig.cwd}; it includes uncommitted changes) and git status for new files` : 'git diff and git status';
  return `[AgentBoard task ${t.id}] Review, without editing any file, the changes another agent made for: "${orig?.text || ''}".\n`
    + `See them with: ${how}. Check that they do what was asked, look for bugs, missing cases and broken tests.\n`
    + 'End with exactly one line: «DONE: …» when it is right (say why in a few words), or «BLOCKED: …» listing the problems to fix, concrete and short.';
}

function startCrossReview(t) {
  const reviewer = autoAgents().find((k) => k !== t.assigned);
  if (!reviewer) return;
  addTask({ text: `Review: ${t.text}`, agent: reviewer, cwd: t.workdir || t.cwd, worktree: false, reviewOf: t.id, group: t.group, light: false });
  toast(`Cross-review of <b>${esc(t.text.slice(0, 50))}</b> queued for ${esc(cfg.agents[reviewer].label)}.`);
}

// The reviewer finished: approve the original task or send the problems back to it.
async function applyReview(review) {
  const t = taskById(review.reviewOf);
  if (!t) return;
  t.review = { by: cfg.agents[review.assigned]?.label || review.assigned, status: review.status, text: review.summary };
  if (review.status === STATUS_DONE) { save(); renderTasks(); return; }
  const c = t.cardId && cardData(t.cardId);
  if (c && runtime.get(c.id)?.alive) {
    startTaskAgain(t);
    await ab.ptyPaste(c.id, `A reviewer (${t.review.by}) found problems in your changes:\n${review.summary}\nFix them and end with a new «DONE: …» line.`);
  } else {
    t.status = 'review';
    save(); renderTasks();
  }
}

// Called by finishTask for every task.
function afterTaskFinished(t) {
  if (t.reviewOf) return applyReview(t);
  if (t.status === STATUS_DONE && cfg.crossReview && !t.review && !t.flowRun) startCrossReview(t);
}
