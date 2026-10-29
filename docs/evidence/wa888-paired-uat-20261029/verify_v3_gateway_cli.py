import json,pathlib,subprocess,hashlib
ROOT=pathlib.Path("C:/LULIAN-CODE/tmp/wa888-http-continuation-20261029");NPM=pathlib.Path("C:/Users/SENDO/AppData/Roaming/npm")
URL="https://xiandaoai000-j8jz72vep-xiandaodashuaige-creates-projects.vercel.app/api/a3-video-provider"
p=subprocess.run(["powershell.exe","-NoProfile","-Command","$s=Get-Content -Raw '"+str(ROOT/"v3-gateway-token.dpapi")+"';$x=ConvertTo-SecureString $s.Trim();[System.Net.NetworkCredential]::new('', $x).Password"],capture_output=True,text=True,check=True)
key=p.stdout.strip();assert len(key)>20
scope={"action":"provider_find_operation","tenant_id":"60852e80-7f69-4d18-a17e-c5b26dc2ef9e","project_id":"d744ba1d-8d62-4581-8d3c-78db9936e888","conversation_session_id":"95becbc1-080a-47a1-9ce5-5a44aa3886d7","correlation_id":"8acf87cb-e60f-420f-97c5-59b21d5ddc5f","idempotency_key":"vpr1_c344112e99173221f7311e8c8bb82c9f80bfe40bfd246ae6f0c64bef3b1748cb"}
checks=[]
def check(name,body,expected,predicate,token=key):
 payload=ROOT/"gateway-current-request.json";payload.write_text(json.dumps(body))
 config='header = "Content-Type: application/json"\n'
 if token:config+='header = "Authorization: Bearer '+token+'"\n'
 p=subprocess.run([str(NPM/"vercel.cmd"),"curl",URL,"--scope","team_6XmCCxMYh3TMB6CKEwqE6WMo","--","--config","-","--silent","--show-error","--max-time","35","--data-binary","@"+str(payload),"--write-out","WA888_HTTP=%{http_code}"],input=config,capture_output=True,text=True,encoding="utf-8",errors="replace",timeout=60)
 assert p.returncode==0,"CLI_TRANSPORT_FAILED:"+p.stderr.replace(key,"REDACTED")[-700:]
 raw,code=p.stdout.rsplit("WA888_HTTP=",1);status=int(code.strip());data=json.loads(raw)
 passed=status==expected and predicate(data)
 row={"name":name,"status":status,"pass":passed,"sha256":hashlib.sha256(raw.encode()).hexdigest(),"literalNull":data.get("job","ABSENT") is None}
 if isinstance(data.get("job"),dict):row["jobId"]=data["job"].get("id")
 checks.append(row);print(json.dumps(row),flush=True)
 (ROOT/"v3-gateway-readonly-cli.json").write_text(json.dumps({"source":"f4dcea49d7b4fd53b642361052bafdba9547d45a","url":URL,"transport":"authenticated vercel curl","checks":checks,"testOnly":True,"writes":0},indent=2))
 if not passed:print(json.dumps(data)[:500]);raise SystemExit(1)
same=lambda d:d.get("ok") is True and isinstance(d.get("job"),dict) and d["job"].get("id")=="0459dbbb-3347-428d-af4c-d18672d8ae81"
empty=lambda d:d.get("ok") is True and "job" in d and d["job"] is None
check("missing-gateway-auth",scope,401,lambda d:d.get("error")=="unauthorized",None)
check("wrong-gateway-auth",scope,401,lambda d:d.get("error")=="unauthorized","wa888-deliberate-wrong")
check("original-job-restored",scope,200,same)
check("unknown-key-literal-null",{**scope,"idempotency_key":"vpr1_"+"b"*64},200,empty)
for field in ["tenant_id","project_id","conversation_session_id","correlation_id"]:
 check("foreign-"+field,{**scope,field:"11111111-1111-4111-8111-111111111111"},200,empty)
check("malformed-key",{**scope,"idempotency_key":"bad"},400,lambda d:d.get("error")=="operation_lookup_invalid_scope")
check("repeat-read-same-job",scope,200,same)
print("GATEWAY_PASS",len(checks))


