import { newId, offlineLabel } from "./platform.js";
import { ALGORITHM, DAY, VERSION, surfaceKey, evidenceCredits, kpi, kpiBySeries, localDate, matchAnswer, repairEligible } from "./engine.js";
import { answers, availableDrills, content, frames, loadContent, taskForUnit, unitFor } from "./content.js";
import { Repository, ConflictError, defaultProfile } from "./repository.js";
import { adaptivePlacement, eligibleMastered, fitSessionTime, planSession, reviewLoad, repairReady, shortenSession, stopHigherPlacement } from "./planner.js";
import { advanceScenario, scenarioTask, startRun } from "./scenario.js";
import { makeBackup, validateBackup } from "./backup.js";
import { SpeechAdapter, speak } from "./speech.js";
import { SessionSaver } from "./session-saver.js";
function el(tag, attrs = {}, ...children) { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false)
        continue;
    if (k === 'class')
        e.className = String(v);
    else if (k.startsWith('on') && typeof v === 'function')
        e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'checked')
        e.checked = !!v;
    else if (k === 'value')
        e.value = String(v);
    else if (k === 'disabled')
        e.disabled = !!v;
    else
        e.setAttribute(k, String(v));
} for (const c of children.flat())
    if (c !== null && c !== undefined && c !== false)
        e.append(c instanceof Node ? c : document.createTextNode(String(c))); return e; }
function button(text, action, style = '', attrs = {}) { return el('button', { type: 'button', class: style, ...attrs, onclick: async (e) => { const b = e.currentTarget; if (b.disabled || interactionRunning)
        return; interactionRunning = true; b.disabled = true; root.inert = true; root.setAttribute('aria-busy', 'true'); try {
        await action();
    }
    catch (error) {
        showError(error);
    }
    finally {
        interactionRunning = false;
        b.disabled = false;
        root.inert = false;
        root.removeAttribute('aria-busy');
    } } }, text); }
const p = (text, cls = '') => el('p', { class: cls }, text), notice = (text, kind = '') => p(text, 'notice ' + kind), stack = (...c) => el('div', { class: 'stack' }, ...c), row = (...c) => el('div', { class: 'row' }, ...c), section = (...c) => el('section', { class: 'section' }, ...c), card = (...c) => el('div', { class: 'card' }, ...c);
const answerForPrompt = (id) => answers.get(id) ?? answers.get(content.items.find(i => i.id === id)?.answer_set_id ?? '');
function answerForAttempt(a) { const answer = answerForPrompt(a.prompt_id); const parts = a.context_id.split(':'); if (parts[2] === 'summary' && ['main', 'alternative'].includes(parts[3])) {
    const n = content.scenarios.find(s => s.id === parts[1])?.nodes.find(n => n.id === 'summary');
    if (answer && n)
        return { ...answer, prompt_ja: n.task_by_route[parts[3]], accepted_es: [n.example_by_route[parts[3]]] };
} return answer; }
function checkbox(label, checked, onChange) { const input = el('input', { type: 'checkbox', checked, onchange: () => onChange(input.checked) }); return el('label', { class: 'check' }, input, el('span', {}, label)); }
function select(label, options, value, onChange) { const id = 'select-' + newId(); const input = el('select', { id, onchange: () => onChange(input.value) }, ...options.map(([v, t]) => el('option', { value: v }, t))); input.value = value; return el('div', {}, el('label', { for: id }, label), input); }
let repo, snapshot, profile, session = null, run = null, active = null;
let page = 'home', onboardingStep = 0, cacheReady = false, cacheVersion = '', updateReady = false, registration = null;
let busy = false, interactionRunning = false, errorMessage = '', lastFinished = null, restoreCandidate = null, libraryFilter = 'frames', query = '', libraryPage = 0;
let draftChange = 0, draftSaved = 0, draftSaveFailed = false, tickAt = performance.now(), clockPaused = true, speech = new SpeechAdapter(), speechStatus = '', transcriptConfirmed = false, feedbackMatch = null;
const sessionSaver = new SessionSaver({ saveSession: (s, expected) => repo.saveSession(s, expected) }, () => session);
const root = document.getElementById('app');
function toast(text) { const e = document.getElementById('toast'); e.textContent = text; e.classList.add('visible'); setTimeout(() => e.classList.remove('visible'), 4500); }
function showError(error) { errorMessage = error instanceof Error ? error.message : String(error); console.error(error); toast(errorMessage); if (error instanceof ConflictError) {
    void reload().then(() => { session = snapshot.sessions.find(s => s.finished_at === null) ?? null; active = null; run = null; page = 'home'; render(); });
}
else {
    let banner = document.getElementById('save-error');
    if (!banner) {
        banner = el('div', { id: 'save-error', class: 'notice error' });
        root.querySelector('main')?.prepend(banner);
    }
    banner.replaceChildren(p(errorMessage), button('現在の記録を書き出す', () => exportData(), 'small'));
} }
async function reload() { snapshot = await repo.snapshot(); profile = snapshot.profile[0] ?? defaultProfile(); }
function nav(to) { speech.stop(); globalThis.speechSynthesis?.cancel(); page = to; location.hash = to; render(); window.scrollTo(0, 0); }
function header() { return el('header', {}, el('div', { class: 'brand' }, el('span', { class: 'brand-mark', 'aria-hidden': 'true' }, 'H'), el('div', {}, el('div', { class: 'brand-title' }, 'Habla a tiempo'), p('口で話すスペイン語', 'version'))), el('span', { class: 'pill' }, '教材 1.1')); }
function render() { document.documentElement.style.fontSize = String(112.5 * (profile.text_scale ?? 1)) + '%'; root.replaceChildren(header()); if (page !== 'learn')
    root.append(el('div', { class: 'subtle-bar' }, el('span', { class: 'status-dot ' + (cacheReady ? 'ready' : '') }), offlineLabel(cacheReady, window.isSecureContext, 'serviceWorker' in navigator))); const main = el('main', { id: 'main' }); root.append(main); if (!profile.onboarded)
    renderOnboarding(main);
else if (page === 'learn' && session)
    renderLearn(main);
else if (page === 'progress')
    renderProgress(main);
else if (page === 'library')
    renderLibrary(main);
else if (page === 'settings')
    renderSettings(main);
else if (page === 'reviews')
    renderReviews(main);
else if (page === 'summary')
    renderSummary(main);
else
    renderHome(main); if (profile.onboarded && page !== 'learn') {
    const nav = el('nav', { class: 'bottom-nav', 'aria-label': 'メインメニュー' });
    for (const [id, title, symbol] of [['home', '今日', '◷'], ['progress', '進捗', '▥'], ['library', '教材', '▤'], ['settings', '設定', '⚙']])
        nav.append(button('', () => { page = id; location.hash = id; render(); window.scrollTo(0, 0); }, page === id ? 'active' : '', { 'aria-label': title }));
    [...nav.children].forEach((b, i) => { const labels = [['◷', '今日'], ['▥', '進捗'], ['▤', '教材'], ['⚙', '設定']]; b.append(el('span', { class: 'nav-symbol', 'aria-hidden': 'true' }, labels[i][0]), document.createTextNode(labels[i][1])); });
    root.append(nav);
} }
function renderOnboarding(main) {
    if (onboardingStep === 0) {
        main.append(p('BIENVENIDO', 'eyebrow'), el('h1', {}, '「分かる」を、\n口から出る一文へ。'), card(el('ol', { class: 'steps' }, ...['答えを見る前に、口で言う', '例と比べて、自分で確かめる', '時間を空けて、もう一度話す'].map((s, i) => el('li', {}, el('span', { class: 'step-index' }, '0' + (i + 1)), el('span', {}, s)))), p('35分の標準コースと、15分の短縮コース。復習が多い日は新しい項目を減らします。')), section(button('入力方法を確認する', () => { onboardingStep = 1; render(); }, 'primary')), p('発音の採点やB1認定は行いません。記録はこの端末の中に保存します。', 'scope-note'));
        return;
    }
    main.append(p('声で答える準備', 'eyebrow'), el('h1', {}, '話し方は、いつでも選べます。'), card(stack(p('端末内の自動文字起こしを試すか、iPhoneのスペイン語キーボードの音声入力を使えます。'), p('音声入力がなくても、先に口で言ってから手入力・自己照合で続けられます。'), p('標準キーボードの音声入力はOS側で通信する場合があります。アプリから音声を送信しません。', 'small-text'))), section(button('端末内の文字起こしを試す', () => { speech.start(profile.dialect, t => { toast(t); }, t => { speechStatus = t; render(); }); }, 'secondary'), speechStatus ? notice(speechStatus) : null), section(button('最初の診断を始める', async () => { profile.onboarded = true; await repo.put('profile', profile); await reload(); await beginSession('placement'); }, 'primary'), button('あとで診断して、練習を始める', async () => { profile.onboarded = true; await repo.put('profile', profile); await reload(); nav('home'); }, 'quiet')), p('診断は最大26問。途中で中断できます。1回の診断で長期保持や発音の正確さは判定しません。', 'scope-note'));
}
function renderHome(main) {
    const today = localDate(Date.now(), profile.timezone), load = reviewLoad(snapshot, Date.now()), unfinished = snapshot.sessions.find(s => s.finished_at === null), plan = planSession(snapshot, profile.mode_minutes), pending = snapshot.attempts.filter(a => a.content_result === 'needs_review').length;
    main.append(p(new Intl.DateTimeFormat('ja-JP', { timeZone: profile.timezone, month: 'long', day: 'numeric', weekday: 'long' }).format(Date.now()), 'eyebrow'), el('h1', {}, '今日も、一文から。'));
    const hero = card(row(el('span', { class: 'hero-number' }, profile.mode_minutes, el('span', {}, '分')), el('span', { class: 'pill' }, profile.mode_minutes === 15 ? '短縮コース' : '標準コース')), el('div', { class: 'mode-select', 'aria-label': '練習時間' }, ...[[35, '標準 35分'], [15, '短縮 15分']].map(([n, label]) => button(String(label), async () => { profile.mode_minutes = Number(n); await repo.put('profile', profile); render(); }, profile.mode_minutes === n ? 'selected' : ''))), p('今週の会話：' + (frames.get(plan.plan.find(t => t.frame_id)?.frame_id ?? 'F001')?.conversation_function_ja ?? '質問と聞き返し'), 'small-text'), section(button(unfinished ? '練習の続きを開く' : '今日の練習を始める', () => unfinished ? resumeSession(unfinished) : beginSession(), 'primary')));
    main.append(hero, section(el('div', { class: 'stat-grid' }, el('div', { class: 'stat' }, el('strong', {}, Math.ceil(load.seconds / 60), el('span', {}, ' 分')), el('span', {}, '今日の復習見込み')), el('div', { class: 'stat' }, el('strong', {}, plan.new_count, el('span', {}, ' 用法')), el('span', {}, plan.new_count === 0 ? '今日は復習を優先' : '今日の新しい用法')))), section(p('話す → 確かめる → 後日また話す', 'eyebrow'), el('ol', { class: 'steps' }, el('li', {}, el('span', { class: 'step-index' }, '01'), el('div', {}, p('短い文を思い出す'), p('答えを見る前の最初の発話を記録', 'small-text'))), el('li', {}, el('span', { class: 'step-index' }, '02'), el('div', {}, p('文を変えて、対話で使う'), p('自分の目的に合わせて口に出す', 'small-text'))), el('li', {}, el('span', { class: 'step-index' }, '03'), el('div', {}, p('最後にもう一度'), p('同日の練習と、翌日以降の保持を区別', 'small-text'))))));
    if (!profile.placement_completed_at)
        main.append(button('最初の診断を受ける', () => beginSession('placement'), 'secondary'));
    if (pending)
        main.append(section(button(`確認を保留した答え ${pending}件`, () => nav('reviews'), 'secondary')));
    const days = new Set(snapshot.attempts.map(a => a.local_date)).size;
    if (days >= 7)
        main.append(section(button('履歴をJSONに書き出す', () => exportData(), 'quiet')));
    if (updateReady)
        main.append(section(notice('更新の準備ができました。練習を終了してから切り替えられます。'), button('更新して開き直す', () => activateUpdate(), 'secondary')));
}
async function beginSession(kind = 'daily', custom) {
    const existing = snapshot.sessions.find(s => s.finished_at === null);
    if (existing) {
        await resumeSession(existing);
        return;
    }
    session = planSession(snapshot, profile.mode_minutes, Date.now(), kind);
    if (custom) {
        session.kind = 'practice';
        session.plan = [custom];
        session.blocks = [{ id: 'practice', label: '選んだ教材', seconds: 35 * 60 }];
    }
    await repo.saveSession(session);
    await reload();
    page = 'learn';
    location.hash = 'learn';
    active = null;
    run = null;
    await prepareTask();
}
async function resumeSession(s) { session = structuredClone(s); page = 'learn'; location.hash = 'learn'; active = null; run = null; await prepareTask(); }
async function persistSession() { await sessionSaver.save(); }
function accountTime() { const now = performance.now(); if (session && !clockPaused && !document.hidden)
    session.elapsed += Math.max(0, (now - tickAt) / 1000); tickAt = now; }
