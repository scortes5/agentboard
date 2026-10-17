// Generate all platform icons from the same vector mark used in the header.
// Run with: node scripts/build-icons.js (sharp is available through geist).
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const assets = path.join(__dirname, '..', 'src', 'assets');

async function main() {
  const mark = fs.readFileSync(path.join(assets, 'logo.svg'), 'utf8')
    .replace(/<svg[^>]*>/, '').replace('</svg>', '');
  const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
    <defs>
      <linearGradient id="tile" x1="0" y1="0" x2="1" y2="1">
        <stop stop-color="#34281F"/><stop offset="1" stop-color="#16120F"/>
      </linearGradient>
      <linearGradient id="edge" x1="0" y1="0" x2="0" y2="1">
        <stop stop-color="#75604C"/><stop offset="1" stop-color="#2B211A"/>
      </linearGradient>
    </defs>
    <rect x="64" y="72" width="896" height="896" rx="208" fill="#090705" opacity=".2"/>
    <rect x="64" y="64" width="896" height="896" rx="208" fill="url(#tile)"/>
    <rect x="66" y="66" width="892" height="892" rx="206" fill="none" stroke="url(#edge)" stroke-width="4"/>
    <g transform="translate(128 116) scale(12)">${mark}</g>
  </svg>`;
  fs.writeFileSync(path.join(assets, 'icon.svg'), icon + '\n');
  const sizes = [16, 32, 48, 64, 128, 256, 512, 1024];
  const pngs = new Map(await Promise.all(sizes.map(async (size) => [size,
    await sharp(Buffer.from(icon)).resize(size, size).png().toBuffer(),
  ])));
  fs.writeFileSync(path.join(assets, 'icon.png'), pngs.get(1024));

  // ICO directory with PNG payloads supported by Windows Vista and later.
  const winSizes = [16, 32, 48, 64, 128, 256];
  const directory = Buffer.alloc(6 + winSizes.length * 16);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(winSizes.length, 4);
  let offset = directory.length;
  winSizes.forEach((size, i) => {
    const entry = 6 + i * 16;
    directory[entry] = directory[entry + 1] = size === 256 ? 0 : size;
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(pngs.get(size).length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += pngs.get(size).length;
  });
  fs.writeFileSync(path.join(assets, 'icon.ico'), Buffer.concat([directory, ...winSizes.map((s) => pngs.get(s))]));

  // ICNS PNG representations, including Retina sizes, without OS-specific tools.
  const types = { icp4: 16, icp5: 32, icp6: 64, ic07: 128, ic08: 256, ic09: 512, ic10: 1024,
    ic11: 32, ic12: 64, ic13: 256, ic14: 512 };
  const chunks = Object.entries(types).map(([type, size]) => {
    const header = Buffer.alloc(8);
    header.write(type);
    header.writeUInt32BE(8 + pngs.get(size).length, 4);
    return Buffer.concat([header, pngs.get(size)]);
  });
  const header = Buffer.alloc(8);
  header.write('icns');
  header.writeUInt32BE(8 + chunks.reduce((total, chunk) => total + chunk.length, 0), 4);
  fs.writeFileSync(path.join(assets, 'icon.icns'), Buffer.concat([header, ...chunks]));
  // Keep the desktop installer, window and notification-area icons in sync.
  const root = path.join(__dirname, '..');
  fs.mkdirSync(path.join(root, 'build'), { recursive: true });
  for (const file of ['icon.png', 'icon.ico', 'icon.icns']) {
    fs.copyFileSync(path.join(assets, file), path.join(root, 'build', file));
  }
  fs.writeFileSync(path.join(root, 'src', 'renderer', 'icon.png'), pngs.get(256));
  for (const [size, file] of [[22, 'tray.png'], [44, 'tray@2x.png']]) {
    await sharp(Buffer.from(icon)).resize(size, size).png().toFile(path.join(root, 'src', file));
  }
  console.log('Generated AgentBoard SVG, PNG, ICO and ICNS icons.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
