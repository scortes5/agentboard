#!/usr/bin/env node
// Installs AgentBoard as a desktop app, with its icon, so it opens with one click.
//   Mac:     builds AgentBoard.app and copies it to /Applications (or ~/Applications).
//   Windows: builds the installer (.exe) and opens it; it adds desktop and Start menu shortcuts.
//   Linux:   builds the .AppImage in dist/.
// Usage: npm run app
'use strict';
const { execFileSync, execSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const run = (cmd) => execSync(cmd, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } });

if (process.platform === 'darwin') {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  run(`npx electron-builder --mac --dir --${arch} --publish never`);
  const built = path.join(ROOT, 'dist', arch === 'arm64' ? 'mac-arm64' : 'mac', 'AgentBoard.app');
  if (!fs.existsSync(built)) { console.error('Not found:', built); process.exit(1); }

  let destDir = '/Applications';
  try { fs.accessSync(destDir, fs.constants.W_OK); } catch { destDir = path.join(os.homedir(), 'Applications'); fs.mkdirSync(destDir, { recursive: true }); }
  const dest = path.join(destDir, 'AgentBoard.app');
  try { execFileSync('osascript', ['-e', 'tell application "AgentBoard" to quit'], { stdio: 'ignore' }); } catch {}
  fs.rmSync(dest, { recursive: true, force: true });
  execFileSync('ditto', [built, dest]);
  // the app is unsigned: without this macOS blocks it the first time
  try { execFileSync('xattr', ['-cr', dest]); } catch {}
  console.log(`\n✓ AgentBoard installed in ${dest}`);
  console.log('  Open it from Launchpad, Spotlight (⌘ Space → AgentBoard) or Finder; drag it to the Dock to keep it handy.');
  if (!process.argv.includes('--no-open')) execFileSync('open', [dest]);
} else if (process.platform === 'win32') {
  run('npx electron-builder --win nsis --x64 --publish never');
  // AgentBoard-Setup-x.y.z.exe (AgentBoard Setup x.y.z.exe before 0.6)
  const exe = fs.readdirSync(path.join(ROOT, 'dist')).find((f) => /^AgentBoard[- ]Setup[- ][\d.]+\.exe$/.test(f));
  if (!exe) { console.error('Installer not found in dist/'); process.exit(1); }
  console.log(`\n✓ Installer ready: dist\\${exe}. Opening it…`);
  // started directly, not through cmd.exe, so the file name is never parsed as a command
  spawn(path.join(ROOT, 'dist', exe), [], { detached: true, stdio: 'ignore' }).unref();
} else {
  run('npx electron-builder --linux AppImage --publish never');
  const image = fs.readdirSync(path.join(ROOT, 'dist')).find((f) => f.endsWith('.AppImage'));
  console.log(`\n✓ Built dist/${image}. Run it with: ./dist/${image}`);
}
