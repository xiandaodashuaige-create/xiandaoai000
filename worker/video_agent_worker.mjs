
import fs from 'node:fs';
import path from 'node:path';
import {spawn, spawnSync} from 'node:child_process';

const SB='https://ejspsxjeelhsevldmnhl.supabase.co';
const KEY='sb_publishable_41p3q4WMtJH85KjAPu06fw_JY3UO8XQ';
const ACCESS=process.env.VIDEO_AGENT_ACCESS;
if (!ACCESS || ACCESS.length < 32) {
  throw new Error('VIDEO_AGENT_ACCESS must be configured with a strong token');
}
const WORKER='CREAT16-VIDEO-V0';
const ROOT=String.raw`D:\Users\SENDO\Desktop\ad-video\ad-template-video`;
const FACTORY=String.raw`D:\LULIAN_VIDEO_FACTORY_V0`;
const LOG=path.join(FACTORY,'logs','video_agent_worker.log');

const h={'apikey':KEY,'Authorization':'Bearer '+KEY,'Content-Type':'application/json'};
function log(...a){const s=new Date().toISOString()+' '+a.map(v=>typeof v==='string'?v:JSON.stringify(v)).join(' ');fs.appendFileSync(LOG,s+'\n');console.log(s);}
async function rpc(name,body){
  const r=await fetch(SB+'/rest/v1/rpc/'+name,{method:'POST',headers:h,body:JSON.stringify(body)});
  const t=await r.text(); if(!r.ok) throw new Error(name+' '+r.status+' '+t);
  if(!t)return null; const x=JSON.parse(t); return Array.isArray(x)&&x.length===1?x[0]:x;
}
const enc=p=>p.split('/').map(encodeURIComponent).join('/');
async function dl(bucket,p,out){
  const r=await fetch(SB+'/storage/v1/object/'+bucket+'/'+enc(p),{headers:{apikey:KEY,Authorization:'Bearer '+KEY}});
  if(!r.ok)throw new Error('download '+r.status+' '+await r.text());
  fs.writeFileSync(out,Buffer.from(await r.arrayBuffer()));
}
async function ul(bucket,p,file,mime='video/mp4'){
  const r=await fetch(SB+'/storage/v1/object/'+bucket+'/'+enc(p),{method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+KEY,'Content-Type':mime},body:fs.readFileSync(file)});
  if(!r.ok)throw new Error('upload '+r.status+' '+await r.text());
}
async function hb(id,stage,progress){try{await rpc('video_agent_worker_heartbeat',{p_access:ACCESS,p_job_id:id,p_worker_id:WORKER,p_stage:stage,p_progress:progress});}catch(e){log('heartbeat_error',String(e));}}
async function upd(id,o){return rpc('video_agent_worker_update',{p_access:ACCESS,p_job_id:id,p_status:o.status??null,p_progress:o.progress??null,p_stage:o.stage??null,p_output_files:o.output_files??null,p_error_message:o.error_message??null});}
function safe(s){return String(s||'file').replace(/[^a-zA-Z0-9._-]/g,'_').slice(-100)||'file';}
function dur(f){const r=spawnSync('ffprobe',['-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',f],{encoding:'utf8'});const n=+String(r.stdout).trim();return n>2?n:30;}
function run(cmd,args,cwd,onData){return new Promise((res,rej)=>{const p=spawn(cmd,args,{cwd,windowsHide:true});let all='';const take=d=>{const s=d.toString();all+=s;onData?.(s)};p.stdout.on('data',take);p.stderr.on('data',take);p.on('error',rej);p.on('close',c=>c===0?res(all):rej(new Error(cmd+' exit '+c+'\n'+all.slice(-4000))));});}
function day(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}

