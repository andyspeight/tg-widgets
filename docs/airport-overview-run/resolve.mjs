/* Resolve Wikipedia articles for records whose wiki field is blank.
   Self-verifying: only accepts an article whose text carries the record's IATA code. */
import fs from 'node:fs';
import { wikipediaIntro } from '/home/user/tg-widgets/api/_lib/fill/_source.js';
const SP='/tmp/claude-0/-home-user-tg-widgets/aa74082d-0375-5ea9-97e1-bfee8cc3073d/scratchpad';
const DONE = new Set(JSON.parse(fs.readFileSync(SP+'/done.json','utf8')));
const left = JSON.parse(fs.readFileSync(SP+'/blank-overview.json','utf8'))
  .filter(r => !r.wiki && !DONE.has(r.id));
const UA='tg-widgets destination content (andy.speight@agendas.group)';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function search(q){
  const u='https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&origin=*'
        +'&list=search&srlimit=5&srsearch='+encodeURIComponent(q);
  const r=await fetch(u,{headers:{'User-Agent':UA}});
  if(!r.ok) return [];
  const j=await r.json();
  return ((j.query&&j.query.search)||[]).map(s=>s.title);
}

const out=[], failed=[];
for(const r of left){
  const queries=[];
  if(r.name) queries.push(r.name);
  if(r.iata) queries.push(r.iata+' airport IATA');
  let hit=null;
  for(const q of queries){
    const titles=await search(q); await sleep(180);
    for(const t of titles){
      const url='https://en.wikipedia.org/wiki/'+encodeURIComponent(t.replace(/ /g,'_'));
      const got=await wikipediaIntro(url).catch(()=>null); await sleep(180);
      if(!got||!got.ok||!got.text) continue;
      // verification: the article must carry this record's IATA code
      const rx=new RegExp('IATA[^A-Za-z0-9]{0,4}'+r.iata+'\\b');
      if(rx.test(got.text)){ hit={title:t,url,text:got.text}; break; }
    }
    if(hit) break;
  }
  if(hit){ out.push({id:r.id,iata:r.iata,name:r.name||hit.title,wiki:hit.url,text:hit.text});
           console.log('OK   '+r.iata.padEnd(5)+hit.title); }
  else   { failed.push(r); console.log('FAIL '+(r.iata||'----').padEnd(5)+(r.name||'(no name)')); }
}
fs.writeFileSync(SP+'/batch.json', JSON.stringify(out,null,1));
fs.writeFileSync(SP+'/resolve-failed.json', JSON.stringify(failed,null,1));
console.log('\nresolved '+out.length+' of '+left.length+', failed '+failed.length);