async function flushDraft() { if (!session?.draft)
    return; accountTime(); const revision = draftChange; await persistSession(); draftSaved = revision; draftSaveFailed = false; updateDraftStatus(); }
function draftStatus() { return draftSaveFailed ? '下書きを保存できません。回答を控えてください。書き出せるのは保存済みの記録です。' : draftSaved === draftChange ? '下書きを保存しました' : '下書きを保存中…'; }
function updateDraftStatus() { const e = document.getElementById('draft-save-status'); if (e)
    e.textContent = draftStatus(); }
function scheduleDraftSave() { const revision = ++draftChange; draftSaveFailed = false; updateDraftStatus(); void persistSession().then(() => { draftSaved = revision; draftSaveFailed = false; updateDraftStatus(); }).catch(error => { draftSaveFailed = true; updateDraftStatus(); showError(error); }); }
function changedDraft() { scheduleDraftSave(); }
function draft() { if (!session?.draft)
    throw Error('回答の開始状態がありません。'); return session.draft; }
async function prepareTask() {
    if (!session)
        return;
    await reload();
    if (session.cursor >= session.plan.length) {
        await finishSession();
        return;
    }
    const base = session.plan[session.cursor];
    if (base.repair_review_id && !repairReady(snapshot, base.repair_review_id, Date.now(), base.block === 7)) {
        session.cursor++;
        session.draft = null;
        await persistSession();
        await prepareTask();
        return;
    }
    active = base;
    if (base.kind !== 'scenario')
        run = null;
    if (base.kind === 'scenario') {
        const s = content.scenarios.find(x => x.id === base.scenario_id);
        run = snapshot.scenario_runs.find(r => r.session_id === session.session_id && r.task_id === base.id) ?? snapshot.scenario_runs.find(r => r.scenario_id === s.id && r.node_id !== 'end' && r.outcome === 'active') ?? null;
        if (!run) {
            run = startRun(s, session.session_id, base.id, s.required_frame_ids.every(f => eligibleMastered(snapshot).includes('FRAME:' + f)) ? 'transfer' : 'guided');
            await repo.put('scenario_runs', run);
        }
        else if (run.session_id !== session.session_id) {
            run = { ...run, session_id: session.session_id, task_id: base.id, short_turns: 0 };
            await repo.put('scenario_runs', run);
        }
        if (session.partial_summary) {
            root.replaceChildren(header(), el('main', { id: 'main' }));
            renderPartialSummary();
            return;
        }
        if (run.node_id === 'end' && !run.pending_npc) {
            session.cursor++;
            session.draft = null;
            await persistSession();
            await prepareTask();
            return;
        }
        if (run.pending_npc) {
            render();
            return;
        }
        active = scenarioTask(s, run, base.block);
        active.placement_pool = base.placement_pool;
    }
    if (run?.suspended_draft?.task_id === active.id && run.node_id !== 'repair') {
        session.draft = { ...run.suspended_draft, hint: true };
        run.suspended_draft = null;
        await repo.put('scenario_runs', run);
        await persistSession();
    }
    if (!session.draft || session.draft.task_id !== active.id) {
        const now = Date.now(), prev = Object.fromEntries(active.unit_ids.map(id => [id, snapshot.unit_state.find(u => u.unit_id === id)?.last_exposure_at ?? null]));
        const learned = Object.fromEntries(active.unit_ids.map(id => [id, (snapshot.unit_state.find(u => u.unit_id === id)?.memory_index ?? -1) >= 0]));
        session.draft = { attempt_id: newId(), task_id: active.id, started_at: now, previous_exposures: prev, learned, text: '', raw: '', edit_kind: 'none', input_mode: 'oral_self_review', hint: !!run?.hint_used, model: false, spoken: false, timing: 'unknown', pause: 'unknown', duration: 'unknown', revealed: false, first_failure: false, recognition: false, axes: [], target_form: false, interrupted: false, self_frames: [] };
        const next = { ...session, version: session.version + 1 };
        try {
            await repo.beginTask(next, { exposure_id: newId(), unit_ids: active.unit_ids, time_utc: now, kind: 'prompt', context_id: active.context_id, content_version: VERSION }, active.unit_ids.map(id => unitFor(id, now)));
            session.version = next.version;
        }
        catch (error) {
            session.draft = null;
            throw error;
        }
    }
    if (session.block_anchor !== base.block) {
        session.block_anchor = base.block;
        session.block_started_elapsed = session.elapsed;
    }
    tickAt = performance.now();
    clockPaused = false;
    transcriptConfirmed = false;
    feedbackMatch = null;
    speechStatus = '';
    render();
    window.scrollTo(0, 0);
}
function currentModel() { if (!active)
    return []; if (run && run.node_id === 'summary') {
    const s = content.scenarios.find(x => x.id === run.scenario_id);
    return [s.nodes.find(n => n.id === 'summary').example_by_route[run.follow_up_route]];
} return answers.get(active.answer_set_id ?? '')?.accepted_es ?? []; }
async function exposeModel() { if (!active || !session)
    return; const d = draft(); d.model = true; await repo.expose({ exposure_id: newId(), unit_ids: active.unit_ids, time_utc: Date.now(), kind: 'model', context_id: active.context_id, content_version: VERSION }); await flushDraft(); }