function revisionRules(job){
  const prompt=String(job.revision_prompt||'');
  const scope=String(job.revision_scope||'auto').toLowerCase();
  const ver=Number(job.version_number||1);
  const has=(re)=>re.test(prompt);
  return {
    scope,prompt,ver,
    changeHook:scope==='hook'||scope==='redo'||has(/開頭|开头|hook|前三秒|頭三秒/i),
    changeMaterial:scope==='material'||scope==='redo'||has(/素材|畫面|画面|真實|真实|AI感|場景|场景/i),
    changeVoice:scope==='voice'||has(/聲音|声音|配音|男聲|男声|女聲|女声/i),
    reduceSubs:scope==='subtitle'||has(/字幕.*(少|減|减)|減少字幕|减少字幕|字幕太多/i),
    faster:scope==='pace'||has(/節奏|节奏|快一點|快一点|壓縮|压缩|短啲|20秒/i),
    changeCta:scope==='cta'||has(/CTA|結尾|结尾|WhatsApp|行動引導|行动引导/i),
    redo:scope==='redo'||has(/全部重做|重新做|完全不同/i)
  };
}

function inferIntent(job){
  const text=[job.brief||'',job.revision_prompt||''].join(' ');
  const rules=[
    {type:'massage',re:/(按摩|推拿|肩頸|肩颈|足療|足疗|SPA|spa|放鬆|放松|頭療|头疗|按摩體驗|按摩体验)/i},
    {type:'smp',re:/(SMP|紋髮|纹发|髮際線|发际线|頭皮紋|头皮纹|半永久紋髮|半永久纹发)/i},
    {type:'nail',re:/(美甲|甲油|gel甲|Gel甲)/i},
    {type:'lash',re:/(美睫|睫毛|植睫|嫁接睫毛)/i},
    {type:'facial',re:/(美容護理|美容护理|Facial|facial|皮膚管理|皮肤管理|面部護理|面部护理)/i},
    {type:'hair',re:/(美髮|美发|髮型|发型|染髮|染发|剪髮|剪发)/i},
    {type:'ad_service',re:/(AI.{0,4}(廣告|广告)|(廣告|广告).{0,4}AI|廣告代投|广告代投|Meta.{0,4}代投|投放合作|鹿聯|鹿联|廣告員工|广告员工)/i}
  ];
  for(const x of rules) if(x.re.test(text)) return x.type;
  return 'generic_service';
}

