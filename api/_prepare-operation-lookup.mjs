const ID = /^[^\s\u0000-\u001f\u007f]{1,128}$/u;
const KEY = /^vpr1_[a-f0-9]{64}$/u;
const SCOPE = ['tenant_id','project_id','conversation_session_id','correlation_id','idempotency_key'];
const STATES = new Set(['uploading','queued','processing','review','completed','failed','timed_out','cancelled']);
const MAX_BYTES = 256 * 1024;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function operationLookupScope(value) {
  if (!record(value) || !SCOPE.every(k => typeof value[k]==='string' && ID.test(value[k])) || !KEY.test(value.idempotency_key)) return null;
  return Object.fromEntries(SCOPE.map(k=>[k,value[k]]));
}
function projectJob(value,scope) {
  if(value===null) return null;
  if(!record(value) || typeof value.id!=='string' || !ID.test(value.id) || !STATES.has(value.status) ||
    !Number.isSafeInteger(value.version_number) || value.version_number<1 ||
    value.external_tenant_id!==scope.tenant_id || value.external_project_id!==scope.project_id ||
    value.conversation_session_id!==scope.conversation_session_id || value.correlation_id!==scope.correlation_id ||
    value.idempotency_key!==scope.idempotency_key || !Array.isArray(value.input_files) || !Array.isArray(value.output_files))
    throw new Error('operation_lookup_unavailable');
  const result={};
  const numeric = new Set(['progress','estimated_cost']);
  const required = new Set(['id','external_tenant_id','external_project_id','conversation_session_id','correlation_id','idempotency_key','status','version_number']);

  const fields=['id','external_tenant_id','external_project_id','conversation_session_id','correlation_id','idempotency_key',
    'status','version_number','progress','provider','model','estimated_cost','output_sha256','created_at','updated_at','accepted_at'];
  for(const k of fields) {
    const item=value[k];
    if(item===undefined || item===null) continue;
    if(!required.has(k)) {
      if(numeric.has(k)) {
        if(typeof item!=='number' || !Number.isFinite(item) || item<0) throw new Error('operation_lookup_unavailable');
      } else if(typeof item!=='string' || item.length>2048 ||
        (k==='output_sha256' && !/^[a-f0-9]{64}$/i.test(item))) throw new Error('operation_lookup_unavailable');
    }
    result[k]=item;
  }
  for(const k of ['input_files','output_files']){
    if(value[k].length>64) throw new Error('operation_lookup_unavailable');
    result[k]=value[k].map(file=>{
      if(!record(file)) throw new Error('operation_lookup_unavailable');
      const safe={};
      for(const name of ['name','path','type','role','size','sha256','bucket','width','height','duration_seconds']){
        if(file[name]!==undefined){
          if((typeof file[name]!=='string' && typeof file[name]!=='number') ||
            (typeof file[name]==='string' && file[name].length>2048) ||
            (typeof file[name]==='number' && (!Number.isFinite(file[name]) || file[name]<0)))
            throw new Error('operation_lookup_unavailable');
          safe[name]=file[name];
        }
      }
      if(typeof safe.path!=='string' || !safe.path) throw new Error('operation_lookup_unavailable');
      return safe;
    });
  }
  return result;
}
async function boundedJson(response) {
  if(!response.ok) throw new Error('operation_lookup_unavailable');
  const declared=Number(response.headers.get('content-length'));
  if(Number.isFinite(declared) && declared>MAX_BYTES) throw new Error('operation_lookup_unavailable');
  const reader=response.body?.getReader();
  if(!reader) throw new Error('operation_lookup_unavailable');
  const chunks=[];let size=0;
  try {
    while(true){
      const {done,value}=await reader.read();
      if(done) break;
      size+=value.byteLength;
      if(size>MAX_BYTES){ await reader.cancel(); throw new Error('operation_lookup_unavailable'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
export async function readPreparedOperation(config,input,options={}) {
  const scope=operationLookupScope(input);
  if(!scope) throw new Error('operation_lookup_invalid_scope');
  const controller=new AbortController();
  const timeout=Math.min(15000,Math.max(1,options.timeoutMs??15000));
  const timer=setTimeout(()=>controller.abort(),timeout);
  let deadline;
  const expired=new Promise((_,reject)=>{deadline=setTimeout(()=>reject(new Error('operation_lookup_unavailable')),timeout);});
  try {
    const read=(async()=>{
      const response=await (options.fetchImpl??fetch)(config.url,{
        method:'POST',signal:controller.signal,
        headers:{'Content-Type':'application/json',apikey:config.publishableKey,'x-video-access':config.access},
        body:JSON.stringify({action:'provider_find_operation',...scope}),
      });
      const body=await boundedJson(response);
      if(!record(body) || body.ok!==true || !Object.hasOwn(body,'job')) throw new Error('operation_lookup_unavailable');
      return {ok:true,job:projectJob(body.job,scope)};
    })();
    return await Promise.race([read,expired]);
  } catch { throw new Error('operation_lookup_unavailable'); }
  finally { clearTimeout(timer); clearTimeout(deadline); controller.abort(); }
}
