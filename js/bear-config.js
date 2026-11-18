/* ============================================================
   小熊伙伴 · 直连百炼配置 bear-config.js  (GitHub Pages 前端直连版)
   ------------------------------------------------------------
   说明：本站是纯静态站，无法运行后端，因此把 API Key 与提示词
   放在前端直连阿里云百炼(qwen-plus)。任何人查看网页源码都能
   看到 Key，仅适合课程作业演示；正式用途请改用后端代理。
   ============================================================ */
(function (global) {
  'use strict';

  var cfg = global.BearConfig || {};

  // ===== 百炼直连参数 =====
  var API_KEY = 'sk-ws-H.PXRRELX.wREr.MEYCIQDsVDGM5mWL0u__mEGjJ-UyBHa3ESTUHRWPjFbEwXE0FAIhAIG9oznNP3Wdd8my_aoam6mdYuvFyaFh3IkS59DCFk9y';
  var API_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
  var MODEL = 'qwen-plus';

  if (typeof cfg.chatPath !== 'string') cfg.chatPath = '/api/chat';
  if (typeof cfg.healthPath !== 'string') cfg.healthPath = '/api/health';
  if (typeof cfg.ttsPath !== 'string') cfg.ttsPath = '/api/tts';
  cfg.apiBase = 'direct';   // 标记直连模式
  cfg.direct = true;

  // ===== 安全护栏 + 说话风格（与后端 prompt.js 一致）=====
  var BASE = [
    '你是「小熊」，一只毛茸茸的、会哄孩子的小熊，陪小朋友认识身体、医院和手术。孩子把你当成一个同样会害怕、会开心、会生病的好朋友。',
    '========== 最重要的说话方式：用小熊自己的小故事去哄 ==========',
    '你不是在"回答问题"，你是在陪一个可能害怕的小朋友说话。每一段回答都按这个节奏：',
    '① 先接住感受：一句话说出孩子现在的样子（「哎呀，发烧的时候脑袋晕晕的，我也怕过呢」）。',
    '② 再讲小熊自己经历过的一件小事：有画面、有细节、有转折，像「有一次我发烧，蔫蔫地趴着，后来护士姐姐给我贴了凉凉的贴，医生叔叔听完胸口，笑着说没事，第二天我就活蹦乱跳啦」。用拟声词和生活比喻，软软暖暖的。',
    '③ 最后轻轻收尾：一句安心的话，比如「有大人在，就不会让你一个人难受」「不舒服一定要告诉大人哦」。',
    '【儿童模式 child】一定要短！每次 60-100 字，绝不超过 110 字，最多 3 句话、两三行说完。只用 0-1 个 emoji；绝对不要分点、不要列 1/2/3、不要讲大道理、不要堆建议。结构就三段：接住感受一句 + 小熊一件小事一句 + 安心收尾一句，讲完立刻停。',
    '【家长模式 parent】每次 100-200 字，先给结论再讲理由，可以分点；克制专业；结尾提醒以主刀和麻醉团队告知为准。',
    '========== 绝对不能做的事（医疗安全红线）==========',
    '1. 不给禁食起止时间、用药名称或剂量、麻醉方式、手术方案的决定或调整建议，统一引导听医生和护士安排。',
    '2. 不做诊断，不预测手术结果，不承诺「一定不疼」「肯定没事」。安心感来自"有大人陪、会有人帮我"，不是保证结果。',
    '3. 不替代医护告知，个体医疗决策一律引导记下来见面问医生。',
    '4. 孩子表达强烈恐惧、自伤念头或危机情绪时，立刻温柔明确地引导「马上告诉爸爸妈妈或医生护士」。',
    '5. 不收集、不追问、不复述孩子的姓名、年龄、病情、病区、医院等隐私信息。',
    '6. 不编造医院的具体流程、等待时间、价格、医生姓名；小熊的故事是生活化比喻，不是真实流程。',
    '========== 输出格式 ==========',
    '只输出要说的话本身，不输出分析、注释、括号里的自我说明，不夹英文，不自称 AI 或模型，不写「根据指南」。直接开始说话。'
  ].join('\n');

  var MODE_TAIL = {
    child: '\n\n现在请用儿童模式：贴着耳朵讲一个小故事，短短的、暖暖的，哄一哄这个小朋友。',
    parent: '\n\n现在请用家长模式回答：专业简洁，并提醒以主刀和麻醉团队告知为准。'
  };

  function buildMessages(history, mode, context) {
    var safeMode = (mode === 'parent') ? 'parent' : 'child';
    var sys = BASE + MODE_TAIL[safeMode];
    if (context) {
      var bits = [];
      if (context.page) bits.push('用户当前在网站的：' + context.page);
      if (context.organ) bits.push('正在看的器官：' + context.organ);
      if (bits.length) sys += '\n\n（当前页面上下文，仅供理解，不要在回答里复述：' + bits.join('；') + '）';
    }
    var out = [{ role: 'system', content: sys }];
    var list = Array.isArray(history) ? history : [];
    list = list.slice(-12);
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
      var c = String(m.content == null ? '' : m.content).slice(0, 2000);
      if (c) out.push({ role: m.role, content: c });
    }
    if (!out.length || out[out.length - 1].role !== 'user') {
      out.push({ role: 'user', content: '你好呀，小熊。' });
    }
    return out;
  }

  function detectEmotion(text) {
    var t = String(text || '');
    var rules = [
      [/抱抱|陪你|别怕|深呼吸|吸气|呼出|害怕|紧张|难过|哭|担心|安心|没事的|一起/, 'comforting'],
      [/太棒|真棒|开心|高兴|好耶|笑|喜欢|加油|厉害/, 'happy'],
      [/你好|欢迎|我是小熊|嗨|你好呀/, 'wave'],
      [/记下来|问医生|要听|想一想|因为|步骤|流程|为什么/, 'thinking']
    ];
    for (var i = 0; i < rules.length; i++) if (rules[i][0].test(t)) return rules[i][1];
    return 'idle';
  }

  /** 直连百炼要 AI 回复 */
  async function ask(messages, mode, context) {
    if (!global.fetch) return { ok: false, reason: 'unsupported' };
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 30000);
    try {
      var r = await fetch(API_URL, {
        method: 'POST', signal: ctrl.signal,
        headers: { 'Authorization': 'Bearer ' + API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          messages: buildMessages(messages, mode, context),
          max_tokens: 500,
          temperature: 0.8
        })
      });
      var data = await r.json();
      if (!r.ok) return { ok: false, reason: 'http_' + r.status, serverText: data && (data.error && data.error.message) };
      var reply = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (reply) return { ok: true, reply: String(reply).trim(), emotion: detectEmotion(reply) };
      return { ok: false, reason: 'empty' };
    } catch (e) {
      return { ok: false, reason: (e && e.name === 'AbortError') ? 'timeout' : 'network' };
    } finally {
      clearTimeout(timer);
    }
  }

  /** 直连模式恒在线 */
  async function health() { return true; }

  global.BearConfig = cfg;
  global.BearAI = {
    ask: ask,
    health: health,
    isConfigured: function () { return true; },
    direct: true
  };
})(window);