function intentCopy(type,variant=1){
  const sets={
    massage:{
      hooks:[
        ['返工坐到成個人硬晒？\n不如俾自己鬆一鬆','返工坐得耐，成個人都繃緊？不如俾自己一個時間，真正放鬆一下。'],
        ['攰咗成個星期？\n放工後俾自己鬆一鬆','攰咗成個星期，放工之後不如俾自己鬆一鬆，舒服返啲。'],
        ['想真正放鬆一下？\n約個時間嚟體驗','想真正放鬆一下？約個時間嚟試下按摩體驗。']
      ],
      cards:['返工坐得耐','成日覺得繃緊','想放鬆但冇時間'],
      middleText:'按摩放鬆體驗\n俾自己一段休息時間',
      middleVo:'由環境到手法，都係想你可以停一停，舒服咁放鬆一下。',
      msgs:['你好，想問下按摩體驗','今晚或者星期六有冇位？'],
      chatVo:'想試嘅話，可以直接WhatsApp問時間同預約。',
      ctaText:'預約按摩體驗\nWhatsApp 約時間',
      ctaVo:'想放鬆一下？WhatsApp問我哋今日有冇位，約個時間嚟體驗。'
    },
    smp:{
      hooks:[
        ['髮際線睇落稀疏？\n可以先了解SMP','如果你覺得髮際線睇落比較稀疏，可以先了解下SMP紋髮係點做。'],
        ['想髮際線睇落完整啲？\n先睇下SMP效果','想髮際線睇落完整啲？可以先睇下SMP紋髮嘅實際效果。'],
        ['SMP紋髮係點做？\n先睇真實過程','SMP紋髮究竟係點做？先睇下真實操作過程。']
      ],
      cards:['先了解適唔適合自己','睇清楚操作過程','再決定要唔要預約'],
      middleText:'SMP 專業操作\n按需要設計效果',
      middleVo:'會先了解你想改善嘅位置，再按實際情況設計適合嘅效果。',
      msgs:['你好，想了解SMP紋髮','可唔可以先預約諮詢？'],
      chatVo:'想了解自己適唔適合，可以直接WhatsApp預約諮詢。',
      ctaText:'SMP 紋髮諮詢\nWhatsApp 預約',
      ctaVo:'想了解多啲SMP紋髮，可以WhatsApp我哋預約諮詢。'
    },
    nail:{
      hooks:[['今次想轉個新款？\n預約美甲時間','今次想轉個新款？可以先WhatsApp約個時間嚟做美甲。']],
      cards:['揀款式','揀時間','到店做甲'],
      middleText:'美甲預約\n按你喜歡嘅風格做',
      middleVo:'可以先講你鍾意嘅款式同感覺，再幫你安排時間。',
      msgs:['想問下今個星期美甲有冇位？','我想做簡約款'],
      chatVo:'想做嘅話，WhatsApp我哋揀時間就可以。',
      ctaText:'預約美甲\nWhatsApp 約時間',
      ctaVo:'想整新款美甲？WhatsApp我哋約時間。'
    },
    lash:{
      hooks:[['想對眼更有精神？\n預約美睫體驗','想對眼睇落更有精神？可以約時間嚟做美睫。']],
      cards:['揀自然或濃密','按眼型設計','預約到店'],
      middleText:'美睫設計\n按你想要嘅效果做',
      middleVo:'可以按你眼型同想要嘅感覺，揀自然或者濃密效果。',
      msgs:['想問下植睫有咩款？','星期六有冇位？'],
      chatVo:'想試嘅話，WhatsApp我哋約時間。',
      ctaText:'預約美睫\nWhatsApp 約時間',
      ctaVo:'想試美睫？WhatsApp問我哋時間。'
    },
    facial:{
      hooks:[['想俾塊面好好休息？\n約個護理時間','想俾自己同皮膚休息一下？可以約個時間嚟做護理。']],
      cards:['先了解皮膚需要','揀合適護理','預約到店'],
      middleText:'美容護理體驗\n按需要安排',
      middleVo:'會先了解你嘅需要，再安排適合嘅美容護理。',
      msgs:['想問下有咩面部護理？','今個星期有冇位？'],
      chatVo:'想了解療程，可以直接WhatsApp問我哋。',
      ctaText:'預約美容護理\nWhatsApp 約時間',
      ctaVo:'想試美容護理？WhatsApp約個時間嚟體驗。'
    },
    hair:{
      hooks:[['想轉個新髮型？\n先約個時間','想轉個新髮型？可以先WhatsApp約個時間。']],
      cards:['講你想要嘅感覺','按髮況溝通','預約到店'],
      middleText:'髮型服務\n先溝通再設計',
      middleVo:'可以先講你想要嘅效果，再按實際髮況溝通。',
      msgs:['想問下今個星期有冇位？','我想轉個新髮型'],
      chatVo:'想預約可以直接WhatsApp問時間。',
      ctaText:'預約髮型服務\nWhatsApp 約時間',
      ctaVo:'想轉髮型？WhatsApp我哋約時間。'
    },
    generic_service:{
      hooks:[
        ['想試下呢個療程？\n先了解再預約','想試下呢個療程？可以先了解清楚，再決定幾時嚟體驗。'],
        ['想知呢個項目啱唔啱你？\n先睇真實過程','想知呢個項目啱唔啱你？先睇下真實過程，再慢慢決定。']
      ],
      cards:['先了解項目','睇真實過程','再預約到店'],
      middleText:'真實服務過程\n按需要安排體驗',
      middleVo:'先了解服務內容同實際過程，再按你嘅需要安排體驗。',
      msgs:['你好，想了解下呢個項目','想問下今個星期有冇位？'],
      chatVo:'有興趣可以直接WhatsApp了解同預約。',
      ctaText:'預約到店體驗\nWhatsApp 約時間',
      ctaVo:'想了解或者預約體驗，WhatsApp我哋約時間。'
    },
    ad_service:{
      hooks:[
        ['有手勢\n都唔代表有新客','間舖冇新客，好多時唔係你手勢唔好。'],
        ['有舖有手勢\n但日日都靜雞雞？','有舖、有手勢，但日日開門都靜雞雞？'],
        ['唔使日日拍片\n都要有人睇到你','唔使你日日拍片，重點係要俾同區真正有興趣嘅客人睇到你。']
      ],
      cards:['客人未睇明你做咩療程','唔知你喺邊區','唔知點預約'],
      middleText:'香港美業｜同區新客\nWhatsApp 即問',
      middleVo:'鹿聯AI廣告員工會幫你整理賣點，再投俾同區真正有興趣嘅客人睇。',
      msgs:['你好，想問下你哋個療程','我住附近，想約時間'],
      chatVo:'睇到廣告嘅客人，可以直接WhatsApp問你同預約。',
      ctaText:'香港美容院廣告合作\n先做廣告體檢',
      ctaVo:'想知你間舖廣告卡喺邊？WhatsApp我哋，先幫你做廣告體檢。'
    }
  };
  const c=sets[type]||sets.generic_service;
  const hook=c.hooks[(variant-1)%c.hooks.length];
  return {...c,hook};
}

