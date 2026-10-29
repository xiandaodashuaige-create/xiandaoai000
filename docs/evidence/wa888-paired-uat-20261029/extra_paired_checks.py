import pathlib
p=pathlib.Path("C:/LULIAN-CODE/tmp/wa888-http-continuation-20261029")
source=(p/"verify_a3_paired.py").read_text()
prefix=source.split('check("normal-auth-project-rls"')[0].replace("a3-paired-http.json","a3-paired-negative-http.json")
exec(prefix)
P="/api/internal/meta/whatsapp-agent/"
check("agent-apply-without-confirmation",http(BASE+P+"scoped-agent-config",{"projectId":PROJECT,"action":"APPLY","token":"wa888-invalid-token","request_key":"wa888_negative_20261029","confirm":False},TOKEN),lambda s,b:s==400 and b.get("reason")=="INVALID_INPUT")
check("agent-foreign-project-write-denied",http(BASE+P+"scoped-agent-config",{"projectId":FOREIGN,"action":"APPLY","token":"wa888-invalid-token","request_key":"wa888_negative_20261029","confirm":True},TOKEN),lambda s,b:s==403 and b.get("reason")=="OWNER_REQUIRED")
check("agent-missing-receipt",http(BASE+P+"scoped-agent-config?projectId="+PROJECT+"&requestKey=wa888_missing_20261029",token=TOKEN),lambda s,b:s==404)
check("agent-no-customer-sessions-after-rejection",http(BASE+P+"scoped-agent-config?projectId="+PROJECT,token=TOKEN),lambda s,b:s==200 and b.get("sessions")==[] and b.get("groups")==[])
print("ADDITIONAL_PAIRED_PASS",len(results))
