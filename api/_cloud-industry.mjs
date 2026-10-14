// Cloud port of the local industry logic in worker/video_agent_worker.mjs.
// Copy tables, intent rules, revision flags and the five-beat storyboard are
// kept in step with the local worker. Secrets, Windows paths and the local
// render pipeline are deliberately NOT part of this module.

export function revisionFlags(job) {
  const prompt = String(job?.revision_prompt || '');
  const scope = String(job?.revision_scope || 'auto').toLowerCase();
  const ver = Number(job?.version_number || 1);
  const has = (re) => re.test(prompt);
  return {
    scope,
    prompt,
    ver,
    changeHook: scope === 'hook' || scope === 'redo' || has(/開頭|开头|hook|前三秒|頭三秒/i),
    changeMaterial: scope === 'material' || scope === 'redo' || has(/素材|畫面|画面|真實|真实|AI感|場景|场景/i),
    changeVoice: scope === 'voice' || has(/聲音|声音|配音|男聲|男声|女聲|女声/i),
    reduceSubs: scope === 'subtitle' || has(/字幕.*(少|減|减)|減少字幕|减少字幕|字幕太多/i),
    faster: scope === 'pace' || has(/節奏|节奏|快一點|快一点|壓縮|压缩|短啲|20秒/i),
    changeCta: scope === 'cta' || has(/CTA|結尾|结尾|WhatsApp|行動引導|行动引导/i),
    redo: scope === 'redo' || has(/全部重做|重新做|完全不同/i),
  };
}

// Same rule as the local worker: an English brief is detected from the brief
// text. A job-level language or locale also counts.
export function isEnglishBrief(job) {
  return /(?:语言|語言|语言声音|語言聲音)\s*[：:]\s*English|natural human pace/i.test(String(job?.brief || ''));
}

export function isEnglishJob(job) {
  return /^en/i.test(String(job?.language || job?.locale || '')) || isEnglishBrief(job);
}

function positiveIntentText(job) {
  const raw = [job?.brief || '', job?.revision_prompt || ''].join('\n');
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const negativeLabel = /^(?:[-*]\s*)?(?:禁止出现|禁止內容|禁止内容|不得出现|不要出现|必须排除|必須排除|排除项|排除項|must[_ -]?exclude|negative constraints?)\s*[：:]/i;
  const positiveLines = lines.filter((line) => !negativeLabel.test(line));
  const businessLabel = /^(?:[-*]\s*)?(?:业务主题|業務主題|业务类型|業務類型|项目类型|項目類型|business[_ -]?type|campaign(?: theme)?)\s*[：:]/i;
  const explicitBusiness = positiveLines.filter((line) => businessLabel.test(line));
  return (explicitBusiness.length ? explicitBusiness : positiveLines).join(' ');
}

export function inferIntent(job) {
  // Only classify positive business instructions. A phrase such as
  // "禁止出现：按摩" is a constraint, not evidence that the job is massage.
  const text = positiveIntentText(job);
  const rules = [
    { type: 'ad_service', re: /(AI.{0,4}(廣告|广告)|(廣告|广告).{0,4}AI|廣告代投|广告代投|Meta.{0,4}代投|投放合作|鹿聯|鹿联|廣告員工|广告员工|同區新客|同区新客|新客獲取|新客获取|獲客|获客|客戶增長|客户增长|營銷代運營|营销代运营)/i },
    { type: 'massage', re: /(按摩|推拿|肩頸|肩颈|足療|足疗|SPA|spa|放鬆|放松|頭療|头疗|按摩體驗|按摩体验)/i },
    { type: 'smp', re: /(SMP|紋髮|纹发|髮際線|发际线|頭皮紋|头皮纹|半永久紋髮|半永久纹发)/i },
    { type: 'nail', re: /(美甲|甲油|gel甲|Gel甲)/i },
    { type: 'lash', re: /(美睫|睫毛|植睫|嫁接睫毛)/i },
    { type: 'facial', re: /(美容護理|美容护理|Facial|facial|皮膚管理|皮肤管理|面部護理|面部护理)/i },
    { type: 'hair', re: /(美髮|美发|髮型|发型|染髮|染发|剪髮|剪发)/i },
  ];
  for (const rule of rules) if (rule.re.test(text)) return rule.type;
  return 'generic_service';
}

export const INTENT_LABELS = {
  massage: '按摩項目｜WhatsApp預約到店',
  smp: 'SMP紋髮｜預約諮詢',
  nail: '美甲｜WhatsApp預約',
  lash: '美睫｜WhatsApp預約',
  facial: '美容護理｜預約到店體驗',
  hair: '美髮｜WhatsApp預約',
  ad_service: '鹿聯AI廣告代投｜諮詢合作',
  generic_service: '客戶原有項目｜通用預約到店',
};