function scenes(rel,d,v,job){
  const r=revisionRules(job);
  const intent=inferIntent(job);
  const shift=(r.changeMaterial||r.redo)?Math.min(.12,.035*Math.max(1,r.ver-1)):0;
  const st=[.03,.22,.42,.61,.78].map((x,i)=>Math.max(0,Math.min(d-1,d*((x+shift+(i%2?shift/2:0))%0.92))));
  const copy=intentCopy(intent,(r.changeHook||r.redo)?Math.max(1,r.ver):v);
  const bg=(i,style='full')=>({file:rel,start:+st[i].toFixed(2),style});
  const secs=r.faster?[2.6,4.0,4.8,4.5,4.0]:[3,5,6,6,5];

  let out;
  if(intent==='ad_service'){
    out=[
      {template:'big_text_hook',seconds:secs[0],text:copy.hook[0],vo:copy.hook[1],background:bg(0)},
      {template:'pain_cards',seconds:secs[1],cards:copy.cards,vo:'好多時問題唔係服務，而係客人未睇明你做咩、唔知你喺邊區、亦唔知點預約。',background:bg(1)},
      {template:'ad_launch',seconds:secs[2],ad_preview_text:copy.middleText,vo:copy.middleVo,background:bg(2)},
      {template:'whatsapp_chat',seconds:secs[3],messages:copy.msgs,vo:copy.chatVo,background:bg(3,'blur')},
      {template:'cta_offer',seconds:secs[4],text:copy.ctaText,button:'WhatsApp 了解',vo:copy.ctaVo,background:bg(4)}
    ];
  }else{
    out=[
      {template:'big_text_hook',seconds:secs[0],text:copy.hook[0],vo:copy.hook[1],background:bg(0)},
      {template:'pain_cards',seconds:secs[1],cards:copy.cards,vo:copy.cards.join('、')+'。',background:bg(1)},
      {template:'big_text_hook',seconds:secs[2],text:copy.middleText,vo:copy.middleVo,background:bg(2)},
      {template:'whatsapp_chat',seconds:secs[3],messages:copy.msgs,vo:copy.chatVo,background:bg(3,'blur')},
      {template:'cta_offer',seconds:secs[4],text:copy.ctaText,button:'WhatsApp 預約',vo:copy.ctaVo,background:bg(4)}
    ];
  }
  if(r.reduceSubs){
    out[0].show_subtitle=false;
    out[2].show_subtitle=false;
    out[4].show_subtitle=false;
  }
  return out;
}