async function revealAnswer(failed = false) { const d = draft(); speech.stop(); d.raw = d.raw || d.text; if (failed) {
    d.first_failure = true;
    d.hint = true;
} d.revealed = true; feedbackMatch = active?.answer_set_id ? matchAnswer(d.text, answers.get(active.answer_set_id)) : null; transcriptConfirmed = true; if (session?.kind === 'placement' && active?.kind === 'placement')
    await flushDraft();
else if (currentModel().length)
    await exposeModel();
else
    await flushDraft(); render(); }
function renderLearn(main) {
    if (!session || !active) {
        main.append(p('練習を準備しています…'));
        return;
    }
    const base = session.plan[session.cursor], block = session.blocks[base.block] ?? session.blocks[0];
    main.append(el('div', { class: 'row between' }, p(session.kind === 'placement' ? '最初の診断' : block.label, 'eyebrow'), el('span', { class: 'timer', id: 'timer' }, timeLabel())), el('progress', { value: session.cursor, max: Math.max(1, session.plan.length), 'aria-label': '練習の進み具合' }), el('div', { class: 'row between' }, p(session.kind === 'placement' ? `あと約${Math.max(1, (session.placement_adapted ? session.plan.length : 26) - session.cursor)}問` : `${session.cursor + 1} / ${session.plan.length}`, 'small-text'), button('中断する', () => pauseSession(), 'quiet small')));
    if (run?.pending_npc) {
        main.append(section(p('相手からの返答', 'eyebrow'), el('div', { class: 'npc' }, el('p', { class: 'spanish', lang: 'es' }, run.pending_npc)), button('返答を聞く', () => { if (!speak(run.pending_npc, profile.dialect))
            toast('端末のスペイン語読み上げを利用できません。文字で確認できます。'); }, 'quiet')));
        main.append(section(button('確認して続ける', async () => { run.pending_npc = null; await repo.put('scenario_runs', run); await prepareTask(); }, 'primary')));
        return;
    }
    const d = draft();
    if (run) {
        const s = content.scenarios.find(x => x.id === run.scenario_id), n = s.nodes.find(n => n.id === run.node_id);
        if (run.node_id === 'start')
            main.append(section(p(s.title_ja, 'eyebrow'), p(`${s.context.place_ja} · 相手は${s.context.npc_role_ja}`, 'small-text'), p('目的：' + s.context.learner_goal_ja, 'small-text')));
        if (n.npc_es)
            main.append(el('div', { class: 'npc' }, p('相手の発言 · 台本', 'eyebrow'), el('p', { class: 'spanish', lang: 'es' }, n.npc_es), button('相手の発言を聞く', () => { if (!speak(n.npc_es, profile.dialect))
                toast('スペイン語の端末内音声がありません。文字で続けられます。'); }, 'quiet small')));
        if (run.node_id === 'repair') {
            const previous = s.nodes.find(n => n.id === run.return_to)?.npc_es;
            if (previous)
                main.append(card(p('直前の発言', 'eyebrow'), el('p', { class: 'spanish', lang: 'es' }, previous)));
        }
        if (run.node_id === 'summary')
            main.append(section(p('今の内容を使って、もう一つ話す', 'eyebrow'), p(run.follow_up_route === 'alternative' ? '選んだ代案について' : '今のやりとりについて', 'small-text')));
    }
    main.append(el('h1', { class: 'task-prompt ' + (active.prompt_ja.length > 50 ? 'long' : '') }, active.prompt_ja));
    if (active.intro && !d.revealed) {
        const f = frames.get(active.frame_id ?? '');
        if (f) {
            main.append(card(p('短い説明', 'eyebrow'), p(f.explanation_ja), el('p', { class: 'spanish', lang: 'es' }, f.pattern)), p('この型を見ながら3〜5回練習します。導入後の成功は補助ありとして記録します。', 'scope-note'));
            if (!d.hint) {
                d.hint = true;
                void repo.expose({ exposure_id: newId(), unit_ids: active.unit_ids, time_utc: Date.now(), kind: 'model', context_id: active.context_id, content_version: VERSION }).catch(showError);
            }
        }
    }
    if (!d.revealed)
        renderInput(main);
    else
        renderFeedback(main);
    if (session.kind !== 'placement')
        main.append(section(el('div', { class: 'row' }, session.mode_minutes !== 15 ? button('15分に切り替える', async () => { await flushDraft(); const expected = session.version, next = shortenSession(session); await repo.saveSession(next, expected); session = next; render(); }, 'quiet small') : null, button('終了の再テストへ', () => moveToRetest(), 'quiet small'))));
}
function timeLabel() { if (!session)
    return ''; const sec = Math.max(0, Math.floor(session.elapsed)); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')} / ${session.kind === 'placement' ? '約25' : session.mode_minutes}分`; }
function renderInput(main) {
    const d = draft();
    main.append(el('p', { id: 'draft-save-status', class: 'small-text', role: 'status' }, draftStatus()));
    const area = el('textarea', { id: 'answer', lang: 'es', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', placeholder: '口で言ってから入力（空欄でも自己照合できます）', value: d.text, oninput: () => { d.text = area.value; if (d.input_mode === 'oral_self_review')
            d.input_mode = 'typed'; changedDraft(); } });
    main.append(el('label', { for: 'answer' }, 'スペイン語の回答'), area, el('div', { class: 'actions' }, button('端末内で文字起こし', () => { d.input_mode = 'web_speech'; profile.consent_voice = true; void repo.put('profile', profile); speech.start(profile.dialect, text => { d.text = text; d.raw = text; area.value = text; changedDraft(); }, status => { speechStatus = status; const target = document.getElementById('speech-status'); if (target)
        target.textContent = status; }); }, 'secondary small'), button('録音を止める', () => { speech.stop(); speechStatus = '録音を止めました。回答を確認できます。'; document.getElementById('speech-status').textContent = speechStatus; }, 'quiet small')), p(speechStatus || 'iPhoneはスペイン語キーボードのマイクも使えます。', 'scope-note'), el('p', { id: 'speech-status', class: 'small-text', 'aria-live': 'polite' }));
    main.append(section(checkbox('口に出して言った（自己申告）', d.spoken, v => { d.spoken = v; changedDraft(); }), select('入力方法', [['oral_self_review', '口頭のみ・自己照合'], ['typed', '手入力'], ['keyboard_dictation', 'キーボードの音声入力'], ['web_speech', '端末内の自動文字起こし']], d.input_mode, v => { d.input_mode = v; changedDraft(); })));
    main.append(el('div', { class: 'actions' }, button('認識された文字だけ直す', () => { d.raw = d.raw || d.text; d.edit_kind = 'recognition_fix'; changedDraft(); toast('話した内容を変えず、文字起こしの誤字を直してください。'); area.focus(); }, 'quiet small'), button('考え直して答えを変える', () => { d.raw = d.raw || d.text; d.edit_kind = 'answer_revision'; changedDraft(); toast('最初の回答は残し、言い直しとして保存します。'); area.focus(); }, 'quiet small')));
    main.append(section(select('話し始めるまで（自己申告）', [['unknown', '分からない・測らない'], ['le3s', '3秒以内に話し始めた'], ['3to8s', '3秒より長い〜8秒'], ['gt8s', '8秒より長い']], d.timing, v => { d.timing = v; changedDraft(); }), select('発話中の5秒を超える停止', [['unknown', '分からない'], ['no', 'なかった'], ['yes', 'あった']], d.pause, v => { d.pause = v; changedDraft(); }), select('意味のある回答を言い終えるまで', [['unknown', '分からない・長い自由発話'], ['le15s', '15秒以内'], ['gt15s', '15秒より長い']], d.duration, v => { d.duration = v; changedDraft(); })));
    main.append(el('div', { class: 'answer-controls' }, button('話し終えた・回答を確認', () => revealAnswer(false), 'primary'), button('分からない・答えを見る', () => revealAnswer(true), 'secondary'), button('ヒントを見る', async () => { d.hint = true; await revealAnswer(true); }, 'quiet')));
}
function renderFeedback(main) {
    const d = draft(), a = active.answer_set_id ? answers.get(active.answer_set_id) : undefined;
    const own = snapshot.local_answer_overrides.find(o => o.active && [active.answer_set_id, active.context_id, active.id].includes(o.prompt_id) && surfaceKey(o.raw_es) === surfaceKey(d.text));
    if (own)
        main.append(notice('以前、この課題で自分が確認した別解です。今回の意味と文の形も自分で確かめてください。'));
    const m = feedbackMatch ?? (a ? matchAnswer(d.text, a) : null), bounded = m?.kind === 'exact_content_match' || m?.kind === 'content_match_orthography_unverified';
    const initialPlacement = session.kind === 'placement' && active.kind === 'placement';
    if (d.text)
        main.append(card(p('あなたの回答', 'eyebrow'), el('p', { class: 'spanish', lang: 'es' }, d.text)));
    const label = m?.kind === 'exact_content_match' ? '登録された答え方と一致しました。' : m?.kind === 'content_match_orthography_unverified' ? '表記の違いを除くと、登録例と一致します。' : m?.kind === 'known_error' ? m.feedback : a?.mode === 'rubric_only' || !a ? '自分の言葉で言えたか確認しよう。' : 'この答えは自動では確認できません。意味と文の形を自分で確認してください。';
    main.append(section(notice(initialPlacement ? '診断の最初の回答を記録します。' : label, !initialPlacement && m?.kind === 'known_error' ? 'warn' : '')), p(initialPlacement ? '答え方は診断終了後に確認できます。' : bounded ? '発話内容の限定照合です。発音・アクセントの正確さは採点していません。' : '内容は本人が確認した記録として保存します。', 'review-basis'));
    if (!initialPlacement) {
        const models = currentModel();
        if (models.length)
            main.append(card(p(run?.node_id === 'summary' ? '一つの答え方（事実の一致は不要）' : '答え方の例', 'eyebrow'), ...models.slice(0, 3).map(t => el('p', { class: 'spanish', lang: 'es' }, t)), button('例を聞く', async () => { await exposeModel(); if (!speak(models[0], profile.dialect))
                toast('端末のスペイン語音声を使えません。文字で確認できます。'); }, 'quiet small')));
    }
    else
        main.append(p('診断の例文は、この診断ブロックが終わってから確認できます。', 'scope-note'));
    if (active.rubric?.length)
        main.append(section(el('h2', {}, '自分で確かめるポイント'), el('ul', { class: 'rubric' }, ...active.rubric.map(t => el('li', {}, t)))));
    main.append(checkbox('意味が分かった', d.recognition, v => { d.recognition = v; changedDraft(); }));
    if (!bounded && active.unit_ids.length === 1)
        main.append(checkbox('この用法・課題の形を実際に使った', d.target_form, v => { d.target_form = v; changedDraft(); }));
    if (run) {
        const s = content.scenarios.find(x => x.id === run.scenario_id);
        const details = el('details', {}, el('summary', {}, '実際に使った型を記録する（任意）'), p('使っていない型にはチェックしません。', 'small-text'));
        for (const id of s.frame_ids) {
            const f = frames.get(id);
            details.append(checkbox(f.pattern, d.self_frames?.includes(id) ?? false, v => { d.self_frames = v ? [...new Set([...(d.self_frames ?? []), id])] : (d.self_frames ?? []).filter(x => x !== id); changedDraft(); }));
        }
        main.append(details);
    }
    if (['generation', 'transform'].includes(active.kind)) {
        const details = el('details', {}, el('summary', {}, '自分で変えて使った点（任意）'));
        for (const [id, title] of [['subject', '主語・人称'], ['time', '時点'], ['purpose', '目的']])
            details.append(checkbox(title, d.axes.includes(id), v => { d.axes = v ? [...new Set([...d.axes, id])] : d.axes.filter(x => x !== id); changedDraft(); }));
        main.append(details);
    }
    if (initialPlacement && d.first_failure) {
        main.append(button('今回は出てこなかった・次へ', () => saveAnswer('failure'), 'primary'), button('判断を保留して次へ', () => saveAnswer('needs_review'), 'quiet'));
        return;
    }
    if (d.first_failure || (!initialPlacement && m?.kind === 'known_error')) {
        const retry = el('textarea', { lang: 'es', 'aria-label': '言い直した回答', placeholder: '例を見て、一度言い直す（任意）' });
        main.append(section(p('直す点を一つ確かめて、もう一度口に出す', 'small-text'), retry));
        main.append(el('div', { class: 'answer-controls' }, button('言い直しを保存して進む', () => saveAnswer(d.first_failure ? 'failure' : 'failure', retry.value), 'primary'), button('今は保留して進む', () => saveAnswer('needs_review'), 'secondary')));
        return;
    }
    if (run && run.node_id === 'start') {
        const s = content.scenarios.find(x => x.id === run.scenario_id), n = s.nodes.find(n => n.id === 'start');
        main.append(section(el('h2', {}, '自分が伝えた意図を確認'), p('台本が続けられる内容か、自分で選んで進みます。', 'small-text')));
        for (const route of n.routes.filter(r => r.intent !== 'repair'))
            main.append(section(button(route.task_ja ?? n.task_ja ?? '目的に答えた', async () => { d.route_intent = route.intent; active.answer_set_id = route.answer_set_id; await saveAnswer('success'); }, route.follow_up_route === 'main' ? 'primary' : 'secondary')));
        main.append(button('聞き返した → 修復へ', () => goRepair(), 'quiet'), button('台本に合わない・保留して続ける', () => saveAnswer('needs_review'), 'quiet'));
        return;
    }
    main.append(el('div', { class: 'answer-controls' }, button('自力で適切に言えた', () => saveAnswer('success'), 'primary'), button('助けが必要だった', () => saveAnswer('assisted'), 'secondary'), button('判断を保留して進む', () => saveAnswer('needs_review'), 'quiet')));
    if (run && !['summary', 'repair'].includes(run.node_id))
        main.append(button('聞き返す練習へ', () => goRepair(), 'quiet'));
    if (!bounded && d.text)
        main.append(button('この課題の自分で確認した別解として保存', async () => { await repo.put('local_answer_overrides', { override_id: newId(), prompt_id: active.answer_set_id ?? active.context_id, raw_es: d.text, confirmed_by: 'self', scope: 'prompt', active: true, created_at: Date.now() }); await reload(); toast('この課題だけの別解として保存しました。設定から取り消せます。'); }, 'quiet small'));
}
async function saveAnswer(result, retry = '') {
    if (busy || !session || !active)
        return;
    busy = true;
    try {
        await flushDraft();
        accountTime();
        const d = draft(), now = Date.now(), a = answers.get(active.answer_set_id ?? '');
        const matched = a ? matchAnswer(d.text, a) : null, bounded = matched?.kind === 'exact_content_match' || matched?.kind === 'content_match_orthography_unverified';
        if (result === 'success' && (d.hint || d.edit_kind === 'answer_revision'))
            result = 'assisted';
        if (d.first_failure && result !== 'needs_review')
            result = 'failure';
        if (result === 'success' && !d.text.trim() && !d.spoken) {
            toast('口で言った場合は「口に出して言った」を確認してください。未回答なら保留で進められます。');
            return;
        }
        if (result === 'success' && matched?.kind === 'known_error')
            result = 'failure';
        const manual = [];
        if (d.target_form && active.unit_ids.length === 1)
            manual.push(active.unit_ids[0]);
        if (run)
            manual.push(...(d.self_frames ?? []).map(id => 'FRAME:' + id));
        if (active.kind === 'transform' && a?.packet_drill_evidence_id && (bounded || d.target_form))
            manual.push('PACKET:' + a.packet_drill_evidence_id);
        let credits = a ? evidenceCredits(a, matched?.variant ?? null, manual) : manual;
        if (result !== 'success')
            credits = [];
        // A successful alternate construction credits communication separately, never unused form/source links.
        if (result === 'success' && credits.length === 0) {
            const id = 'COMM:' + (run?.family_id ?? active.frame_id ?? active.id.replace(/[^a-zA-Z0-9_:.-]/g, ''));
            credits = [id];
        }
        const assessed = run ? ['COMM:' + run.family_id] : active.unit_ids;
        for (const unit of [...new Set([...credits, ...assessed])])
            if (!snapshot.units.some(u => u.unit_id === unit))
                await repo.put('units', unitFor(unit, now));
        const prior = active.unit_ids.map(id => d.previous_exposures[id]).filter((v) => v !== null && v !== undefined), previous = prior.length ? Math.max(...prior) : null;
        const first = !snapshot.attempts.some(x => x.local_date === session.date_local && x.observed_unit_ids.some(id => active.unit_ids.includes(id)) && x.mode !== 'placement');
        const long = active.prompt_ja.length > 32 || a?.timing_prompt_eligible === false || run?.node_id === 'summary' || !!active.rubric && !a;
        const initialMode = session.kind === 'placement' ? 'placement' : active.kind === 'retest' ? 'recall' : active.kind;
        const selfTiming = d.timing !== 'unknown' || result === 'failure';
        const attempt = { attempt_id: d.attempt_id, session_id: session.session_id, prompt_id: active.placement_item_id ?? (active.answer_set_id ?? active.id), credited_unit_ids: credits, observed_unit_ids: active.unit_ids, frame_ids: active.frame_id ? [active.frame_id] : run ? content.scenarios.find(s => s.id === run.scenario_id).frame_ids : [], source_ids: active.unit_ids.filter(id => id.startsWith('SRC:')).map(id => id.split(':')[1]), context_id: active.context_id, started_at: d.started_at, ended_at: now, timezone: session.timezone, local_date: session.date_local, mode: initialMode, input_mode: d.input_mode, raw_transcript: d.raw || d.text || null, corrected_transcript: d.edit_kind !== 'none' ? d.text : null, transcript_edit_kind: d.edit_kind, normalization_profile: 'es_content_v1', matched_variant: matched?.variant ?? null, content_result: result, content_basis: bounded ? 'bounded_content' : result === 'needs_review' ? 'unresolved' : 'self_reviewed', spoken_confirmed: d.spoken, target_form_used: d.target_form || credits.some(id => id.startsWith('FRAME:')), first_attempt: first, hint_before_answer: d.hint, model_seen: d.model, latency_ms: null, latency_bucket: d.timing === 'unknown' ? null : d.timing, timing_basis: selfTiming ? 'self_reported' : 'unavailable', within_turn_pause_gt5s: d.pause === 'unknown' ? null : d.pause === 'yes', response_duration_ms: d.duration === 'le15s' ? 15000 : d.duration === 'gt15s' ? 16000 : null, previous_exposure_at: previous, gap_seconds: previous === null ? null : Math.max(0, (d.started_at - previous) / 1000), preselected_probe: !!active.probe, kpi_eligible: false, exclusion_reason: null, assessment_revision: 0, supersedes_revision: null, algorithm_version: ALGORITHM, content_version: VERSION, learned_before: active.unit_ids.some(id => d.learned[id]), short_prompt: !long, changed_axes: d.axes, family_id: run?.family_id, spontaneous: !!run && run.mode === 'transfer' && !run.hint_used && !d.hint, interrupted: d.interrupted, clock_anomaly: now < d.started_at - 60000, recognition_confirmed: d.recognition, retry_transcript: retry || undefined, probe_cohort: active.cohort, placement_pool: active.placement_pool, placement_phase: active.phase };
        attempt.assessed_unit_ids = assessed;
        attempt.repair_review_id = active.repair_review_id;
        attempt.contaminated = !!active.probe && active.probe_reserved_exposure_at !== undefined && previous !== active.probe_reserved_exposure_at;
        if (active.kind === 'retest' || active.kind === 'repair') {
            const prev = snapshot.attempts.filter(x => x.observed_unit_ids.some(id => active.unit_ids.includes(id))).at(-1);
            if (prev && prev.local_date === session.date_local) {
                const middle = new Set(snapshot.attempts.filter(x => x.ended_at > prev.ended_at && !x.observed_unit_ids.some(id => active.unit_ids.includes(id))).map(x => x.prompt_id)).size;
                const count = snapshot.attempts.filter(x => x.local_date === session.date_local && (!!x.repair_review_id || x.mode === 'repair') && x.observed_unit_ids.some(id => active.unit_ids.includes(id))).length;
                if (!repairEligible(prev.ended_at, now, middle, count)) {
                    attempt.mode = 'short_lag_retest';
                    attempt.exclusion_reason = 'short_lag';
                }
            }
        }
        attempt.kpi_eligible = attempt.preselected_probe && attempt.learned_before && (attempt.gap_seconds ?? 0) >= 86400 && attempt.short_prompt && !attempt.interrupted && !attempt.clock_anomaly && !attempt.contaminated;
        if (attempt.preselected_probe && !attempt.kpi_eligible)
            attempt.exclusion_reason = attempt.contaminated ? 'contaminated' : attempt.interrupted ? 'interrupted' : attempt.clock_anomaly ? 'clock_anomaly' : (attempt.gap_seconds ?? 0) < 86400 ? 'prior_exposure' : 'ineligible';
        let nextRun = run ? structuredClone(run) : undefined;
        let next = structuredClone(session);
        const expected = next.version;
        next.version++;
        next.draft = null;
        let advance = true;
        if (run) {
            const scenario = content.scenarios.find(s => s.id === run.scenario_id);
            if (run.node_id === 'start' && !d.route_intent) {
                // Unresolved route stays at the same node; no invented branch or silent success.
                nextRun = { ...run, version: run.version + 1 };
                advance = false;
            }
            else {
                nextRun = advanceScenario(scenario, run, d.route_intent, result === 'success', now);
                advance = nextRun.node_id === 'end' && !nextRun.pending_npc;
            }
            if (nextRun && session.mode_minutes === 15 && session.kind !== 'placement' && (nextRun.short_turns ?? 0) >= 2 && nextRun.node_id !== 'end' && !['summary', 'repair'].includes(nextRun.node_id)) {
                next.partial_summary = true;
                advance = false;
            }
        }
        if (!run || advance) {
            next.cursor++;
            next = fitSessionTime(next);
        }
        if (session.kind === 'placement' && !next.placement_adapted && next.cursor >= 12) {
            next.plan.push(...adaptivePlacement([...snapshot.attempts.filter(a => a.session_id === session.session_id), attempt]));
            next.placement_adapted = true;
        }
        if (session.kind === 'placement')
            next.plan = stopHigherPlacement(next.plan, [...snapshot.attempts.filter(a => a.session_id === session.session_id), attempt], next.cursor);
        let review;
        if (!active.repair_review_id && (['failure', 'assisted', 'needs_review'].includes(result) || attempt.mode === 'short_lag_retest'))
            review = { review_id: newId(), attempt_id: attempt.attempt_id, unit_ids: attempt.observed_unit_ids, error_type: result === 'needs_review' ? 'needs_review' : attempt.mode === 'short_lag_retest' ? 'short_lag_retest' : 'recall_repair', correction: matched?.feedback ?? '', repair_due: now + (attempt.mode === 'short_lag_retest' ? DAY : result === 'needs_review' ? DAY : 600000), closed_at: null, self_or_bounded: attempt.content_basis, created_at: now, context_id: attempt.context_id, repair_count: 0 };
        await repo.commit(attempt, next, expected, nextRun, review);
        session = next;
        run = nextRun ?? null;
        await reload();
        if (next.partial_summary && run) {
            renderPartialSummary();
            return;
        }
        if (run && run.node_id === 'start' && !d.route_intent) {
            await prepareTask();
            toast('保留で保存しました。実際に伝えた意図を確認するか、中断できます。');
            return;
        }
        await prepareTask();
    }
    finally {
        busy = false;
    }
}
function renderPartialSummary() {
    if (!run || !session)
        return;
    const main = root.querySelector('main');
    main.replaceChildren(p('短縮コース · ここまでの対話', 'eyebrow'), el('h1', {}, '今聞いた内容を、一文で。'), p('実際に聞いた情報だけを使って、相手が伝えたことや次にすることを口に出しましょう。未到達の結末は使いません。'), p('続きの対話は保存されています。', 'scope-note'));
    const confirmed = checkbox('今聞いた内容と矛盾しない一文を口で言った', false, () => { });
    main.append(section(confirmed, button('ここまでを保存して次へ', async () => { await recordPartial(!!confirmed.querySelector('input')?.checked); }, 'primary'), button('今回は保留して次へ', () => recordPartial(false), 'quiet')));
}
async function recordPartial(ok) { if (!session || !run)
    return; const old = run; session.partial_summary = false; session.cursor++; session.draft = null; await persistSession(); await repo.put('reviews', { review_id: newId(), attempt_id: snapshot.attempts.filter(a => a.session_id === session.session_id).at(-1).attempt_id, unit_ids: [], error_type: 'partial_scenario_followup', correction: ok ? 'この時点で聞いた内容について一文を口頭で説明した（自己申告）' : '短縮時の一文は保留', repair_due: 0, closed_at: Date.now(), self_or_bounded: 'self_reviewed', created_at: Date.now(), context_id: VERSION + ':' + old.scenario_id + ':partial:' + old.follow_up_route, repair_count: 0 }); run = null; await prepareTask(); }