export const INTENT_COPY = {
  massage: {
    hooks: [
      ['返工坐到成個人硬晒？\n不如俾自己鬆一鬆', '返工坐得耐，成個人都繃緊？不如俾自己一個時間，真正放鬆一下。'],
      ['攰咗成個星期？\n放工後俾自己鬆一鬆', '攰咗成個星期，放工之後不如俾自己鬆一鬆，舒服返啲。'],
      ['想真正放鬆一下？\n約個時間嚟體驗', '想真正放鬆一下？約個時間嚟試下按摩體驗。'],
    ],
    cards: ['返工坐得耐', '成日覺得繃緊', '想放鬆但冇時間'],
    middleText: '按摩放鬆體驗\n俾自己一段休息時間',
    middleVo: '由環境到手法，都係想你可以停一停，舒服咁放鬆一下。',
    msgs: ['你好，想問下按摩體驗', '今晚或者星期六有冇位？'],
    chatVo: '想試嘅話，可以直接WhatsApp問時間同預約。',
    ctaText: '預約按摩體驗\nWhatsApp 約時間',
    ctaVo: '想放鬆一下？WhatsApp問我哋今日有冇位，約個時間嚟體驗。',
  },
  smp: {
    hooks: [
      ['髮際線睇落稀疏？\n可以先了解SMP', '如果你覺得髮際線睇落比較稀疏，可以先了解下SMP紋髮係點做。'],
      ['想髮際線睇落完整啲？\n先睇下SMP效果', '想髮際線睇落完整啲？可以先睇下SMP紋髮嘅實際效果。'],
      ['SMP紋髮係點做？\n先睇真實過程', 'SMP紋髮究竟係點做？先睇下真實操作過程。'],
    ],
    cards: ['先了解適唔適合自己', '睇清楚操作過程', '再決定要唔要預約'],
    middleText: 'SMP 專業操作\n按需要設計效果',
    middleVo: '會先了解你想改善嘅位置，再按實際情況設計適合嘅效果。',
    msgs: ['你好，想了解SMP紋髮', '可唔可以先預約諮詢？'],
    chatVo: '想了解自己適唔適合，可以直接WhatsApp預約諮詢。',
    ctaText: 'SMP 紋髮諮詢\nWhatsApp 預約',
    ctaVo: '想了解多啲SMP紋髮，可以WhatsApp我哋預約諮詢。',
  },
  nail: {
    hooks: [['今次想轉個新款？\n預約美甲時間', '今次想轉個新款？可以先WhatsApp約個時間嚟做美甲。']],
    cards: ['揀款式', '揀時間', '到店做甲'],
    middleText: '美甲預約\n按你喜歡嘅風格做',
    middleVo: '可以先講你鍾意嘅款式同感覺，再幫你安排時間。',
    msgs: ['想問下今個星期美甲有冇位？', '我想做簡約款'],
    chatVo: '想做嘅話，WhatsApp我哋揀時間就可以。',
    ctaText: '預約美甲\nWhatsApp 約時間',
    ctaVo: '想整新款美甲？WhatsApp我哋約時間。',
  },
  lash: {
    hooks: [['想對眼更有精神？\n預約美睫體驗', '想對眼睇落更有精神？可以約時間嚟做美睫。']],
    cards: ['揀自然或濃密', '按眼型設計', '預約到店'],
    middleText: '美睫設計\n按你想要嘅效果做',
    middleVo: '可以按你眼型同想要嘅感覺，揀自然或者濃密效果。',
    msgs: ['想問下植睫有咩款？', '星期六有冇位？'],
    chatVo: '想試嘅話，WhatsApp我哋約時間。',
    ctaText: '預約美睫\nWhatsApp 約時間',
    ctaVo: '想試美睫？WhatsApp問我哋時間。',
  },
  facial: {
    hooks: [['想俾塊面好好休息？\n約個護理時間', '想俾自己同皮膚休息一下？可以約個時間嚟做護理。']],
    cards: ['先了解皮膚需要', '揀合適護理', '預約到店'],
    middleText: '美容護理體驗\n按需要安排',
    middleVo: '會先了解你嘅需要，再安排適合嘅美容護理。',
    msgs: ['想問下有咩面部護理？', '今個星期有冇位？'],
    chatVo: '想了解療程，可以直接WhatsApp問我哋。',
    ctaText: '預約美容護理\nWhatsApp 約時間',
    ctaVo: '想試美容護理？WhatsApp約個時間嚟體驗。',
  },
  hair: {
    hooks: [['想轉個新髮型？\n先約個時間', '想轉個新髮型？可以先WhatsApp約個時間。']],
    cards: ['講你想要嘅感覺', '按髮況溝通', '預約到店'],
    middleText: '髮型服務\n先溝通再設計',
    middleVo: '可以先講你想要嘅效果，再按實際髮況溝通。',
    msgs: ['想問下今個星期有冇位？', '我想轉個新髮型'],
    chatVo: '想預約可以直接WhatsApp問時間。',
    ctaText: '預約髮型服務\nWhatsApp 約時間',
    ctaVo: '想轉髮型？WhatsApp我哋約時間。',
  },
  generic_service: {
    hooks: [
      ['想試下呢個療程？\n先了解再預約', '想試下呢個療程？可以先了解清楚，再決定幾時嚟體驗。'],
      ['想知呢個項目啱唔啱你？\n先睇真實過程', '想知呢個項目啱唔啱你？先睇下真實過程，再慢慢決定。'],
    ],
    cards: ['先了解項目', '睇真實過程', '再預約到店'],
    middleText: '真實服務過程\n按需要安排體驗',
    middleVo: '先了解服務內容同實際過程，再按你嘅需要安排體驗。',
    msgs: ['你好，想了解下呢個項目', '想問下今個星期有冇位？'],
    chatVo: '有興趣可以直接WhatsApp了解同預約。',
    ctaText: '預約到店體驗\nWhatsApp 約時間',
    ctaVo: '想了解或者預約體驗，WhatsApp我哋約時間。',
  },
  ad_service: {
    hooks: [
      ['有手勢\n都唔代表有新客', '間舖冇新客，好多時唔係你手勢唔好。'],
      ['有舖有手勢\n但日日都靜雞雞？', '有舖、有手勢，但日日開門都靜雞雞？'],
      ['唔使日日拍片\n都要有人睇到你', '唔使你日日拍片，重點係要俾同區真正有興趣嘅客人睇到你。'],
    ],
    cards: ['客人未睇明你做咩療程', '唔知你喺邊區', '唔知點預約'],
    middleText: '香港美業｜同區新客\nWhatsApp 即問',
    middleVo: '鹿聯AI廣告員工會幫你整理賣點，再投俾同區真正有興趣嘅客人睇。',
    msgs: ['你好，想問下你哋個療程', '我住附近，想約時間'],
    chatVo: '睇到廣告嘅客人，可以直接WhatsApp問你同預約。',
    ctaText: '香港美容院廣告合作\n先做廣告體檢',
    ctaVo: '想知你間舖廣告卡喺邊？WhatsApp我哋，先幫你做廣告體檢。',
  },
};

