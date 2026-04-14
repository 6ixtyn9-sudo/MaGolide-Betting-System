const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 5000;
const HOST = '0.0.0.0';
const DOCS_DIR = path.join(__dirname, 'docs');

const files = fs.readdirSync(DOCS_DIR).filter(f => f.endsWith('.gs')).sort();

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildPage(activeFile) {
  const fileContent = activeFile
    ? fs.readFileSync(path.join(DOCS_DIR, activeFile), 'utf8')
    : '';

  const sidebar = files.map(f => {
    const active = f === activeFile ? ' class="active"' : '';
    const label = f.replace('.gs', '').replace(/_/g, ' ');
    return `<a href="/?file=${encodeURIComponent(f)}"${active}>${escapeHtml(label)}</a>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ma Golide Betting System</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #0d1117; color: #c9d1d9; height: 100vh; display: flex; flex-direction: column; }
    header {
      background: linear-gradient(135deg, #1a2233 0%, #0f1923 100%);
      border-bottom: 2px solid #f0a500;
      padding: 16px 24px;
      display: flex;
      align-items: center;
      gap: 16px;
    }
    header h1 { font-size: 1.4rem; color: #f0a500; letter-spacing: 1px; }
    header p { font-size: 0.85rem; color: #8b949e; }
    .badge {
      background: #f0a500;
      color: #0d1117;
      font-size: 0.7rem;
      font-weight: bold;
      padding: 3px 8px;
      border-radius: 12px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .layout { display: flex; flex: 1; overflow: hidden; }
    .sidebar {
      width: 240px;
      background: #161b22;
      border-right: 1px solid #30363d;
      overflow-y: auto;
      flex-shrink: 0;
      padding: 12px 0;
    }
    .sidebar h2 {
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      color: #8b949e;
      padding: 8px 16px 12px;
    }
    .sidebar a {
      display: block;
      padding: 9px 16px;
      color: #c9d1d9;
      text-decoration: none;
      font-size: 0.85rem;
      border-left: 3px solid transparent;
      transition: all 0.15s;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .sidebar a:hover { background: #21262d; color: #f0a500; border-left-color: #f0a500; }
    .sidebar a.active { background: #1c2836; color: #f0a500; border-left-color: #f0a500; font-weight: 600; }
    .main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
    .toolbar {
      background: #161b22;
      border-bottom: 1px solid #30363d;
      padding: 10px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 0.85rem;
      color: #8b949e;
      flex-shrink: 0;
    }
    .toolbar .filename { color: #e6edf3; font-weight: 600; font-family: monospace; font-size: 0.9rem; }
    .copy-btn {
      background: #21262d;
      border: 1px solid #30363d;
      color: #c9d1d9;
      padding: 5px 14px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.8rem;
      transition: all 0.15s;
    }
    .copy-btn:hover { background: #f0a500; color: #0d1117; border-color: #f0a500; }
    .code-area { flex: 1; overflow: auto; }
    pre {
      padding: 20px 24px;
      font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
      font-size: 0.82rem;
      line-height: 1.6;
      white-space: pre-wrap;
      word-break: break-word;
      color: #c9d1d9;
      min-height: 100%;
    }
    .welcome {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      color: #8b949e;
      gap: 12px;
      padding: 40px;
    }
    .welcome h2 { color: #f0a500; font-size: 1.5rem; }
    .welcome p { max-width: 480px; line-height: 1.6; }
    .stats { display: flex; gap: 24px; margin-top: 16px; }
    .stat { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 12px 20px; text-align: center; }
    .stat .num { font-size: 1.5rem; font-weight: bold; color: #f0a500; }
    .stat .label { font-size: 0.75rem; color: #8b949e; text-transform: uppercase; letter-spacing: 1px; }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>Ma Golide Betting System</h1>
      <p>Advanced sports betting prediction &amp; audit system</p>
    </div>
    <span class="badge">Google Apps Script</span>
  </header>
  <div class="layout">
    <nav class="sidebar">
      <h2>Modules</h2>
      ${sidebar}
    </nav>
    <div class="main">
      ${activeFile ? `
      <div class="toolbar">
        <span class="filename">${escapeHtml(activeFile)}</span>
        <button class="copy-btn" onclick="copyCode()">Copy Code</button>
      </div>
      <div class="code-area">
        <pre id="codeBlock">${escapeHtml(fileContent)}</pre>
      </div>
      ` : `
      <div class="welcome">
        <h2>Ma Golide Betting System</h2>
        <p>Select a module from the sidebar to view its Google Apps Script source code. These files are designed to be deployed in Google Sheets.</p>
        <div class="stats">
          <div class="stat">
            <div class="num">${files.length}</div>
            <div class="label">Modules</div>
          </div>
          <div class="stat">
            <div class="num">7</div>
            <div class="label">Phases</div>
          </div>
          <div class="stat">
            <div class="num">GAS</div>
            <div class="label">Platform</div>
          </div>
        </div>
      </div>
      `}
    </div>
  </div>
  <script>
    function copyCode() {
      const code = document.getElementById('codeBlock').innerText;
      navigator.clipboard.writeText(code).then(() => {
        const btn = document.querySelector('.copy-btn');
        btn.textContent = 'Copied!';
        setTimeout(() => btn.textContent = 'Copy Code', 2000);
      });
    }
  </script>
</body>
</html>`;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const file = url.searchParams.get('file');
  const safeFile = file && files.includes(file) ? file : null;

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(buildPage(safeFile));
});

server.listen(PORT, HOST, () => {
  console.log(`Ma Golide viewer running at http://${HOST}:${PORT}`);
});