async function goRepair() {
    if (!session || !run)
        return;
    await flushDraft();
    const scenario = content.scenarios.find(s => s.id === run.scenario_id);
    if (session.draft?.text || session.draft?.spoken) {
        const d = session.draft;
        run.suspended_draft = structuredClone(d);
    }
    const next = advanceScenario(scenario, run, 'repair');
    run = next;
    session.draft = null;
    await repo.put('scenario_runs', run);
    await persistSession();
    await prepareTask();
}
async function pauseSession() { speech.stop(); accountTime(); clockPaused = true; await flushDraft(); await reload(); nav('home'); toast('ここまでの回答と再開位置を保存しました。'); }
async function moveToRetest() { if (!session)
    return; speech.stop(); await flushDraft(); accountTime(); const start = session.plan.findIndex((t, i) => i > session.cursor && t.block === 8); if (start < 0) {
    await finishSession();
    return;
} session.unfinished_ids.push(...session.plan.slice(session.cursor, start).map(t => t.id)); session.cursor = start; session.draft = null; run = null; await persistSession(); await prepareTask(); }
async function finishSession() {
    if (!session)
        return;
    speech.stop();
    accountTime();
    clockPaused = true;
    session.finished_at = Date.now();
    session.draft = null;
    await persistSession();
    lastFinished = session.session_id;
    if (session.kind === 'placement') {
        const as = snapshot.attempts.filter(a => a.session_id === session.session_id);
        profile.placement_completed_at = Date.now();
        profile.max_phase = Math.max(0, ...as.filter(a => a.content_result === 'success' && a.spoken_confirmed && ['anchor', 'adaptive'].includes(a.placement_pool ?? '')).map(a => a.placement_phase ?? 0));
        await repo.put('profile', profile);
    }
    await reload();
    const mastered = new Set(eligibleMastered(snapshot));
    for (let phase = profile.max_phase; phase < 3; phase++) {
        const current = content.frames.filter(f => f.phase === phase);
        if (current.length && current.filter(f => mastered.has('FRAME:' + f.id)).length >= Math.min(6, current.length)) {
            profile.max_phase = phase + 1;
        }
        else
            break;
    }
    await repo.put('profile', profile);
    session = null;
    active = null;
    run = null;
    nav('summary');
}
function renderSummary(main) {
    const s = snapshot.sessions.find(s => s.session_id === lastFinished) ?? snapshot.sessions.filter(s => s.finished_at).at(-1);
    const as = snapshot.attempts.filter(a => a.session_id === s?.session_id), success = as.filter(a => a.content_result === 'success').length, pending = as.filter(a => a.content_result === 'needs_review').length;
    main.append(p('HASTA LA PRÓXIMA', 'eyebrow'), el('h1', {}, '今日の一文を、また明日。'), card(p('保存が完了しました。'), el('div', { class: 'stat-grid section' }, el('div', { class: 'stat' }, el('strong', {}, as.length), el('span', {}, '記録した発話・回答')), el('div', { class: 'stat' }, el('strong', {}, pending), el('span', {}, '確認を保留'))), p(`自力で適切な回答 ${success}件。口に出したか、時間の根拠は各記録で分けています。`, 'scope-note')), section(notice('同日の再テストは練習の記録です。24時間以上空けた保持の成績には入りません。')), section(p(`次の3日間の復習見込み：${reviewLoad(snapshot, Date.now()).forecast.map(n => Math.ceil(n / 60) + '分').join(' / ')}`, 'small-text')), section(button('今日の画面へ', () => nav('home'), 'primary'), button('保留の答えを確認する', () => nav('reviews'), 'quiet')));
    if (s?.kind === 'placement') {
        main.append(section(el('h2', {}, '診断の答え方を確認する')));
        for (const a of as.filter(a => a.mode === 'placement' && answerForAttempt(a))) {
            const ans = answerForAttempt(a);
            main.append(el('details', { ontoggle: async (e) => { if (e.currentTarget.open)
                    await ensureExposure(a.observed_unit_ids, a.context_id, 'readback'); } }, el('summary', {}, ans.prompt_ja), p(a.raw_transcript ?? '口頭のみ', 'spanish'), p(ans.accepted_es[0], 'spanish'), p('元の試行は保持します。判定を変える場合は「保留の答え」から訂正します。', 'small-text')));
        }
    }
}
const stages = ['未学習', '意味が分かる', '日本語から出せる', '文の中で使える', '場面で自発的に使える', '数秒で出せる', '長期保持を確認'];
function metricCard(as, label) { const result = kpi(as); return card(p(label, 'eyebrow'), el('div', { class: 'metric' }, result.rate === null ? '—' : Math.round(result.rate * 100) + '%'), p(result.denominator ? `${result.numerator} / ${result.denominator}件` : '測定を準備中'), p(`開始 ${result.started}件 · 保留・未判定 ${result.pending}件 · 事前接触 ${result.contaminated}件 · 判定カバー率 ${result.coverage === null ? '—' : Math.round(result.coverage * 100) + '%'}`, 'scope-note'), result.denominator < 20 ? p('参考値・件数不足（20件未満）', 'small-text') : null); }
function renderProgress(main) {
    const recent = snapshot.attempts.filter(a => a.ended_at >= Date.now() - 28 * DAY), series = kpiBySeries(recent.filter(a => a.preselected_probe));
    main.append(p('少し時間を空けて、確かめる', 'eyebrow'), el('h1', {}, '練習の記録'), p('遅延自力即答率', 'muted'), p('24時間以上触れずに、短い文を3秒以内に言い始められた割合。最近28日間。', 'scope-note'));
    const keys = Object.keys(series);
    if (!keys.length)
        main.append(section(metricCard([], '自己申告の速度 / 内容の確認')));
    for (const key of keys) {
        const [timing, basis] = key.split('/');
        main.append(section(metricCard(recent.filter(a => a.timing_basis === timing && a.content_basis === basis), `${timing === 'self_reported' ? '自己申告の速度' : timing === 'validated_local_onset' ? '検証済み端末計測' : '時間未計測'} / ${basis === 'bounded_content' ? '登録回答との照合' : basis === 'self_reviewed' ? '内容は自己確認' : '内容は保留'}`)));
    }
    main.append(p('端末による発話開始の機械計測：未計測。入力速度や文字起こしの到着時刻は使いません。', 'scope-note'));
    const cohort = snapshot.attempts.find(a => a.preselected_probe)?.probe_cohort;
    if (cohort)
        main.append(section(metricCard(recent.filter(a => a.probe_cohort === cohort), '学習開始時の固定コホート ' + cohort)));
    const retention = recent.filter(a => a.content_result === 'success' && a.spoken_confirmed && !a.hint_before_answer && !a.clock_anomaly && !a.interrupted);
    main.append(section(el('div', { class: 'stat-grid' }, el('div', { class: 'stat' }, el('strong', {}, retention.filter(a => (a.gap_seconds ?? 0) >= 604800).length), el('span', {}, '7日以上無接触の成功')), el('div', { class: 'stat' }, el('strong', {}, retention.filter(a => (a.gap_seconds ?? 0) >= 2592000).length), el('span', {}, '30日以上無接触の成功')))));
    const dates = new Set(snapshot.attempts.map(a => a.local_date));
    main.append(section(p(`${dates.size}日の練習記録`, 'eyebrow'), el('div', { class: 'retention-days' }, ...Array.from({ length: 14 }, (_, i) => { const date = localDate(Date.now() - (13 - i) * DAY, profile.timezone); return el('i', { class: dates.has(date) ? 'on' : '', title: date, 'aria-label': date + (dates.has(date) ? ' 練習あり' : '') }); })), p('練習日数は能力の点数ではありません。', 'scope-note')));
    main.append(section(el('h2', {}, '用法ごとの証拠')));
    const units = snapshot.unit_state.filter(u => u.facets.evidence?.length).sort((a, b) => b.current_stage - a.current_stage);
    if (!units.length)
        main.append(p('学習を始めると、想起・生成・転移・保持の証拠が表示されます。', 'empty'));
    for (const u of units.slice(0, 30)) {
        const title = snapshot.units.find(x => x.unit_id === u.unit_id)?.sense_label ?? u.unit_id;
        main.append(el('details', {}, el('summary', {}, title + ' · ' + stages[u.current_stage]), p(u.provisional ? '診断による暫定評価。翌日・7日後に確認します。' : `最高到達：${stages[u.best_stage]}`, 'small-text'), el('div', { class: 'progress-facets' }, ...Object.entries({ 想起: u.facets.recall_contexts ?? 0, 生成: u.facets.generation_contexts ?? 0, 転移: u.facets.spontaneous_families ?? 0, 速度: `${u.facets.speed_success_last10 ?? 0}/${u.facets.speed_n ?? 0}`, 保持7日: u.facets.retention7 ? 'あり' : '未確認', 保持30日: u.facets.retention30 ? 'あり' : '未確認' }).map(([k, v]) => el('div', {}, p(k), el('strong', {}, String(v))))), p(`次の記憶復習：${u.due_at ? new Date(u.due_at).toLocaleString('ja-JP', { timeZone: profile.timezone }) : '未設定'}${u.due_at && u.due_at < Date.now() ? ' · 期日到来（忘却を断定しません）' : ''}`, 'scope-note'), ...u.facets.evidence.slice(-5).map(e => p(`${e.date} · ${e.mode} · ${e.success ? '自力成功' : '練習・不成功'} · 接触間隔 ${Math.floor(e.gap / 3600)}時間`, 'small-text'))));
    }
    main.append(section(button('保留・訂正の記録を開く', () => nav('reviews'), 'secondary')));
}
function renderLibrary(main) {
    main.append(p('必要な用法を、必要なときに', 'eyebrow'), el('h1', {}, '教材'), el('div', { class: 'filter-group' }, ...[["frames", "60の文型"], ["sources", "3,000の用法"], ["scenarios", "96の対話"], ["verbs", "24の動詞"]].map(([id, label]) => button(label, () => { libraryFilter = id; libraryPage = 0; render(); }, 'small', { 'aria-pressed': libraryFilter === id }))));
    const search = el('input', { type: 'search', value: query, placeholder: '元番号・日本語・スペイン語で検索', 'aria-label': '教材を検索', oninput: () => { query = search.value; libraryPage = 0; renderLibraryResults(results); } }), results = el('div', {});
    main.append(section(search), results);
    renderLibraryResults(results);
}
function renderLibraryResults(results) {
    results.replaceChildren();
    const filter = (text) => text.toLowerCase().includes(query.toLowerCase()), mastered = eligibleMastered(snapshot);
    if (libraryFilter === 'frames') {
        const list = content.frames.filter(f => filter(f.id + ' ' + f.pattern + ' ' + f.conversation_function_ja));
        for (const f of list.slice(libraryPage * 15, libraryPage * 15 + 15)) {
            const locked = !f.prerequisites.every(id => mastered.includes('FRAME:' + id));
            const detail = el('details', { ontoggle: async () => { if (detail.open) {
                    await ensureExposure(['FRAME:' + f.id], VERSION + ':' + f.id + ':library', 'readback');
                } } }, el('summary', {}, f.id + ' · ' + f.conversation_function_ja), p(f.pattern, 'spanish'), p(f.explanation_ja), locked ? notice('自動導入は前提の用法を練習してから。目的を示した練習には入れます。') : null, button('この型で練習する', () => practiceFrame(f.id), 'secondary'), button('自分のことを話す', () => beginSession('practice', { id: f.id + ':free', kind: 'generation', unit_ids: ['FRAME:' + f.id], frame_id: f.id, prompt_ja: f.meaningful_generation_prompt_ja, context_id: VERSION + ':' + f.id + ':free', phase: f.phase, block: 0, rubric: f.meaningful_generation_rubric_ja, estimated_seconds: 60 }), 'quiet'));
            results.append(detail);
        }
        pages(results, list.length);
    }
    if (libraryFilter === 'sources') {
        const list = content.sources.filter(s => filter(s.source_id + ' ' + s.term + ' ' + s.meaning_ja));
        for (const s of list.slice(libraryPage * 15, libraryPage * 15 + 15)) {
            const unit = 'SRC:' + s.source_id + ':example0';
            const detail = el('details', { ontoggle: async () => { if (detail.open)
                    await ensureExposure([unit], VERSION + ':' + unit + ':library', 'readback'); } }, el('summary', {}, s.source_id + ' · ' + s.term + ' — ' + s.meaning_ja), p(s.priority_band + ' · ' + s.reason_ja, 'small-text'), p(s.practice_example_es, 'spanish'), p(s.practice_example_ja), p('この一用法だけを自己照合で確かめます。元番号は学習順ではありません。', 'scope-note'), button('この用法を練習する', () => beginSession('practice', { ...taskForUnit(unit, 0, 'recall', 0, mastered), intro: false }), 'secondary'), button('自動出題を保留する', async () => { const u = snapshot.units.find(x => x.unit_id === unit) ?? unitFor(unit); await repo.put('units', { ...u, active: false, paused: true }); await reload(); toast('自動出題の対象から外しました。履歴は残しています。'); }, 'quiet'));
            results.append(detail);
        }
        pages(results, list.length);
    }
    if (libraryFilter === 'scenarios') {
        const list = content.scenarios.filter(s => filter(s.id + ' ' + s.title_ja));
        for (const s of list.slice(libraryPage * 12, libraryPage * 12 + 12)) {
            const seen = snapshot.exposures.some(e => e.content_version === VERSION && e.context_id.includes(':' + s.id + ':'));
            results.append(el('div', { class: 'list-item' }, p(s.title_ja), p(`${s.id} · ${seen ? '既出の条件' : 'まだ練習していない条件'}`, 'small-text'), button('この場面を練習する', () => beginSession('practice', { id: s.id, kind: 'scenario', unit_ids: s.frame_ids.map(id => 'FRAME:' + id), scenario_id: s.id, prompt_ja: s.context.learner_goal_ja, context_id: VERSION + ':' + s.id, phase: s.phase, block: 0, estimated_seconds: 300 }), 'secondary small')));
        }
        pages(results, list.length);
    }
    if (libraryFilter === 'verbs') {
        for (const v of content.verb_packets.filter(v => filter(v.lemma + ' ' + v.id))) {
            const details = el('details', {}, el('summary', {}, v.lemma), p(v.semantic_note_ja), el('p', { class: 'spanish', lang: 'es' }, v.present.join(' / ')));
            for (const d of v.drills) {
                const a = answers.get(d.answer_set_id);
                details.append(button(d.prompt_ja, () => beginSession('practice', { id: d.id, kind: 'transform', unit_ids: ['PACKET:' + a.packet_drill_evidence_id], answer_set_id: d.answer_set_id, prompt_ja: d.prompt_ja, context_id: VERSION + ':' + d.context_id, phase: 1, block: 0, estimated_seconds: 40 }), 'quiet'));
            }
            results.append(details);
        }
    }
}
function pages(container, total) { if (total > 15)
    container.append(section(row(button('前へ', () => { libraryPage = Math.max(0, libraryPage - 1); render(); }, 'quiet', { disabled: libraryPage === 0 }), p(`${libraryPage + 1} / ${Math.ceil(total / (libraryFilter === 'scenarios' ? 12 : 15))}`, 'small-text'), button('次へ', () => { libraryPage++; render(); }, 'quiet', { disabled: (libraryPage + 1) * (libraryFilter === 'scenarios' ? 12 : 15) >= total })))); }
