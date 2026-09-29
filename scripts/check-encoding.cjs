const fs = require('fs');
const path = require('path');
const { TextDecoder } = require('util');

const ROOT = process.cwd();
const decoder = new TextDecoder('utf-8', { fatal: true });
const SCAN_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.json', '.html', '.css', '.md', '.sql']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'android', '.firebase']);
const IGNORE_FILES = new Set(['utils/encodingFix.ts']);
const SUSPICIOUS = ['?쇱젙', '移댄뀒怨좊━', '寃뚯떆湲', '濡쒓렇', '硫붾え'];

const invalidUtf8 = [];
const utf8Bom = [];
const mojibake = [];

function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      walk(full);
      continue;
    }
    if (!SCAN_EXT.has(path.extname(name).toLowerCase())) continue;

    const buf = fs.readFileSync(full);
    const rel = path.relative(ROOT, full);
    const relPosix = rel.split(path.sep).join('/');

    if (IGNORE_FILES.has(relPosix)) {
      continue;
    }

    if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
      utf8Bom.push(rel);
    }

    let text;
    try {
      text = decoder.decode(buf);
    } catch {
      invalidUtf8.push(rel);
      continue;
    }

    for (const token of SUSPICIOUS) {
      if (text.includes(token)) {
        mojibake.push(`${rel} (contains "${token}")`);
        break;
      }
    }
  }
}

walk(ROOT);

if (invalidUtf8.length || utf8Bom.length || mojibake.length) {
  console.error('Encoding check failed.');
  if (invalidUtf8.length) {
    console.error('\nInvalid UTF-8 files:');
    invalidUtf8.forEach(file => console.error(`- ${file}`));
  }
  if (utf8Bom.length) {
    console.error('\nUTF-8 BOM files:');
    utf8Bom.forEach(file => console.error(`- ${file}`));
  }
  if (mojibake.length) {
    console.error('\nPotential mojibake patterns:');
    mojibake.forEach(file => console.error(`- ${file}`));
  }
  process.exit(1);
}

console.log('Encoding check passed.');
