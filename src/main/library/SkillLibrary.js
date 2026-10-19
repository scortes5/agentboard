// The CLIs' skills, commands and Claude subagents: listing them, copying a skill between
// CLIs, and creating, editing or deleting subagent files (deleted files go to the Trash).
'use strict';
const path = require('path');
const { shell } = require('electron');
const skills = require('./skills');
const { wrap } = require('../core/platform');

class SkillLibrary {
  constructor({ config }) {
    this.config = config;
  }

  projects() { return this.config.load().projects || []; }

  async saveAgent(a) {
    const r = skills.saveAgent(a, this.projects());
    if (r.replaced) await shell.trashItem(r.replaced);
    return r.file;
  }

  async deleteAgent(file) {
    if (!skills.isAgentFile(file, this.projects())) throw new Error('Invalid agent file.');
    await shell.trashItem(file);
    return true;
  }

  // Only files AgentBoard listed itself can be revealed.
  reveal(p) {
    const same = (x) => path.resolve(x) === path.resolve(p);
    if (skills.scanSkills(this.projects()).some((x) => same(x.path)) || skills.listAgents(this.projects()).some((x) => same(x.file))) shell.showItemInFolder(p);
  }

  register(ipcMain) {
    ipcMain.handle('skills:scan', () => skills.scanSkills(this.projects()));
    ipcMain.handle('skills:copy', wrap((_e, src, target) => skills.copySkill(src, target, this.projects())));
    ipcMain.handle('skills:reveal', (_e, p) => this.reveal(p));
    ipcMain.handle('agents:list', () => skills.listAgents(this.projects()));
    ipcMain.handle('agents:save', wrap((_e, a) => this.saveAgent(a)));
    ipcMain.handle('agents:delete', wrap((_e, file) => this.deleteAgent(file)));
  }
}

module.exports = { SkillLibrary };