export function intentCopy(type, variant = 1) {
  const set = INTENT_COPY[type] || INTENT_COPY.generic_service;
  const hook = set.hooks[(Math.max(1, variant) - 1) % set.hooks.length];
  return { ...set, hook };
}

// Five beats, same timing and order as the local worker's scenes().
// Each beat carries the spoken line (`vo`) and the overlay text the cloud
// renderer draws (`kicker`, `title`, `subtitle`).
export function industryStoryboard(job) {
  const flags = revisionFlags(job);
  const intent = inferIntent(job);
  const variant = (flags.changeHook || flags.redo) ? Math.max(1, flags.ver) : 1;
  const copy = intentCopy(intent, variant);
  const seconds = flags.faster ? [2.6, 4.0, 4.8, 4.5, 4.0] : [3, 5, 6, 6, 5];
  const showSubtitles = !flags.reduceSubs;

  const hook = { template: 'big_text_hook', kicker: '先別划走', title: copy.hook[0], subtitle: copy.hook[1], vo: copy.hook[1] };
  const pain = {
    template: 'pain_cards', kicker: '痛點', cards: copy.cards, title: '', subtitle: '',
    vo: intent === 'ad_service'
      ? '好多時問題唔係服務，而係客人未睇明你做咩、唔知你喺邊區、亦唔知點預約。'
      : copy.cards.join('、') + '。',
  };
  const middle = intent === 'ad_service'
    ? { template: 'big_text_hook', kicker: '廣告投放', title: copy.middleText, subtitle: copy.middleVo, vo: copy.middleVo }
    : { template: 'big_text_hook', kicker: '真實過程', title: copy.middleText, subtitle: copy.middleVo, vo: copy.middleVo };
  const chat = { template: 'whatsapp_chat', kicker: 'WhatsApp', messages: copy.msgs, title: '', subtitle: copy.chatVo, vo: copy.chatVo };
  const cta = { template: 'cta_offer', kicker: '現在行動', title: copy.ctaText, button: intent === 'ad_service' ? 'WhatsApp 了解' : 'WhatsApp 預約', subtitle: copy.ctaVo, vo: copy.ctaVo };
  const beats = [hook, pain, middle, chat, cta];

  return beats.map((beat, index) => ({
    ...beat,
    seconds: seconds[index],
    showSubtitle: showSubtitles,
  }));
}

