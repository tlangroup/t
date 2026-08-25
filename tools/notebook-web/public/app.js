'use strict';

const cellsEl = document.getElementById('cells');
const statusEl = document.getElementById('status');
const tpl = document.getElementById('cellTpl');

let cells = [];

// 内嵌示例：当通过预览代理/file:// 打开、连不到后端 /api/demo 时回退使用，
// 保证页面至少能渲染、编辑、加格（运行仍需真实后端 localhost:8787）。
const DEMO = {
  name: 'demo',
  cells: [
    { id: 'c1', kind: 'decl', source: 'sq fn(n: i64) i64 { return n * n; }' },
    { id: 'c2', kind: 'expr', display: 'int', source: 'sq(5)' },
    { id: 'c3', kind: 'expr', display: 'int', source: 'c2 + 100' },
    { id: 'c4', kind: 'stmt', source: 'print("notebook stage1 ok");' },
    { id: 'c5', kind: 'expr', display: 'str', source: '"tail cell (c5) rendered as string"' },
  ],
};

function newCell(src = '', kind = 'expr', display = 'int', id = null) {
  return { id: id || ('c' + Math.random().toString(36).slice(2, 7)), kind, display, source: src, _out: '' };
}

function status(msg, isErr) {
  statusEl.textContent = msg || '';
  statusEl.classList.toggle('err', !!isErr);
}

function showError(detail) {
  const b = document.getElementById('errbanner');
  b.textContent = detail || '';
  b.hidden = false;
}
function clearError() {
  const b = document.getElementById('errbanner');
  b.hidden = true;
}

function setOut(id, text, isErr) {
  const card = Array.from(cellsEl.children).find((c) => c.querySelector('.cid').textContent === id);
  if (!card) return;
  const out = card.querySelector('.cell-out');
  out.textContent = text;
  out.classList.toggle('err', !!isErr);
}

function render() {
  cellsEl.innerHTML = '';
  cells.forEach((cell, idx) => cellsEl.appendChild(cellNode(cell, idx)));
}

function cellNode(cell, idx) {
  const node = tpl.content.firstElementChild.cloneNode(true);
  node.querySelector('.cid').textContent = cell.id;

  const ta = node.querySelector('textarea');
  ta.value = cell.source;
  ta.addEventListener('input', () => (cell.source = ta.value));
  ta.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); doRun(); }
  });

  const kind = node.querySelector('.kind');
  kind.value = cell.kind;
  kind.addEventListener('change', () => (cell.kind = kind.value));

  const disp = node.querySelector('.disp');
  disp.value = cell.display;
  disp.addEventListener('change', () => (cell.display = disp.value));

  node.querySelector('.del').addEventListener('click', () => { cells.splice(idx, 1); render(); });
  node.querySelector('.runone').addEventListener('click', () => doRun());

  node.querySelector('.cell-out').textContent = cell._out || '';
  return node;
}

async function doRun() {
  if (!cells.length) { status('没有单元格', true); return; }
  const payload = {
    name: 'web',
    cells: cells.map((c) => ({ id: c.id, kind: c.kind, display: c.display, source: c.source })),
  };
  status('编译运行中…');
  try {
    const r = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await r.json();
    if (!data.ok) {
      clearError();
      for (const c of data.cells || []) setOut(c.id, '', false);
      showError((data.stage ? `[${data.stage}] ` : '') + (data.detail || 'unknown error'));
      status('失败：' + (data.stage || 'error'), true);
      return;
    }
    clearError();
    for (const c of data.cells) {
      const cell = cells.find((x) => x.id === c.id);
      const txt = c.kind === 'decl' ? (c.output || '✓ 已定义') : (c.output || '（无输出）');
      if (cell) cell._out = txt;
      setOut(c.id, txt, false);
    }
    status(data.cached ? '✓ 命中缓存' : '✓ 运行完成');
  } catch (e) {
    showError(String(e));
    status('请求失败：' + e, true);
  }
}

async function loadDemo() {
  status('载入示例中…');
  try {
    const r = await fetch('/api/demo');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const nb = await r.json();
    cells = (nb.cells || []).map((c) => newCell(c.source, c.kind || 'expr', c.display || 'int', c.id));
    render();
    status('已载入示例（服务端）');
  } catch (e) {
    // 离线/代理回退：用内嵌示例，至少能渲染与编辑（运行仍须真后端）
    cells = (DEMO.cells || []).map((c) => newCell(c.source, c.kind || 'expr', c.display || 'int', c.id));
    render();
    status('已载入内嵌示例（未连后端，运行将失败）', true);
  }
}

document.getElementById('runAll').addEventListener('click', doRun);
document.getElementById('addCell').addEventListener('click', () => { cells.push(newCell('', 'expr', 'int')); render(); });
document.getElementById('loadDemo').addEventListener('click', loadDemo);

loadDemo();
