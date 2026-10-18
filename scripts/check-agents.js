// npm run check — verifies that git and the agent CLIs are on this computer's PATH.
const { execSync } = require('child_process');

const isWin = process.platform === 'win32';
const tools = [
  ['git', 'git --version'],
  ['claude', 'claude --version', 'npm i -g @anthropic-ai/claude-code   (or the native Claude Code installer)'],
  ['codex', 'codex --version', 'npm i -g @openai/codex'],
  ['gemini', 'gemini --version', 'npm i -g @google/gemini-cli'],
];

console.log(`\nAgentBoard · ${process.platform}\n`);
let missing = 0;
for (const [name, cmd, hint] of tools) {
  try {
    const shellCmd = isWin ? cmd : `${process.env.SHELL || '/bin/zsh'} -lc "${cmd}"`;
    const v = execSync(shellCmd, { stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 }).toString().trim().split('\n')[0];
    console.log(`  ✔ ${name.padEnd(7)} ${v}`);
  } catch {
    missing++;
    console.log(`  ✘ ${name.padEnd(7)} not found${hint ? `  →  ${hint}` : ''}`);
  }
}
console.log(missing
  ? '\nMissing ones appear dimmed in the app. After installing them, sign in once to each one from a terminal.\n'
  : '\nTodo listo. Corre: npm start\n');
