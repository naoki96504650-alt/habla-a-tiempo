export class SpeechAdapter {
    active = null;
    retries = 0;
    stop() { this.active?.abort(); this.active = null; }
    start(lang, onText, onStatus) {
        this.stop();
        const G = globalThis, C = G.SpeechRecognition ?? G.webkitSpeechRecognition;
        if (!C) {
            onStatus('自動文字起こしは使えません。スペイン語キーボードの音声入力、手入力、口頭の自己照合で続けられます。');
            return;
        }
        const r = new C();
        if (!('processLocally' in r)) {
            onStatus('このブラウザでは端末内の文字起こしを確認できません。標準入力または口頭の自己照合を使ってください。');
            return;
        }
        r.processLocally = true;
        r.lang = lang;
        r.continuous = false;
        r.interimResults = false;
        let received = false, failed = false;
        r.onresult = e => { const text = [...Array.from(e.results)].filter(x => x.isFinal).map(x => x[0].transcript).join(' '); if (text.trim()) {
            received = true;
            this.retries = 0;
            onText(text);
        }
        else
            onStatus('文字を取得できませんでした。標準入力で続けられます。'); };
        r.onerror = e => { failed = true; this.retries++; const errors = { 'not-allowed': 'マイクの使用が許可されていません。', 'service-not-allowed': '音声認識が許可されていません。', 'network': '音声認識を利用できません。', 'no-speech': '音声を確認できませんでした。', 'audio-capture': 'マイクを利用できません。', 'language-not-supported': '端末内のスペイン語音声認識は利用できません。' }; onStatus((errors[e.error] ?? '音声認識を終了しました。') + ' 標準入力か口頭の自己照合で続けられます。'); };
        r.onend = () => { this.active = null; if (!failed)
            onStatus(received ? '文字起こしを確認してください。' : '録音は終了しました。標準入力または自己照合で続けられます。'); };
        if (this.retries >= 2) {
            onStatus('音声認識を続けられないため、標準入力または自己照合を使ってください。');
            return;
        }
        try {
            this.active = r;
            r.start();
            onStatus('聞き取り中です。話し終えたら録音を止めてください。');
        }
        catch {
            this.active = null;
            this.retries++;
            onStatus('音声認識を開始できません。標準入力で続けられます。');
        }
    }
}
export function speak(text, lang, rate = 0.9) { if (!globalThis.speechSynthesis)
    return false; speechSynthesis.cancel(); const voices = speechSynthesis.getVoices(); const voice = voices.find(v => v.lang === lang && v.localService) ?? voices.find(v => v.lang.startsWith('es') && v.localService); if (!voice)
    return false; const utterance = new SpeechSynthesisUtterance(text); utterance.voice = voice; utterance.lang = lang; utterance.rate = rate; speechSynthesis.speak(utterance); return true; }
