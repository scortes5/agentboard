// AgentBoard — task templates: to-dos you write often ("add an endpoint", "update a
// dependency"), inserted into the composer with one click. <placeholders> mark what to fill in.
'use strict';
/* global cfg, $, esc, save, toast, openPopover, closePopover, icon */

const DEFAULT_TEMPLATES = [
  { name: 'Add an endpoint', text: 'Add a <METHOD> <path> endpoint that <does what>. Validate the input, handle errors and add tests.' },
  { name: 'Fix a bug', text: 'Fix: <what happens> when <steps>. Expected: <what should happen>. Add a test that fails before the fix.' },
  { name: 'Write tests', text: 'Write tests for <module or file> covering the main cases and the edge cases. Do not change the code under test.' },
  { name: 'Update a dependency', text: 'Update <package> to the latest version, adapt the code to breaking changes and make sure the tests pass. !' },
  { name: 'Refactor', text: 'Refactor <module> to <goal> without changing its behavior; keep the tests green. !!' },
  { name: 'Review security', text: 'Review <area> for security problems (input validation, secrets, injection, permissions) and fix what you find.' },
];

const templates = () => cfg.templates || (cfg.templates = DEFAULT_TEMPLATES.map((t) => ({ ...t })));

function insertTemplate(text) {
  const input = $('#taskInput');
  input.value = input.value.trim() ? `${input.value.trimEnd()}\n${text}` : text;
  input.focus();
  // select the first placeholder so typing replaces it
  const start = input.value.length - text.length;
  const open = text.indexOf('<'), close = text.indexOf('>', open);
  if (open >= 0 && close > open) input.setSelectionRange(start + open, start + close + 1);
}

function openTemplates(anchor) {
  closePopover();
  const pop = document.createElement('div');
  pop.className = 'popover templates';
  const render = () => {
    pop.innerHTML = `${templates().map((t, i) => `<div class="tpl" data-i="${i}" title="${esc(t.text)}">
        <span class="tpl-name">${esc(t.name)}</span><button data-del="${i}" class="ghost" title="Delete this template">${icon('close', 12)}</button></div>`).join('')}
      <div class="row"><input name="tplName" placeholder="Name" /><button data-save title="Save the text in the composer as a template">Save Current Text</button></div>`;
  };
  render();
  openPopover(pop, anchor, 300);
  pop.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]')?.dataset.del;
    if (del != null) { templates().splice(+del, 1); save(); render(); return; }
    if (e.target.closest('[data-save]')) {
      const text = $('#taskInput').value.trim();
      const name = pop.querySelector('[name=tplName]').value.trim() || text.split(/\s+/).slice(0, 4).join(' ');
      if (!text) return toast('Write the template in the composer first.');
      templates().push({ name, text }); save(); render();
      return toast(`Template "${esc(name)}" saved.`);
    }
    const i = e.target.closest('.tpl')?.dataset.i;
    if (i != null) { insertTemplate(templates()[+i].text); closePopover(); }
  });
}

$('#taskTemplates').onclick = (e) => openTemplates(e.currentTarget);
