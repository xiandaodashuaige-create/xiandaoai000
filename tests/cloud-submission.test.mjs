import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import handler from '../api/video-worker.mjs';

test('remix render failure becomes a failed cloud job, never an offline local queue', async () => {
  const previousFetch=global.fetch; const previous={...process.env}; const calls=[];
  Object.assign(process.env,{VIDEO_AGENT_ACCESS:'test',SUPABASE_URL:'https://sb.example.com',SUPABASE_PUBLISHABLE_KEY:'test'});
  global.fetch=async(url,init)=>{
    const name=String(url).split('/').at(-1); const body=JSON.parse(init.body); calls.push({name,body});
    if(name==='video_agent_claim_cloud_job')return new Response(JSON.stringify({id:'fixture-remix-no-media',workflow_mode:'remix',brief:'无可用素材',input_files:[]}));
    if(name==='video_agent_worker_heartbeat'||name==='video_agent_worker_update')return new Response('{}');
    throw new Error('unexpected '+name);
  };
  const res={status(n){this.code=n;return this;},json(body){this.body=body;return this;}};
  try{
    await handler({method:'POST',headers:{'x-video-access':'test'}},res);
    assert.equal(res.body.ok,false); assert.equal(res.body.fallback,null);
    assert.ok(calls.some(x=>x.name==='video_agent_worker_update'&&x.body.p_status==='failed'));
    assert.ok(!calls.some(x=>x.name==='video_agent_cloud_fallback'));
  }finally{global.fetch=previousFetch; for(const k of Object.keys(process.env))if(!(k in previous))delete process.env[k]; Object.assign(process.env,previous);}
});

test('website blocks an empty remix before creating or uploading a job', async () => {
  const html=await readFile(new URL('../video/index.html',import.meta.url),'utf8');
  const submit=html.slice(html.indexOf("$('submitBtn').onclick"),html.indexOf('function aiInputFiles'));
  assert.match(submit,/selected\.some\(file=>\/\^\(video\|image\)\\\//);
  assert.ok(submit.indexOf('selected.some')<submit.indexOf("api('init_job'"));
});
