import json, pathlib, subprocess, urllib.request, urllib.error, hashlib, datetime
root=pathlib.Path(r"C:/LULIAN-CODE/tmp/wa888-http-continuation-20261029")
ps="$s=Get-Content -Raw '"+str(root/"access.dpapi")+"'; $s=$s.Trim() | ConvertTo-SecureString; $p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); try {[Runtime.InteropServices.Marshal]::PtrToStringBSTR($p)} finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p)}"
key=subprocess.check_output(["powershell","-NoProfile","-Command",ps],text=True).strip()
url="https://ugqqaixpligbancucwdd.supabase.co/functions/v1/video-agent-v0"
scope={"action":"provider_find_operation","tenant_id":"60852e80-7f69-4d18-a17e-c5b26dc2ef9e","project_id":"d744ba1d-8d62-4581-8d3c-78db9936e888","conversation_session_id":"95becbc1-080a-47a1-9ce5-5a44aa3886d7","correlation_id":"8acf87cb-e60f-420f-97c5-59b21d5ddc5f","idempotency_key":"vpr1_c344112e99173221f7311e8c8bb82c9f80bfe40bfd246ae6f0c64bef3b1748cb"}
results=[]
def run(name,body,expect,predicate,access=key,method="POST"):
 headers={"Content-Type":"application/json"}
 if access is not None: headers["x-video-access"]=access
 req=urllib.request.Request(url,data=json.dumps(body).encode() if method=="POST" else None,headers=headers,method=method)
 try:
  with urllib.request.urlopen(req,timeout=25) as r: status=r.status;raw=r.read()
 except urllib.error.HTTPError as e: status=e.code;raw=e.read()
 data=json.loads(raw)
 passed=status==expect and predicate(data)
 row={"name":name,"status":status,"expected":expect,"pass":passed,"response_sha256":hashlib.sha256(raw).hexdigest(),"job_is_literal_null":data.get("job","MISSING") is None}
 if isinstance(data.get("job"),dict): row["job_id"]=data["job"].get("id");row["job_status"]=data["job"].get("status")
 if "error" in data:row["error"]=data["error"]
 results.append(row)
 print(json.dumps(row),flush=True)
 return data
run("GET rejected",{},405,lambda d:d.get("error")=="method_not_allowed",method="GET")
run("missing auth",{"action":"auth"},401,lambda d:d.get("error")=="unauthorized",access=None)
run("wrong auth",{"action":"auth"},401,lambda d:d.get("error")=="unauthorized",access="wa888-deliberately-wrong")
run("Edge authenticated to own Postgres",{"action":"auth"},200,lambda d:d.get("ok") is True)
def same_job(d):
 j=d.get("job")
 return d.get("ok") is True and isinstance(j,dict) and j.get("id")=="0459dbbb-3347-428d-af4c-d18672d8ae81" and j.get("status")=="uploading" and all(j.get({"tenant_id":"external_tenant_id","project_id":"external_project_id"}.get(k,k))==v for k,v in scope.items() if k!="action")
run("original-key exact identity",scope,200,same_job)
run("missing key literal null",{**scope,"idempotency_key":"vpr1_"+"b"*64},200,lambda d:d.get("ok") is True and "job" in d and d["job"] is None)
for field in ("tenant_id","project_id","conversation_session_id","correlation_id"):
 run("foreign "+field,{**scope,field:"11111111-1111-4111-8111-111111111111"},200,lambda d:d.get("ok") is True and "job" in d and d["job"] is None)
run("malformed key rejected",{**scope,"idempotency_key":"bad"},400,lambda d:d.get("error")=="operation_lookup_invalid_scope")
run("repeat readonly recovery same identity",scope,200,same_job)
receipt={"scope":"HOSTED_EDGE_V2_READONLY_HTTP_SUBSET","time":datetime.datetime.now(datetime.timezone.utc).isoformat(),"source":"f4dcea49d7b4fd53b642361052bafdba9547d45a","project":"ugqqaixpligbancucwdd","edge_version":2,"checks":results,"passed":sum(x["pass"] for x in results),"total":len(results),"submission":"NOT_CALLED","customer_sends":0,"paid_provider_calls":0,"frontend_browser_uat":"NOT_RUN"}
(root/"edge-v2-http-readonly.json").write_text(json.dumps(receipt,ensure_ascii=False,indent=2),encoding="utf-8")
print(json.dumps({"passed":receipt["passed"],"total":receipt["total"]}),flush=True)
raise SystemExit(0 if all(x["pass"] for x in results) else 1)
