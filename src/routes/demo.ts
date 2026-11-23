import { Hono } from 'hono';
import type { AppEnv } from '../types';

export const demo = new Hono<AppEnv>();

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>llm-scraper demo</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;color:#1a1a1a}
input,textarea,select{width:100%;box-sizing:border-box;font:13px ui-monospace,monospace;padding:10px;margin:6px 0 14px}
button{background:#1a1a1a;color:#fff;border:0;padding:10px 18px;cursor:pointer}pre{background:#f5f5f5;padding:14px;overflow:auto}</style>
</head><body>
<h1>llm-scraper demo</h1>
<p>Paste a public URL and an API key. Only public http(s) URLs are fetched; private IPs and reserved ranges are blocked.</p>
<label>API key</label><input id="key" type="password" placeholder="scr_...">
<label>URL</label><input id="url" value="https://example.com">
<label>Schema</label><select id="schema"><option>article</option><option>product</option><option>job_posting</option></select>
<button id="run">Scrape</button><pre id="out">Waiting…</pre>
<script>document.getElementById('run').onclick=async()=>{const out=document.getElementById('out');out.textContent='Working…';
try{const r=await fetch('/v1/scrape',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+document.getElementById('key').value},
body:JSON.stringify({url:document.getElementById('url').value,schema_id:document.getElementById('schema').value})});
const j=await r.json();out.textContent=r.ok?JSON.stringify(j.data,null,2)+'\\n\\n[strategy: '+j.strategy+', cached: '+j.cached+']':JSON.stringify(j.error||j,null,2)}catch(e){out.textContent=String(e)}};</script>
</body></html>`;

demo.get('/', (c) => c.html(PAGE));