async function practiceFrame(id) { const existing = snapshot.sessions.find(s => s.finished_at === null); if (existing) {
    await resumeSession(existing);
    return;
} const f = frames.get(id), mastered = eligibleMastered(snapshot); await beginSession('practice', taskForUnit('FRAME:' + id, 0, 'generation', 0, mastered)); if (session?.kind === 'practice') {
    session.plan = availableDrills(f, mastered).map((d, i) => ({ ...taskForUnit('FRAME:' + id, i, 'generation', 0, mastered), intro: i === 0 }));
    await persistSession();
    await prepareTask();
} }
async function ensureExposure(ids, context, kind) { for (const id of ids)
    if (!snapshot.units.some(u => u.unit_id === id))
        await repo.put('units', { ...unitFor(id), active: false }); await repo.expose({ exposure_id: newId(), unit_ids: ids, time_utc: Date.now(), kind, context_id: context, content_version: VERSION }); await reload(); }
function renderReviews(main) {
    main.append(p('元の回答を残して、確かめる', 'eyebrow'), el('h1', {}, '保留と修復'), button('進捗へ戻る', () => nav('progress'), 'quiet'));
    const rows = snapshot.attempts.filter(a => ['needs_review', 'failure', 'assisted'].includes(a.content_result) || a.revision_history?.length).sort((a, b) => b.ended_at - a.ended_at);
    if (!rows.length)
        main.append(p('確認を保留した回答はありません。', 'empty'));
    for (const a of rows.slice(0, 40)) {
        const answer = answerForAttempt(a);
        let confirmedForm = false;
        const box = el('div', { class: 'list-item' }, p(answer?.prompt_ja ?? a.context_id), p(a.corrected_transcript ?? a.raw_transcript ?? '口頭で回答', 'spanish'), p(`${a.local_date} · ${a.content_result === 'needs_review' ? '判定保留' : a.content_result === 'assisted' ? '補助あり' : '修復・訂正'} · 教材 ${a.content_version}`, 'small-text'));
        if (answer)
            box.append(el('details', { ontoggle: async (e) => { if (e.currentTarget.open)
                    await ensureExposure(a.observed_unit_ids, a.context_id, 'readback'); } }, el('summary', {}, '例と比べる'), ...answer.accepted_es.slice(0, 2).map(t => p(t, 'spanish'))));
        if (a.observed_unit_ids.length === 1)
            box.append(checkbox('記録された最初の回答で、この用法の形を使った', false, v => { confirmedForm = v; }));
        box.append(button('自己確認して「適切な回答」に訂正', async () => { const m = answer ? matchAnswer(a.corrected_transcript ?? a.raw_transcript ?? '', answer) : null; const credits = answer ? evidenceCredits(answer, m?.variant ?? null, confirmedForm ? a.observed_unit_ids : []) : confirmedForm ? a.observed_unit_ids : []; for (const id of credits)
            if (!snapshot.units.some(u => u.unit_id === id))
                await repo.put('units', unitFor(id)); await repo.correctAttempt(a.attempt_id, 'success', '後日の自己照合で内容を確認', credits); await reload(); render(); toast('訂正前の結果と、訂正イベントを残しました。'); }, 'secondary small'), button('取り出せなかった・修復へ', async () => { await repo.correctAttempt(a.attempt_id, 'failure', '本人が想起失敗を確認', []); await reload(); render(); }, 'quiet small'));
        if (a.revision_history)
            for (const r of a.revision_history)
                box.append(p(`訂正 ${r.revision + 1}：元の結果 ${r.result} → ${r.reason}`, 'scope-note'));
        main.append(box);
    }
}
function renderSettings(main) {
    main.append(p('この端末の練習環境', 'eyebrow'), el('h1', {}, '設定'), section(select('標準の練習時間', [['15', '短縮 15分'], ['30', '標準 30分'], ['35', '標準 35分'], ['40', '標準 40分']], String(profile.mode_minutes), async (v) => { profile.mode_minutes = Number(v); await repo.put('profile', profile); toast('練習時間を保存しました。'); }), select('スペイン語の音声', [['es-ES', 'スペイン（es-ES）'], ['es-MX', 'メキシコ（es-MX）']], profile.dialect, async (v) => { profile.dialect = v; await repo.put('profile', profile); }), select('記録の日付を区切る地域', [['Asia/Tokyo', '日本'], ['Europe/Madrid', 'スペイン・マドリード'], ['America/Mexico_City', 'メキシコシティ'], ['UTC', 'UTC']], profile.timezone, async (v) => { profile.timezone = v; profile.settings_version++; await repo.put('profile', profile); toast('今後の記録に適用しました。過去の日付は変えません。'); })));
    main.append(section(select('文字の大きさ', [['1', '標準'], ['1.5', '150%'], ['2', '200%']], String(profile.text_scale ?? 1), async (v) => { profile.text_scale = Number(v); await repo.put('profile', profile); render(); })));
    const domains = section(el('h2', {}, 'よく話したいこと'));
    for (const [id, label] of [['university', '大学'], ['work', '仕事'], ['friends', '友人'], ['hobbies', '趣味'], ['music', 'バイオリン・音楽'], ['fitness', 'ジム']])
        domains.append(checkbox(label, profile.interest_domains.includes(id), async (v) => { profile.interest_domains = v ? [...new Set([...profile.interest_domains, id])] : profile.interest_domains.filter(x => x !== id); await repo.put('profile', profile); }));
    main.append(domains);
    main.append(section(el('h2', {}, '履歴のバックアップ'), p('端末のデータは失われることがあります。JSONを書き出して、手元に保管してください。外部への自動送信はありません。', 'small-text'), section(button('JSONバックアップを書き出す', () => exportData(), 'primary')), button('ファイルへの保存を確認した', async () => { await repo.put('meta', { key: 'last_backup_at', value: Date.now() }); toast('保存を確認した日を記録しました。'); }, 'quiet small')));
    const file = el('input', { type: 'file', accept: '.json,application/json', id: 'restore-file', onchange: async () => { const selected = file.files?.[0]; if (!selected)
            return; try {
            if (selected.size > 20 * 1024 * 1024)
                throw Error('20MBを超えるファイルは復元できません。');
            restoreCandidate = await validateBackup(await selected.text());
            render();
        }
        catch (e) {
            showError(e);
        }
        finally {
            file.value = '';
        } } });
    main.append(section(el('label', { for: 'restore-file' }, 'バックアップから復元（現在のデータを置換）'), file));
    if (restoreCandidate)
        main.append(section(card(el('h2', {}, '復元内容の確認'), p(`回答 ${snapshot.attempts.length} → ${restoreCandidate.attempts.length}件`), p(`学習単位 ${snapshot.units.length} → ${restoreCandidate.units.length}件`), p(`教材版 ${restoreCandidate.content_version} / ${restoreCandidate.checksum ? '整合性チェック済み' : 'チェックサムなし'}`, 'small-text'), notice('現在の記録を先に書き出してから、この端末の履歴を置き換えます。'), button('現在の記録を退避して、置換する', async () => { if (!restoreCandidate)
            return; await exportData(); await repo.replace(restoreCandidate); restoreCandidate = null; session = null; active = null; run = null; await reload(); nav('home'); toast('復元が完了しました。'); }, 'primary'), button('キャンセル', () => { restoreCandidate = null; render(); }, 'quiet'))));
    main.append(section(el('h2', {}, '端末の保存とオフライン'), p(cacheReady ? '必要な教材と画面のキャッシュは取得済みです。' : offlineLabel(false, window.isSecureContext, 'serviceWorker' in navigator), 'small-text'), button('保存の永続化を端末に依頼', async () => { if (!navigator.storage?.persist) {
        toast('この端末は永続化の要求に対応していません。手動バックアップをご利用ください。');
        return;
    } const ok = await navigator.storage.persist(); toast(ok ? '端末から永続化の許可を得ました。バックアップも続けてください。' : '永続化は許可されませんでした。バックアップで記録を守れます。'); }, 'secondary'), button('更新とキャッシュ状態を確認', async () => { if (!registration) {
        toast(offlineLabel(false, window.isSecureContext, 'serviceWorker' in navigator));
        return;
    } try {
        await registration.update();
        await checkCache();
        render();
    }
    catch {
        toast('更新元に接続できません。保存済みの内容で続けられます。');
    } }, 'quiet'), p('SafariでHTTPSのアプリURLを開き、「オフラインで練習できます」の表示後、共有メニューからホーム画面に追加します。初回保存後は、通信がない場所でも練習できます。HTTP接続ではオフライン保存を利用できません。', 'scope-note')));
    if (updateReady)
        main.append(button('更新して開き直す', () => activateUpdate(), 'secondary'));
    const overrides = snapshot.local_answer_overrides.filter(o => o.active);
    if (overrides.length) {
        main.append(section(el('h2', {}, '自分で確認した別解')));
        for (const o of overrides)
            main.append(el('div', { class: 'list-item' }, p(o.raw_es, 'spanish'), p(o.prompt_id, 'small-text'), button('この別解を取り消す', async () => { await repo.put('local_answer_overrides', { ...o, active: false }); await reload(); render(); }, 'quiet small')));
    }
    main.append(section(p('アプリ・教材 1.1.0 · 記憶ラダー 1 / 3 / 7 / 14 / 30 / 60 / 120日', 'scope-note'), p('自動文字起こしと読み上げは、端末内の処理を確認できる場合に使います。標準キーボードの音声入力は、OSの設定によって通信する場合があります。', 'scope-note')));
}
async function exportData() {
    await sessionSaver.idle().catch(() => { });
    const current = await repo.snapshot(), backup = await makeBackup(current);
    const file = new File([JSON.stringify(backup, null, 2)], 'habla-backup-' + localDate(Date.now(), profile.timezone) + '.json', { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) {
        try {
            await navigator.share({ files: [file], title: 'Hablaの学習履歴' });
            toast('共有先で保存できたことを確認してください。');
            return;
        }
        catch (e) {
            if (e.name === 'AbortError') {
                toast('書き出しをキャンセルしました。');
                throw Error('バックアップがキャンセルされたため、復元も開始しません。');
            }
        }
    }
    const url = URL.createObjectURL(file), a = el('a', { href: url, download: file.name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast('JSONを書き出しました。ファイルへの保存を確認してください。');
}
async function checkCache() { if (!registration)
    return; const worker = navigator.serviceWorker.controller ?? registration.active; if (!worker) {
    cacheReady = false;
    return;
} const channel = new MessageChannel(); const status = await new Promise(resolve => { const t = setTimeout(() => resolve({ ready: false }), 3000); channel.port1.onmessage = e => { clearTimeout(t); resolve(e.data); }; worker.postMessage({ type: 'CACHE_STATUS' }, [channel.port2]); }); cacheReady = status.ready === true && status.content_version === VERSION; cacheVersion = status.release ?? ''; }
async function setupPWA() { if (!window.isSecureContext || !('serviceWorker' in navigator))
    return; try {
    registration = await navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' });
    updateReady = !!registration.waiting;
    registration.addEventListener('updatefound', () => { const installing = registration.installing; installing?.addEventListener('statechange', () => { if (installing.state === 'installed') {
        updateReady = !!navigator.serviceWorker.controller;
        void checkCache().then(() => { if (page !== 'learn')
            render(); });
    } }); });
    await navigator.serviceWorker.ready;
    await checkCache();
    navigator.serviceWorker.addEventListener('controllerchange', () => { void checkCache().then(() => { if (page !== 'learn')
        render(); }); });
    if (page !== 'learn')
        render();
}
catch {
    cacheReady = false;
    toast('オフライン準備は未完了です。通信できるときに更新してください。');
} }
async function activateUpdate() { await reload(); if (snapshot.sessions.some(s => s.finished_at === null)) {
    toast('中断中の練習を終了してから更新してください。');
    return;
} if (!registration?.waiting) {
    toast('利用可能な更新はありません。');
    return;
} navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true }); registration.waiting.postMessage({ type: 'ACTIVATE_UPDATE' }); }
setInterval(() => {
    accountTime();
    const timer = document.getElementById('timer');
    if (timer)
        timer.textContent = timeLabel();
    if (session && page === 'learn' && !busy && !document.hidden && session.kind !== 'placement') {
        const base = session.plan[session.cursor];
        if (base && base.block !== 8 && session.elapsed >= session.mode_minutes * 60 - 120 && !document.getElementById('time-limit')) {
            const target = root.querySelector('main');
            target?.append(el('div', { class: 'notice warn', id: 'time-limit' }, p('残り時間は最後の再テストに使えます。未回答は失敗になりません。'), button('最後の再テストへ', () => moveToRetest(), 'secondary')));
        }
    }
}, 1000);
document.addEventListener('visibilitychange', () => { accountTime(); speech.stop(); globalThis.speechSynthesis?.cancel(); clockPaused = document.hidden || page !== 'learn'; if (document.hidden && session?.draft) {
    session.draft.interrupted = true;
    if (!interactionRunning)
        void flushDraft().catch(showError);
} tickAt = performance.now(); });
window.addEventListener('pagehide', () => { speech.stop(); if (session?.draft && !interactionRunning)
    void flushDraft().catch(() => { }); });
window.addEventListener('hashchange', () => { const next = location.hash.slice(1); if (interactionRunning) {
    if (next !== page)
        history.replaceState(null, '', '#' + page);
    return;
} if (page === 'learn' && next !== 'learn' && session) {
    interactionRunning = true;
    root.inert = true;
    void pauseSession().catch(showError).finally(() => { interactionRunning = false; root.inert = false; });
    return;
} if (['home', 'progress', 'library', 'settings', 'reviews', 'summary'].includes(next)) {
    page = next;
    render();
} });
function setupAgentTools() {
    const context = document.modelContext;
    if (!context?.registerTool)
        return;
    const lifecycle = new AbortController();
    window.addEventListener('pagehide', () => lifecycle.abort(), { once: true });
    context.registerTool({ name: 'get_learning_status', title: '練習状況を確認', description: 'Read device-local counts and offline readiness. Does not return transcripts or change learning records.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: false }, execute: async (input) => { if (!input || Object.keys(input).length)
            throw Error('No parameters accepted'); await reload(); return { content_version: VERSION, offline_ready: cacheReady, attempt_count: snapshot.attempts.length, pending_count: snapshot.attempts.filter(a => a.content_result === 'needs_review').length, unfinished_session: !!snapshot.sessions.find(s => s.finished_at === null), mode_minutes: profile.mode_minutes }; } }, { signal: lifecycle.signal });
}
async function boot() { try {
    await loadContent();
    repo = await Repository.open();
    await reload();
    if (!snapshot.profile.length) {
        await repo.put('profile', profile);
        await reload();
    }
    page = ['home', 'progress', 'library', 'settings'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'home';
    render();
    setupAgentTools();
    void setupPWA();
}
catch (error) {
    root.replaceChildren(header(), el('main', {}, el('h1', {}, '練習を開けませんでした'), notice(error instanceof Error ? error.message : String(error), 'error'), button('もう一度読み込む', () => location.reload(), 'primary')));
    console.error(error);
} }
void boot();
