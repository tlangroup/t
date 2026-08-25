// t Notebook — 测试网页服务（Stage 1 编排层的浏览器外壳）
//
// 复用 tools/notebook.mjs 的 runNotebookObject 作为编译/运行后端：
//   浏览器编辑 cell -> POST /api/run -> 服务端用真实 tc 编译成原生 exe -> 运行 ->
//   按 cell 切分 stdout 返回 -> 前端逐格渲染。tc 零改动。
//
// 路由：
//   GET  /           静态页（public/index.html）
//   GET  /api/demo   返回示例 notebook（examples/notebook/demo.nb.json）
//   POST /api/run    body: { name?, cells:[{id,kind,source,display}] }
//                     -> { ok, cached?, cells:[{id,kind,display,output}], ... }
//   GET  /style.css|/app.js  静态资源

import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runNotebookObject } from '../notebook.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');
const DEMO = path.resolve(__dirname, '../../examples/notebook/demo.nb.json');
const PORT = Number(process.env.PORT) || 8787;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function sendJson(res, obj, code = 200) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function sendFile(res, fp) {
  fs.readFile(fp, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);

  // 静态页 / 资源
  if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/index.html')) {
    return sendFile(res, path.join(PUBLIC, 'index.html'));
  }
  if (req.method === 'GET' && (u.pathname === '/style.css' || u.pathname === '/app.js')) {
    return sendFile(res, path.join(PUBLIC, u.pathname));
  }

  // 示例 notebook
  if (req.method === 'GET' && u.pathname === '/api/demo') {
    fs.readFile(DEMO, 'utf8', (err, data) => {
      if (err) return sendJson(res, { error: String(err) }, 500);
      try {
        return sendJson(res, JSON.parse(data));
      } catch (e) {
        return sendJson(res, { error: 'demo parse failed: ' + e }, 500);
      }
    });
    return;
  }

  // 编译运行
  if (req.method === 'POST' && u.pathname === '/api/run') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      try {
        const nb = JSON.parse(body || '{}');
        const r = await runNotebookObject({ name: nb.name || 'web', cells: Array.isArray(nb.cells) ? nb.cells : [] });
        return sendJson(res, r);
      } catch (e) {
        return sendJson(res, { ok: false, stage: 'server', detail: String(e && e.stack || e) }, 500);
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('not found');
});

server.listen(PORT, () => {
  console.log(`t notebook web  →  http://localhost:${PORT}`);
  console.log(`backend: tools/notebook.mjs (runNotebookObject), tc=${process.env.TC_BIN || 'out/dbg/tc.exe'}`);
});
