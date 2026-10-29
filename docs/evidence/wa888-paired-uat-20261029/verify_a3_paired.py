import json,urllib.request,urllib.error,pathlib,subprocess,time
ROOT=pathlib.Path("C:/LULIAN-CODE/tmp/wa888-http-continuation-20261029")
BASE="https://lulian-ai-beauty-2k03eaost-xiandaodashuaige-creates-projects.vercel.app"
PROJECT="d744ba1d-8d62-4581-8d3c-78db9936e888"
FOREIGN="d744ba1d-8d62-4581-8d3c-78db9936e889"
def decrypt(name):
 p=subprocess.run(["powershell.exe","-NoProfile","-Command","$s=Get-Content -Raw '"+str(ROOT/name)+"'; $x=ConvertTo-SecureString $s; [System.Net.NetworkCredential]::new('', $x).Password"],capture_output=True,text=True,encoding="utf-8",check=True)
 return json.loads(p.stdout)
keys=decrypt("a3-keys.dpapi"); cred=decrypt("a3-identity.dpapi")
def http(url,body=None,token=None,apikey=None):
 headers={"Content-Type":"application/json","Origin":BASE}
 if token: headers["Authorization"]="Bearer "+token
 if apikey:headers["apikey"]=apikey
 req=urllib.request.Request(url,data=None if body is None else json.dumps(body).encode(),headers=headers)
 try:
  with urllib.request.urlopen(req,timeout=40) as r: status=r.status; raw=r.read()
 except urllib.error.HTTPError as e:status=e.code;raw=e.read()
 try: data=json.loads(raw)
 except: data={"nonJson":True,"bytes":len(raw)}
 return status,data
st,login=http(keys["url"]+"/auth/v1/token?grant_type=password",{"email":cred["email"],"password":cred["password"]},apikey=keys["public"])
assert st==200 and login["user"]["id"]==cred["userId"]
TOKEN=login["access_token"];results=[]
def check(name,got,predicate):
 status,body=got; passed=bool(predicate(status,body))
 row={"name":name,"httpStatus":status,"body":body,"pass":passed}
 results.append(row); print(name,status,"PASS" if passed else "FAIL",flush=True)
 (ROOT/"a3-paired-http.json").write_text(json.dumps({"frontendSha":"11ed9ecd8045e3b1a015fdf9bc59b241060e3cbf","backendSha":"9a47592a7043316e095a04eb00fcf8274c19f48c","baseUrl":BASE,"testOnly":True,"results":results},indent=2))
 if not passed: print(json.dumps(body)[:1000]);raise SystemExit(1)
P="/api/internal/meta/whatsapp-agent/"
check("normal-auth-project-rls",http(keys["url"]+"/rest/v1/projects?select=id,tenant_id",token=TOKEN,apikey=keys["public"]),lambda s,b:s==200 and len(b)==1 and b[0]["id"]==PROJECT)
check("unauthenticated-denied",http(BASE+P+"sessions?projectId="+PROJECT),lambda s,b:s==403)
check("foreign-project-denied",http(BASE+P+"sessions?projectId="+FOREIGN,token=TOKEN),lambda s,b:s==403)
check("unmapped-read-fails-closed",http(BASE+P+"sessions?projectId="+PROJECT,token=TOKEN),lambda s,b:s==409 and b.get("reason")=="A3_MAPPING_REQUIRED")
check("provision-requires-confirmation",http(BASE+P+"tenant-link",{"projectId":PROJECT,"action":"PROVISION","confirm":False},TOKEN),lambda s,b:s==400 and b.get("reason")=="CONFIRMATION_REQUIRED")
check("dedicated-provision",http(BASE+P+"tenant-link",{"projectId":PROJECT,"action":"PROVISION","confirm":True},TOKEN),lambda s,b:s==200 and b.get("state")=="CONNECTED")
check("same-scope-provision-idempotent",http(BASE+P+"tenant-link",{"projectId":PROJECT,"action":"PROVISION","confirm":True},TOKEN),lambda s,b:s==200 and b.get("state")=="CONNECTED")
check("bound-empty-sessions",http(BASE+P+"sessions?projectId="+PROJECT,token=TOKEN),lambda s,b:s==200 and b.get("sessions")==[])
for endpoint in ["scoped-agent-config","scoped-automations","reception","customer-quality","customers","sales-status"]:
 got=http(BASE+P+endpoint+"?projectId="+PROJECT,token=TOKEN)
 check("read-"+endpoint,got,lambda s,b:s==200)
check("foreign-provision-denied",http(BASE+P+"tenant-link",{"projectId":FOREIGN,"action":"PROVISION","confirm":True},TOKEN),lambda s,b:s==403)
print("PAIRED_HTTP_PASS",len(results))
