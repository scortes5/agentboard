// AgentBoard — a unified diff (git diff) as files and numbered lines, for the review dialog.
'use strict';

class UnifiedDiff {
  // → [{ path, status, lines: [{ kind: add|del|ctx|hunk|meta, text, oldNo, newNo }] }]
  static parse(text) {
    const files = [];
    let f = null, oldNo = 0, newNo = 0;
    for (const line of text.split('\n')) {
      if (line.startsWith('diff --git ')) {
        f = { path: line.replace(/^diff --git a\/(.+?) b\/.+$/, '$1'), status: 'modified', lines: [] };
        files.push(f);
      } else if (!f) continue;
      else if (line.startsWith('new file mode')) f.status = 'added';
      else if (line.startsWith('deleted file mode')) f.status = 'deleted';
      else if (line.startsWith('rename to ')) { f.path = line.slice(10); f.status = 'renamed'; }
      else if (line.startsWith('Binary files')) f.lines.push({ kind: 'meta', text: 'Binary file' });
      else if (line.startsWith('@@')) {
        const m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)/);
        if (m) { oldNo = +m[1]; newNo = +m[2]; }
        f.lines.push({ kind: 'hunk', text: line });
      } else if (/^(index |--- |\+\+\+ |similarity |rename from |old mode |new mode )/.test(line)) continue;
      else if (line.startsWith('+')) f.lines.push({ kind: 'add', text: line.slice(1), newNo: newNo++ });
      else if (line.startsWith('-')) f.lines.push({ kind: 'del', text: line.slice(1), oldNo: oldNo++ });
      else if (line.startsWith(' ')) f.lines.push({ kind: 'ctx', text: line.slice(1), oldNo: oldNo++, newNo: newNo++ });
    }
    return files;
  }

  static stats(file) {
    return { add: file.lines.filter((l) => l.kind === 'add').length, del: file.lines.filter((l) => l.kind === 'del').length };
  }
}
