import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/a3-video-provider.mjs';
const scope = { tenant_id:'tenant-a', project_id:'project-a', conversation_session_id:'session-a',
  correlation_id:'correlation-a', idempotency_key:'vpr1_'+'a'.repeat(64) };
const job = () => ({ id:'job-a', ...scope, external_tenant_id:scope.tenant_id, external_project_id:scope.project_id,
  status:'uploading', version_number:1, input_files:[], output_files:[], brief:'PRIVATE_CUSTOMER_BRIEF', private_secret:'NEVER_RETURN' });
async function invoke(body, upstream) {
  const prior={ fetch:globalThis.fetch, env:{...process.env} }, calls=[];
  Object.assign(process.env,{A3_VIDEO_PROVIDER_TOKEN:'synthetic-a3-token',VIDEO_AGENT_ACCESS:'synthetic-v3-access',
    SUPABASE_PUBLISHABLE_KEY:'synthetic-publishable', SUPABASE_URL:'https://fixture.example.test'});
  globalThis.fetch=async(url,init)=>{ calls.push({url,body:JSON.parse(init.body),signal:init.signal}); return typeof upstream==='function'?upstream(url,init):new Response(JSON.stringify(upstream),{status:200}); };
  let status=200,payload;
  const res={status(v){status=v;return this;},setHeader(){return this;},json(v){payload=v;return this;},send(v){payload=JSON.parse(v);return this;}};
  try { await handler({method:'POST',headers:{authorization:'Bearer synthetic-a3-token'},body:{action:'provider_find_operation',...scope,...body}},res);
    return {status,payload,calls}; }
  finally { globalThis.fetch=prior.fetch; for(const k of Object.keys(process.env)) if(!(k in prior.env)) delete process.env[k]; Object.assign(process.env,prior.env); }
}
test('reads the original operation, projects only safe job fields and never sends a write',async()=>{
  const r=await invoke({}, {ok:true,job:job()});
  assert.equal(r.status,200);assert.equal(r.payload.job.id,'job-a');
  assert.equal(r.calls.length,1);assert.equal(r.calls[0].body.action,'provider_find_operation');
  assert.equal(r.calls[0].body.idempotency_key,scope.idempotency_key);
  assert.equal(JSON.stringify(r.payload).includes('PRIVATE_CUSTOMER_BRIEF'),false);
  assert.equal(JSON.stringify(r.payload).includes('NEVER_RETURN'),false);
  assert.ok(r.calls[0].signal);
});
test('an authoritative null is returned as unknown without preparing a replacement',async()=>{
  const r=await invoke({}, {ok:true,job:null});assert.equal(r.status,200);
  assert.deepEqual(r.payload,{ok:true,job:null});assert.equal(r.calls.length,1);
});
for(const key of ['external_tenant_id','external_project_id','conversation_session_id','correlation_id','idempotency_key']){
  test('rejects a foreign '+key+' without retry or write',async()=>{
    const r=await invoke({}, {ok:true,job:{...job(),[key]:'foreign'}});
    assert.equal(r.status,503);assert.equal(r.calls.length,1);
    assert.equal(r.payload.error,'operation_lookup_unavailable');
  });
}
for(const field of ['tenant_id','project_id','conversation_session_id','correlation_id','idempotency_key']){
  test('rejects malformed '+field+' before network',async()=>{
    const r=await invoke({[field]:' x '}, {ok:true,job:job()});
    assert.equal(r.status,400);assert.equal(r.calls.length,0);
  });
}
test('legacy raw keys cannot enter the private v1 lookup',async()=>{
  const r=await invoke({idempotency_key:'legacy-key'}, {ok:true,job:job()});
  assert.equal(r.status,400);assert.equal(r.calls.length,0);
});
test('wrong provider envelope remains unavailable rather than empty',async()=>{
  const r=await invoke({}, {ok:true});assert.equal(r.status,503);assert.equal(r.calls.length,1);
});
test('503 remains unknown with no retry or fallback write',async()=>{
  const r=await invoke({}, ()=>new Response('unavailable',{status:503}));
  assert.equal(r.status,503);assert.equal(r.calls.length,1);
});
test('oversize provider response is rejected',async()=>{
  const r=await invoke({}, ()=>new Response(' '.repeat(256*1024+1)));
  assert.equal(r.status,503);assert.equal(r.calls.length,1);
});
test('raw provider exceptions are not exposed',async()=>{
  const r=await invoke({}, ()=>{throw new Error('secret synthetic-upstream');});
  assert.equal(r.status,503);assert.equal(JSON.stringify(r.payload).includes('synthetic-upstream'),false);
});

for(const field of ['provider','model','estimated_cost','progress','output_sha256']){
  test('malformed optional '+field+' cannot expose nested provider data',async()=>{
    const r=await invoke({}, {ok:true,job:{...job(),[field]:{secret:'NEVER_RETURN'}}});
    assert.equal(r.status,503);assert.equal(JSON.stringify(r.payload).includes('NEVER_RETURN'),false);
  });
}
test('the total deadline includes a transport which ignores AbortSignal',async()=>{
  const {readPreparedOperation}=await import('../api/_prepare-operation-lookup.mjs');
  await assert.rejects(readPreparedOperation({url:'https://fixture.example.test',access:'synthetic',publishableKey:'synthetic'},scope,
    {timeoutMs:5,fetchImpl:()=>new Promise(()=>{})}),/operation_lookup_unavailable/);
});
test('the total deadline includes a stalled response body',async()=>{
  const {readPreparedOperation}=await import('../api/_prepare-operation-lookup.mjs');
  await assert.rejects(readPreparedOperation({url:'https://fixture.example.test',access:'synthetic',publishableKey:'synthetic'},scope,
    {timeoutMs:5,fetchImpl:async()=>new Response(new ReadableStream({start(){}}))}),/operation_lookup_unavailable/);
});
