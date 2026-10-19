// AgentBoard — what happens between "the agent says it is done" and "the task is done".
// Steps are registered with taskPipeline.use(); each one may:
//   prompt(task)            → a different instruction for this kind of task (or nothing)
//   onMarker(task, marker)  → take over a DONE/BLOCKED (returns true) and finish it later
//   afterFinish(task)       → react once the task is finished
// A new step is a new class; the task queue does not change.
'use strict';
/* global finishTask */

class TaskPipeline {
  constructor() {
    this.steps = [];
  }

  use(step) {
    this.steps.push(step);
    return step;
  }

  prompt(t) {
    for (const s of this.steps) {
      const p = s.prompt?.(t);
      if (p) return p;
    }
    return null;
  }

  async onMarker(t, marker) {
    for (const s of this.steps) if (await s.onMarker?.(t, marker)) return;
    finishTask(t, marker.status, marker.text);
  }

  afterFinish(t) {
    for (const s of this.steps) s.afterFinish?.(t);
  }
}

const taskPipeline = new TaskPipeline();
