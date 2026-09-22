
const DIRRX=/\\b(?:north|south)[\\s-]?(?:east|west)\\b|\\b(?:north|south|east|west)(?:ern)?\\b/gi;
const dcanon=x=>x.toLowerCase().replace(/[\\s-]+/g,"").replace(/ern$/,"");
/* Check a batch of drafts and emit the Airtable payload.
   Usage: node save.mjs                      (reads drafts-batch.json)     */
import fs from 'node:fs';
import { TYPES } from '/home/user/tg-widgets/api/_lib/destination-coverage.js';
import { shapeCheck, styleBreaches } from '/home/user/tg-widgets/api/_lib/fill/_gate.js';
const SP='/tmp/claude-0/-home-user-tg-widgets/aa74082d-0375-5ea9-97e1-bfee8cc3073d/scratchpad';
const drafts = JSON.parse(fs.readFileSync(SP+'/drafts-batch.json','utf8'));
const src = Object.fromEntries(JSON.parse(fs.readFileSync(SP+'/batch.json','utf8')).map(b=>[b.iata,b]));
const field = TYPES.find(t=>t.key==='airport').fields.find(f=>f.label==='Overview');
const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ');
let bad = 0; const recs = [];
for (const [iata, text] of Object.entries(drafts)) {
  const b = src[iata];
  if (!b) { console.log(iata + '  NOT IN BATCH'); bad++; continue; }
  const shape = shapeCheck({ value:text, field, place:iata });
  const style = styleBreaches(text);
  const ev = norm(b.text);
  const names = [...new Set((text.match(/\b[A-ZÁ-Ú][a-zá-ú]+(?:\s+(?:[A-ZÁ-Ú][a-zá-ú]+|de|del|la|van|von))+\b/g)||[]))];
  const nums  = [...new Set((text.match(/\b\d[\d,\.]*\b/g)||[]).map(n=>n.replace(/[\.,]$/,'')))];
  const missN = names.filter(n => !ev.includes(norm(n)));
  const missD = nums.filter(n => { const bare=n.replace(/[^0-9]/g,''); return bare.length>=3 && !norm(b.text).replace(/[^0-9 ]/g,'').includes(bare) && !ev.includes(norm(n)); });
  const words = text.trim().split(/\s+/).length;
  const flag = !shape.ok || style.length || missN.length || missD.length;
  if (flag) bad++;
  console.log(iata.padEnd(5) + String(words).padStart(4) + 'w  ' +
    (shape.ok?'ok':'SHAPE:'+shape.why) + ' ' + (style.length?('STYLE:'+style.join(';')):'ok') +
    (missN.length?('  NAMES: '+missN.join(', ')):'') + (missD.length?('  NUMBERS: '+missD.join(', ')):''));
  const srcD=new Set((b.text.match(DIRRX)||[]).map(dcanon));
  const badD=[...new Set((text.match(DIRRX)||[]).map(dcanon))].filter(x=>!srcD.has(x));
  if(badD.length) console.log("      ^^ DIRECTION NOT IN SOURCE: "+badD.join(","));
  recs.push({ id:b.id, fields:{ fldmRELkLWrUGL5Ss:text } });
}
fs.writeFileSync(SP+'/payload.json', JSON.stringify(recs));
console.log('\n' + recs.length + ' records, ' + bad + ' needing a look. Payload written.');