function isEnglish(job){return /(?:语言|語言|语言声音|語言聲音)\s*[：:]\s*English|natural human pace/i.test(String(job.brief||''));}
function englishScenes(rel,d,v,job){
  const r=revisionRules(job);
  const st=[.03,.22,.42,.61,.78].map(x=>Math.max(0,Math.min(d-1,d*x)));
  const bg=(i,style='full')=>({file:rel,start:+st[i].toFixed(2),style});
  const secs=r.faster?[2.6,4,4.8,4.5,4]:[3,5,6,6,5];
  const business=(String(job.brief||'').match(/业务类型[：:]([^\n]+)/)?.[1]||'this service').trim();
  return [
    {template:'big_text_hook',seconds:secs[0],text:'Ready for a real change?',vo:'Ready to see what '+business+' can do for you?',background:bg(0)},
    {template:'pain_cards',seconds:secs[1],cards:['See the real process','Understand the value','Choose with confidence'],vo:'See the real process, understand the value, and choose with confidence.',background:bg(1)},
    {template:'big_text_hook',seconds:secs[2],text:'Real process\nReal customer proof',vo:'Here is the real customer process, so you can see exactly what to expect.',background:bg(2)},
    {template:'whatsapp_chat',seconds:secs[3],messages:['Hi, I would like to learn more.','Can I book a time?'],vo:'Have a question? Message us directly on WhatsApp.',background:bg(3,'blur')},
    {template:'cta_offer',seconds:secs[4],text:'Ready to get started?',button:'WhatsApp us now',vo:'Ready to get started? WhatsApp us now to learn more or book your place.',background:bg(4)}
  ];
}
function board(job,rel,d){
  const n=job.output_count===3?3:1;
  const r=revisionRules(job);
  const intent=inferIntent(job);
  const english=isEnglish(job);
  let voice=english?'en-US-JennyNeural':'zh-HK-HiuMaanNeural';
  if(r.changeVoice&&!english){
    if(/男聲|男声/.test(r.prompt)) voice='zh-HK-WanLungNeural';
    else voice='zh-HK-HiuGaaiNeural';
  }
  const rate=r.faster?'+12%':english?'+8%':'+4%';
  const brand=intent==='ad_service'?'鹿聯廣告投放AI員工':'';
  return {
    brand:english?'':brand,market:english?'EN':'HK',
    voice:{language:english?'en-US':'zh-HK',tts_voice:voice,rate},
    sizes:['1080x1920'],
    videos:Array.from({length:n},(_,i)=>({
      id:'JOB-'+job.id.slice(0,8)+'-V'+(job.version_number||1)+'-'+(i+1),
      angle:(english?'English marketing video；':'業務主題='+intent+'；')+(job.revision_prompt?'基於上一版優化：'+job.revision_prompt:'保持使用者原本業務主題'),
      scenes:english?englishScenes(rel,d,i+1,job):scenes(rel,d,i+1,job)
    }))
  };
}
function briefValue(brief,label,fallback=''){
  const text=String(brief||'');
  const request=text.includes('【本次制作需求】')?text.split('【本次制作需求】').slice(1).join('【本次制作需求】'):text;
  const m=request.match(new RegExp(label+'[：:]([^\\n]+)'));
  return m?m[1].trim():fallback;
}
async function processPosterJob(job){
  const jd=path.join(FACTORY,'jobs',job.id);fs.mkdirSync(jd,{recursive:true});
  log('claim_poster',job.id,job.project_name);
  await hb(job.id,'正在下载海报素材',15);
  const ins=Array.isArray(job.input_files)?job.input_files:[];if(!ins.length)throw new Error('没有上传主视觉素材');
  const local=[];
  for(let i=0;i<ins.length;i++){const x=ins[i],f=path.join(jd,(i+1)+'-'+safe(x.name));await dl('video-agent-inputs',x.path,f);local.push({...x,local:f});}
  let main=local.find(x=>x.role==='main')||local[0];
  let source=main.local;
  if(String(main.type||'').startsWith('video/')){
    source=path.join(jd,'poster_frame.jpg');
    await run('ffmpeg',['-y','-ss','1','-i',main.local,'-frames:v','1','-q:v','2',source],jd);
  }
  const brief=String(job.brief||'');
  const size=briefValue(brief,'尺寸','1080x1350').match(/\d+x\d+/i)?.[0]||'1080x1350';
  const cfg={source,output:path.join(jd,'poster.jpg'),size,title:briefValue(brief,'主标题',job.project_name),facts:briefValue(brief,'核心卖点与准确事实',briefValue(brief,'准确价格/优惠/事实','')),cta:briefValue(brief,'行动引导','立即了解'),brand:briefValue(brief,'品牌',briefValue(brief,'客户',''))};
  const cf=path.join(jd,'poster_config.json');fs.writeFileSync(cf,JSON.stringify(cfg,null,2),'utf8');
  await hb(job.id,'正在生成商业海报并检查安全区',55);
  await run('python',[path.join(FACTORY,'worker','poster_generator.py'),cf],FACTORY);
  if(!fs.existsSync(cfg.output))throw new Error('海报文件没有生成');
  await hb(job.id,'海报已生成，正在回传',92);
  const dest=await rpc('video_agent_issue_path',{p_access:ACCESS,p_job_id:job.id,p_bucket:'video-agent-results',p_file_name:'poster.jpg'});
  await ul('video-agent-results',dest,cfg.output,'image/jpeg');
  await upd(job.id,{status:'completed',progress:100,stage:'已完成，可查看海报',output_files:[{name:'poster.jpg',path:dest,type:'image/jpeg'}],error_message:null});
  log('completed_poster',job.id,dest);
}
async function processJob(job){
  if(job.workflow_mode==='image_poster')return processPosterJob(job);
  const jd=path.join(FACTORY,'jobs',job.id);fs.mkdirSync(jd,{recursive:true});
  log('claim',job.id,job.project_name);
  await hb(job.id,'正在下載素材',12);
  const ins=Array.isArray(job.input_files)?job.input_files:[]; if(!ins.length)throw new Error('沒有上傳素材');
  const local=[];
  for(let i=0;i<ins.length;i++){const x=ins[i],f=path.join(jd,(i+1)+'-'+safe(x.name));await dl('video-agent-inputs',x.path,f);local.push({...x,local:f});}
  const main=local.find(x=>String(x.type||'').startsWith('video/'))||local[0];
  const ext=path.extname(main.local)||'.mp4';
  const own='job_'+job.id.replaceAll('-','_')+ext;
  fs.copyFileSync(main.local,path.join(ROOT,'broll','自有',own));
  const rel='broll/自有/'+own, d=dur(main.local);
  const intent=inferIntent(job);
  const intentLabel={
    massage:'按摩項目｜WhatsApp預約到店',
    smp:'SMP紋髮｜預約諮詢',
    nail:'美甲｜WhatsApp預約',
    lash:'美睫｜WhatsApp預約',
    facial:'美容護理｜預約到店體驗',
    hair:'美髮｜WhatsApp預約',
    ad_service:'鹿聯AI廣告代投｜諮詢合作',
    generic_service:'客戶原有項目｜通用預約到店'
  }[intent]||'客戶原有項目';
  await hb(job.id,'已識別主題：'+intentLabel+'，正在生成分鏡',25);
  const b=board(job,rel,d), bf=path.join(ROOT,'分镜','queue_'+job.id+'.json');
  fs.writeFileSync(bf,JSON.stringify(b,null,2),'utf8');
  await hb(job.id,job.brief?.includes('真人口播')?'未提供真人口播素材，已切換香港粵語旁白':'正在生成香港粵語配音',38);
  let p=45; const timer=setInterval(()=>hb(job.id,'正在渲染成片',p),20000);
  try{await run('node',['scripts\\build.mjs',bf,'--size','1080x1920','--approve'],ROOT,s=>{const m=s.match(/渲染 .*?\s+(\d+)%/);if(m)p=Math.min(92,45+Math.round(+m[1]*.47));log('build',s.trim().slice(-300));});}finally{clearInterval(timer);}
  await hb(job.id,'成片已生成，正在回傳',94);
  const outs=[];
  for(const v of b.videos){
    const f=path.join(ROOT,'output',day(),v.id+'_1080x1920.mp4'); if(!fs.existsSync(f))throw new Error('找不到成片 '+f);
    const dest=await rpc('video_agent_issue_path',{p_access:ACCESS,p_job_id:job.id,p_bucket:'video-agent-results',p_file_name:path.basename(f)});
    await ul('video-agent-results',dest,f); outs.push({name:v.id,path:dest,type:'video/mp4'});
  }
  await upd(job.id,{status:'completed',progress:100,stage:'已完成，可查看成片',output_files:outs,error_message:null});
  log('completed',job.id,outs.length);
}
async function tick(){
  try{
    await rpc('video_agent_requeue_stale',{p_access:ACCESS,p_stale_minutes:30});
    const x=await rpc('video_agent_claim_next_job',{p_access:ACCESS,p_worker_id:WORKER});
    const job=Array.isArray(x)?x[0]:x;
    if(job?.id){try{await processJob(job);}catch(e){log('job_error',job.id,String(e));try{await upd(job.id,{status:'failed',stage:'生成失敗，請查看錯誤',error_message:String(e).slice(0,900)});}catch{}}}
  }catch(e){log('tick_error',String(e));}
}
const once=process.argv.includes('--once');
log('worker_start',once?'once':'loop');
if(once){await tick();process.exit(0);}
while(true){await tick();await new Promise(r=>setTimeout(r,15000));}
