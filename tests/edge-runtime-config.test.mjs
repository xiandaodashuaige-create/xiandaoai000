import test from "node:test";
import assert from "node:assert/strict";
import { resolveRuntimeConfig } from "../supabase/functions/video-agent-v0/runtime-config.mjs";
const resolve = (env) => resolveRuntimeConfig((name) => env[name]);
test("empty or incomplete environment fails closed", () => {
  for (const env of [{}, {SUPABASE_URL:"https://preview.supabase.co"}, {SUPABASE_ANON_KEY:"synthetic"}]) {
    const c=resolve(env); assert.equal(c.configured,false); assert.equal(c.cloudWorkerUrl,"");
  }
});
test("preview uses only its own database and key; worker is opt in", () => {
  const c=resolve({SUPABASE_URL:"https://preview.supabase.co",SUPABASE_ANON_KEY:"synthetic-anon"});
  assert.deepEqual(c,{configured:true,supabaseUrl:"https://preview.supabase.co",publicKey:"synthetic-anon",cloudWorkerUrl:""});
});
test("modern publishable key and explicit worker supported", () => {
  const c=resolve({SUPABASE_URL:"https://preview.supabase.co",SUPABASE_PUBLISHABLE_KEY:"synthetic-publishable",VIDEO_AGENT_CLOUD_WORKER_URL:"https://preview.example/api/video-worker"});
  assert.equal(c.configured,true); assert.equal(c.publicKey,"synthetic-publishable");
  assert.equal(c.cloudWorkerUrl,"https://preview.example/api/video-worker");
});
test("built in anon key wins over optional publishable fallback", () => {
  assert.equal(resolve({SUPABASE_URL:"https://preview.supabase.co",SUPABASE_ANON_KEY:"own-anon",SUPABASE_PUBLISHABLE_KEY:"other"}).publicKey,"own-anon");
});
test("invalid database or worker URLs fail before authenticated writes", () => {
  for (const bad of ["garbage","javascript:alert(1)","http://public.example","https://user:pass@example.com"]) {
    assert.equal(resolve({SUPABASE_URL:bad,SUPABASE_ANON_KEY:"synthetic"}).configured,false);
    assert.equal(resolve({SUPABASE_URL:"https://preview.supabase.co",SUPABASE_ANON_KEY:"synthetic",VIDEO_AGENT_CLOUD_WORKER_URL:bad}).configured,false);
  }
});
test("local Supabase development works without a hosted fallback", () => {
  for(const host of ["localhost","127.0.0.1","[::1]"]) assert.equal(resolve({SUPABASE_URL:"http://"+host+":54321",SUPABASE_ANON_KEY:"synthetic"}).configured,true);
});
