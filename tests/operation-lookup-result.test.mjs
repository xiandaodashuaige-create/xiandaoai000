import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeOperationLookupResult } from "../supabase/functions/video-agent-v0/operation-lookup-result.mjs";
const actualRpcEmpty = JSON.parse(readFileSync(new URL("./fixtures/operation-lookup-null-composite.json", import.meta.url), "utf8"));
test("hosted PostgREST full-null composite is authoritative absence", () => {
  const before=structuredClone(actualRpcEmpty);
  assert.equal(normalizeOperationLookupResult(actualRpcEmpty),null);
  assert.deepEqual(actualRpcEmpty,before);
});
test("JSON null stays authoritative absence", () => assert.equal(normalizeOperationLookupResult(null),null));
test("a real operation is preserved with exact identity", () => {
  const row={...actualRpcEmpty,id:"11111111-1111-4111-8111-111111111111",status:"uploading",external_tenant_id:"synthetic"};
  assert.equal(normalizeOperationLookupResult(row),row);
});
test("partial all-null records never become authoritative absence", () => {
  for(const key of Object.keys(actualRpcEmpty)) {
    const partial={...actualRpcEmpty}; delete partial[key];
    assert.equal(normalizeOperationLookupResult(partial),partial);
  }
});
test("any non-null field prevents empty-row conversion", () => {
  for(const key of Object.keys(actualRpcEmpty)) {
    const malformed={...actualRpcEmpty,[key]:"unexpected"};
    assert.equal(normalizeOperationLookupResult(malformed),malformed);
  }
});
test("empty object, arrays and undefined stay malformed rather than unknown", () => {
  for(const value of [{},[],undefined,"",false,0]) assert.equal(normalizeOperationLookupResult(value),value);
});
test("future nullable columns can accompany a genuine missing row", () => {
  assert.equal(normalizeOperationLookupResult({...actualRpcEmpty,future_column:null}),null);
});
