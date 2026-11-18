/* ============================================================
   小熊伙伴 · 语音封装 bear-voice.js
   朗读优先用后端的「晓晓」温柔女声 MP3（所有设备音色一致）；
   后端不可用时回退浏览器语音，并尽量选中晓晓/温柔中文女声。
   语音输入用浏览器能力，不支持时优雅降级。
   ============================================================ */
(function (global) {
  'use strict';

  var SR = global.SpeechRecognition || global.webkitSpeechRecognition || null;
  var synth = global.speechSynthesis || null;
  var rec = null;
  var listening = false;
  var speaking = false;
  var pickedVoice = null;   // 已选中的温柔中文声音
  var audioEl = null;       // 正在播放的后端 MP3
  var speakSeq = 0;         // 语音代次：每次朗读/停止 +1，过期请求一律丢弃
  var pendingCtrl = null;   // 正在等待的 TTS 请求
  var speakingText = '';    // 当前正在朗读的纯文字（用于 toggle 判断）

  function supportedRecognition() { return !!SR; }
  function supportedSynthesis() { return !!synth; }
  function isCurrent(seq) { return seq === speakSeq; }

  /* ---------- 选一个最温柔的中文女声 ---------- */
  function pickVoice() {
    if (pickedVoice) return pickedVoice;
    if (!synth || !synth.getVoices) return null;
    var voices = synth.getVoices().filter(function (v) { return /zh/i.test(v.lang); });
    if (!voices.length) return null;
    var best = null, bestScore = -1;
    voices.forEach(function (v) {
      var n = (v.name || '').toLowerCase();
      var s = -1;
      if (/xiaoxiao|晓晓|xiaoyi|晓伊|tingting|ting-ting/.test(n)) s = 100;
      else if (/huihui|慧慧|yaoyao|瑶瑶|nn|female/.test(n)) s = 92;
      else if (/meijia|佳|sinji|google 普通话|samantha/.test(n)) s = 85;
      else if (/xinyao|yunxi|natural|neural|premium|enhanced/.test(n)) s = 78;
      else if (/female|女|women/.test(n)) s = 70;
      else if (/zh[-_]?cn/.test((v.lang || '').toLowerCase())) s = 50;
      if (s > bestScore) { bestScore = s; best = v; }
    });
    pickedVoice = best;
    return best;
  }
  if (synth && synth.onvoiceschanged !== undefined) {
    synth.onvoiceschanged = function () { pickedVoice = null; pickVoice(); };
  }

  /* 朗读文本清洗：只保留"要说的话"，去掉标签、时间、表情符号。
     emoji 用 u 正则一次剔除；老浏览器不支持 u 时退化为基础区间。 */
  var EMOJI_RE;
  try { EMOJI_RE = new RegExp('[\\u{1F000}-\\u{1FAFF}\\u{2600}-\\u{27BF}\\u{2B00}-\\u{2BFF}\\u{FE0F}\\u{200D}\\u{2190}-\\u{21FF}\\u{1F1E6}-\\u{1F1FF}]', 'gu'); }
  catch (e) { EMOJI_RE = /[\u2600-\u27BF\uFE0F\u200D]/g; }

  function clean(text) {
    var s = String(text || '').replace(/<[^>]+>/g, '');
    s = s.replace(/AI 生成[^\n]*|离线样例[^\n]*|小熊的(回应|问候)[^\n]*/g, '');
    s = s.replace(/\b\d{1,2}:\d{2}\b/g, '');            // 去掉时间戳 01:56
    s = s.replace(EMOJI_RE, '');                        // 去掉 emoji
    s = s.replace(/[ \t]{2,}/g, ' ').replace(/^\s+|\s+$/g, '');
    return s;
  }

  /** 浏览器本地朗读（回退方案），语速慢、音调柔。seq 过期则不发声 */
  function browserSpeak(content, onend, seq) {
    if (seq !== undefined && !isCurrent(seq)) return false;
    if (!supportedSynthesis() || !content) { if (onend) onend(false); return false; }
    try {
      synth.cancel();
      var u = new SpeechSynthesisUtterance(content);
      var v = pickVoice();
      if (v) u.voice = v;
      u.lang = 'zh-CN';
      u.rate = 0.82;      // 再放慢，孩子听得清、更像讲故事
      u.pitch = 1.12;     // 轻轻提一点，柔和
      u.volume = 1;
      u.onend = function () { if (!isCurrent(seq)) return; speaking = false; if (onend) onend(true); };
      u.onerror = function () { if (!isCurrent(seq)) return; speaking = false; if (onend) onend(false); };
      speaking = true;
      synth.speak(u);
      return true;
    } catch (e) {
      speaking = false; if (onend) onend(false); return false;
    }
  }

  /** 播放本地预置的温柔 MP3（与 kid.html 同一音色，手机/微信也一致） */
  function playPreset(url, content, onend, seq) {
    var a = new Audio(url);
    audioEl = a;
    a.onended = function () { if (!isCurrent(seq)) return; speaking = false; if (onend) onend(true); };
    a.onerror = function () { if (!isCurrent(seq)) return; browserSpeak(content, onend, seq); };
    var pr = a.play();
    if (pr && pr.catch) pr.catch(function () { if (!isCurrent(seq)) return; browserSpeak(content, onend, seq); });
    return true;
  }

  /** 主朗读入口：① 预置温柔 MP3（固定文本，手机/微信同音色）
                  ② 后端晓晓 TTS（真实 AI 动态回复）
                  ③ 浏览器本地朗读（最后兜底）
      每一条朗读都有独立 seq：慢请求返回时若已有更新的朗读/停止，直接丢弃，绝不会叠音。 */
  function speak(text, onend) {
    var content = clean(text);
    if (!content) { if (onend) onend(false); return false; }

    // 新朗读：作废之前的一切（在途请求、正在播放的音频/合成音）
    speakSeq++;
    var seq = speakSeq;
    speakingText = content;
    if (pendingCtrl) { try { pendingCtrl.abort(); } catch (e) {} pendingCtrl = null; }
    if (audioEl) { try { audioEl.onended = null; audioEl.onerror = null; audioEl.pause(); } catch (e) {} }
    try { if (synth) synth.cancel(); } catch (e) {}

    // ① 固定文本命中预置温柔语音：优先本地 MP3，彻底避开机械音
    var M = global.BearChatVoiceMap || {};
    if (M[content]) { speaking = true; return playPreset(M[content], content, onend, seq); }

    var C = global.BearConfig || {};
    var AI = global.BearAI || {};

    // 前端直连模式（GitHub Pages 静态站）：没有后端 TTS，别再发注定 404 的 /api/tts 请求，
    // 直接用最优浏览器音色朗读，避免每次先卡一下。固定文本已在上面命中预置温柔 MP3。
    if (AI.direct || AI.backendTts === false || !global.fetch) return browserSpeak(content, onend, seq);

    var base = C.apiBase || '';
    var ttsPath = C.ttsPath || '/api/tts';

    var ctrl = new AbortController();
    pendingCtrl = ctrl;
    var timer = setTimeout(function () { ctrl.abort(); }, 15000);
    speaking = true;

    global.fetch(base + ttsPath, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: content })
    }).then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('http')); })
      .then(function (j) {
        clearTimeout(timer);
        if (!isCurrent(seq)) return;                 // 期间点了停止/别的回复，丢弃这条慢音频
        if (pendingCtrl === ctrl) pendingCtrl = null;
        if (!j || !j.audio) throw new Error('no audio');
        var url = 'data:audio/mp3;base64,' + j.audio;
        var a = new Audio(url);
        audioEl = a;
        a.onended = function () { if (!isCurrent(seq)) return; speaking = false; if (onend) onend(true); };
        a.onerror = function () { if (!isCurrent(seq)) return; browserSpeak(content, onend, seq); };
        var pr = a.play();
        if (pr && pr.catch) pr.catch(function () { if (!isCurrent(seq)) return; browserSpeak(content, onend, seq); });
      })
      .catch(function (e) {
        clearTimeout(timer);
        if (!isCurrent(seq)) return;
        if (e && e.name === 'AbortError') return;     // 被新朗读取消，不算失败
        AI.backendTts = false; // 本会话内不再尝试，直接用浏览器温柔音
        browserSpeak(content, onend, seq);
      });
    return true;
  }

  /** 播放/静音切换：同一段正在念 → 停止（静音）；否则开始念。返回 'stopped' | 'playing' */
  function toggleSpeak(text, onend) {
    var content = clean(text);
    if (speaking && content && content === speakingText) {
      stopSpeak();
      return 'stopped';
    }
    speak(content, onend);
    return 'playing';
  }

  function stopSpeak() {
    speakSeq++;                       // 让所有在途/回调作废
    speakingText = '';
    if (pendingCtrl) { try { pendingCtrl.abort(); } catch (e) {} pendingCtrl = null; }
    try { if (synth) synth.cancel(); } catch (e) {}
    if (audioEl) { try { audioEl.onended = null; audioEl.onerror = null; audioEl.pause(); audioEl.currentTime = 0; } catch (e) {} }
    speaking = false;
  }

  /** 开始语音识别；回调 {onResult, onError, onEnd} */
  function startListen(handlers) {
    handlers = handlers || {};
    if (!supportedRecognition()) {
      if (handlers.onError) handlers.onError('unsupported');
      return false;
    }
    try {
      if (rec) { try { rec.abort(); } catch (e) {} }
      rec = new SR();
      rec.lang = 'zh-CN';
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.continuous = false;
      rec.onstart = function () { listening = true; };
      rec.onresult = function (e) {
        var t = '';
        for (var i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
        if (handlers.onResult) handlers.onResult(t.trim());
      };
      rec.onerror = function (e) { listening = false; if (handlers.onError) handlers.onError(e.error || 'error'); };
      rec.onend = function () { listening = false; if (handlers.onEnd) handlers.onEnd(); };
      rec.start();
      return true;
    } catch (e) {
      listening = false;
      if (handlers.onError) handlers.onError('start-failed');
      return false;
    }
  }

  function stopListen() { if (rec) { try { rec.stop(); } catch (e) {} } listening = false; }

  global.BearVoice = {
    speak: speak,
    toggleSpeak: toggleSpeak,
    clean: clean,
    stopSpeak: stopSpeak,
    startListen: startListen,
    stopListen: stopListen,
    isListening: function () { return listening; },
    isSpeaking: function () { return speaking; },
    supportedRecognition: supportedRecognition,
    supportedSynthesis: supportedSynthesis,
    pickVoice: pickVoice
  };
})(window);