// Voice rules copied from the local worker: English stays Jenny; Cantonese
// keeps HiuMaan unless a voice change is asked for, then male/female.
export function voiceRulesFor(job) {
  const flags = revisionFlags(job);
  const english = isEnglishJob(job);
  let voice = english ? 'en-US-JennyNeural' : 'zh-HK-HiuMaanNeural';
  if (flags.changeVoice && !english) {
    voice = /男聲|男声/.test(flags.prompt) ? 'zh-HK-WanLungNeural' : 'zh-HK-HiuGaaiNeural';
  }
  const rate = flags.faster ? '+12%' : english ? '+8%' : '+4%';
  return { english, voice, rate };
}

// English branch. The local worker used generic English lines, which ignored
// the brief's own ad copy. Here the brief's copy is used when it is present:
// a question for the hook, the check-marked points for the pain beat, the
// service name and description for the middle, the price for the offer.
// Generic lines remain the fallback when the brief has no such copy.
export function parseEnglishAdCopy(brief) {
  const lines = String(brief || '').replaceAll('\\n', '\n').split('\n').map((line) => line.trim()).filter(Boolean);
  const clean = (line) => line.replace(/^[\p{Extended_Pictographic}\uFE0F\s]+/u, '').trim();
  const hook = lines.find((line) => line.includes('?') && /[A-Za-z]/.test(line));
  const points = lines.filter((line) => line.startsWith('✅')).map(clean).slice(0, 3);
  const serviceIndex = lines.findIndex((line) => line.startsWith('🔥') && !/S\$/.test(line));
  const service = serviceIndex >= 0 ? clean(lines[serviceIndex]) : '';
  const description = serviceIndex >= 0 ? lines.slice(serviceIndex + 1).find((line) => /[A-Za-z]/.test(line) && !/^[⏳📍💬✅🔥]/u.test(line)) || '' : '';
  const price = (lines.join(' ').match(/S\$\s?\d+/) || [])[0];
  const ask = lines.find((line) => line.startsWith('💬'));
  return { hook, points, service, description, price, ask: ask ? clean(ask) : '' };
}

export function englishStoryboard(job) {
  const flags = revisionFlags(job);
  const seconds = flags.faster ? [2.6, 4, 4.8, 4.5, 4] : [3, 5, 6, 6, 5];
  const copy = parseEnglishAdCopy(job?.brief);
  const business = (String(job?.brief || '').match(/业务类型[：:]([^\n]+)/)?.[1] || 'this service').trim();
  const hook = copy.hook ? copy.hook.replace(/\?.*$/, '?') : 'Ready for a real change?';
  const pain = copy.points.length ? copy.points : ['See the real process', 'Understand the value', 'Choose with confidence'];
  const middleTitle = copy.service || 'Real process\nReal customer proof';
  const middleSub = copy.description || 'Here is the real customer process, so you can see exactly what to expect.';
  const offerLine = copy.price ? `First-time trial ${copy.price}` : 'Ready to get started?';
  const beats = [
    { template: 'big_text_hook', kicker: 'Hook', title: hook, subtitle: copy.service ? copy.service : 'Ready to see what ' + business + ' can do for you?', vo: [hook, copy.service || 'Ready to see what ' + business + ' can do for you?'].join(' ') },
    { template: 'pain_cards', kicker: 'Points', cards: pain, title: '', subtitle: '', vo: pain.join('. ') + '.' },
    { template: 'big_text_hook', kicker: 'Service', title: middleTitle, subtitle: middleSub, vo: middleSub },
    { template: 'whatsapp_chat', kicker: 'WhatsApp', messages: ['Hi, I would like to learn more.', 'Can I book a time?'], title: '', subtitle: 'Have a question? Message us directly on WhatsApp.', vo: 'Have a question? Message us directly on WhatsApp.' },
    { template: 'cta_offer', kicker: 'Next step', title: `${offerLine}\n${copy.ask ? 'WhatsApp to book' : 'WhatsApp us now'}`, button: 'WhatsApp us now', subtitle: copy.ask || 'WhatsApp us now to learn more or book your place.', vo: copy.ask || 'WhatsApp us now to learn more or book your place.' },
  ];
  return beats.map((beat, index) => ({ ...beat, seconds: seconds[index], showSubtitle: true }));
}
