// npm run check — revisa que git y los CLIs de agentes estén en el PATH de este computador.
const { execSync } = require('child_process');

const isWin = process.platform === 'win32';
const tools = [
  ['git', 'git --version'],
  ['claude', 'claude --version', 'npm i -g @anthropic-ai/claude-code   (o el instalador nativo de Claude Code)'],
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
    console.log(`  ✘ ${name.padEnd(7)} no encontrado${hint ? `  →  ${hint}` : ''}`);
  }
}
console.log(missing
  ? '\nLos que faltan aparecen atenuados en la app. Después de instalarlos, inicia sesión una vez en cada uno desde la terminal.\n'
  : '\nTodo listo. Corre: npm start\n');
