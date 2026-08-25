import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const dir = resolve('perf/out');
const t = { '.html':'text/html; charset=utf-8', '.css':'text/css', '.jpg':'image/jpeg' };
const server = createServer(async (req,res)=>{
  try { const f = resolve(dir,(req.url||'/').split('?')[0].replace(/^\//,''));
        const b = await readFile(f);
        res.writeHead(200,{'Content-Type':t[extname(f)]||'application/octet-stream'}).end(b); }
  catch { res.writeHead(404).end(); }
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const port = server.address().port;
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
// Match the width of Andy's editor screenshot.
const p = await b.newPage({ viewport:{ width:1512, height:1130 }, deviceScaleFactor:1 });
p.on('console', ()=>{});
await p.goto(`http://127.0.0.1:${port}/live.html`, { waitUntil:'domcontentloaded' });
await p.waitForTimeout(600);
const m = await p.evaluate(() => {
  const page = document.querySelector('.tgs-page');
  const hero = document.querySelector('.tgs-section[data-motion]');
  const h = hero && hero.querySelector('.tgs-heading, h1, h2, h3');
  const cs = h ? getComputedStyle(h) : null;
  return {
    pageWidth: page ? Math.round(page.getBoundingClientRect().width) : null,
    heroHeight: hero ? Math.round(hero.getBoundingClientRect().height) : null,
    headingTag: h ? h.tagName.toLowerCase() : null,
    headingText: h ? h.textContent.trim().slice(0,60) : null,
    fontSize: cs ? cs.fontSize : null,
    lineHeight: cs ? cs.lineHeight : null,
    headingWidth: h ? Math.round(h.getBoundingClientRect().width) : null,
    headingHeight: h ? Math.round(h.getBoundingClientRect().height) : null,
    headingClass: h ? h.className : null,
    textWrap: cs ? (cs.textWrap || cs.textWrapStyle || 'n/a') : null,
    maxWidth: cs ? cs.maxWidth : null,
    colAlign: (() => { const c = hero && hero.querySelector('.tgs-col'); return c ? c.getAttribute('data-align') : null; })(),
    innerHeight: (() => { const i = hero && hero.querySelector('.tgs-section__inner'); return i ? Math.round(i.getBoundingClientRect().height) : null; })(),
  };
});
console.log(JSON.stringify(m, null, 2));
console.log('lines (height / line-height):', m.headingHeight && parseFloat(m.lineHeight) ? (m.headingHeight/parseFloat(m.lineHeight)).toFixed(2) : 'n/a');
await p.screenshot({ path:'perf/out/live-top.png', clip:{x:0,y:0,width:1512,height:1130} });
await b.close(); server.close();
