import fs from 'node:fs';
const files = ['src/tc.tc','src/checker.tc','src/parser.tc','src/lexer.tc'];
const re = /\bcat([2-6])/g;
for (const f of files) {
  const s = fs.readFileSync(f,'utf8');
  let n = 0;
  const out = s.replace(re, (m,p1)=>{ n++; return 'sb_cat'+p1; });
  if (n > 0) fs.writeFileSync(f, out);
  console.log(f, n, 'replacements');
}
