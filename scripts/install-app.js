#!/usr/bin/env node
// Instala AgentBoard como app de escritorio, con su ícono, para abrirla con un clic.
//   Mac:     construye AgentBoard.app y la copia a /Applications (o ~/Applications).
//   Windows: genera el instalador (.exe) y lo abre; crea acceso directo en el escritorio y el menú inicio.
// Uso: npm run app
'use strict';
const { execFileSync, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const run = (cmd) => execSync(cmd, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } });

if (process.platform === 'darwin') {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  run(`npx electron-builder --mac --dir --${arch} --publish never`);
  const built = path.join(ROOT, 'dist', arch === 'arm64' ? 'mac-arm64' : 'mac', 'AgentBoard.app');
  if (!fs.existsSync(built)) { console.error('No encontré', built); process.exit(1); }

  let destDir = '/Applications';
  try { fs.accessSync(destDir, fs.constants.W_OK); } catch { destDir = path.join(os.homedir(), 'Applications'); fs.mkdirSync(destDir, { recursive: true }); }
  const dest = path.join(destDir, 'AgentBoard.app');
  try { execFileSync('osascript', ['-e', 'tell application "AgentBoard" to quit'], { stdio: 'ignore' }); } catch {}
  fs.rmSync(dest, { recursive: true, force: true });
  execFileSync('ditto', [built, dest]);
  // la app no está firmada: sin esto macOS la bloquea la primera vez
  try { execFileSync('xattr', ['-cr', dest]); } catch {}
  console.log(`\n✓ AgentBoard instalada en ${dest}`);
  console.log('  Ábrela desde Launchpad, Spotlight (⌘ Espacio → AgentBoard) o el Finder; arrástrala al Dock para tenerla a mano.');
  if (!process.argv.includes('--no-open')) execFileSync('open', [dest]);
} else if (process.platform === 'win32') {
  run('npx electron-builder --win nsis --x64 --publish never');
  const exe = fs.readdirSync(path.join(ROOT, 'dist')).find((f) => /^AgentBoard Setup .*\.exe$/.test(f));
  if (!exe) { console.error('No encontré el instalador en dist/'); process.exit(1); }
  console.log(`\n✓ Instalador listo: dist\\${exe}. Abriéndolo…`);
  execFileSync(path.join(ROOT, 'dist', exe), [], { stdio: 'inherit', windowsHide: true });
} else {
  run('npx electron-builder --linux AppImage --publish never');
}
