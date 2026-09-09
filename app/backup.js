import { checksum } from "./platform.js";
import { DATA_STORES, KEYS } from "./repository.js";
import { VERSION } from "./engine.js";
export function canonical(value) { if (value === null || typeof value !== 'object')
    return JSON.stringify(value); if (Array.isArray(value))
    return '[' + value.map(canonical).join(',') + ']'; const obj = value; return '{' + Object.keys(obj).filter(k => obj[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canonical(obj[k])).join(',') + '}'; }
async function digest(value) { return checksum(new TextEncoder().encode(canonical(value))); }
export async function makeBackup(s) { const data = { schema_version: 1, content_version: VERSION, exported_at: new Date().toISOString(), ...s }; return { ...data, checksum: await digest(data) }; }
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export async function validateBackup(text) {
    if (new TextEncoder().encode(text).length > 20 * 1024 * 1024)
        throw Error('20MBを超えるファイルは復元できません。');
    let value;
    try {
        value = JSON.parse(text);
    }
    catch {
        throw Error('JSONが壊れています。現在の履歴は変更していません。');
    }
    if (!object(value) || value.schema_version !== 1)
        throw Error('対応していないデータ形式です（schema_versionは1のみ）。');
    if (typeof value.content_version !== 'string' || !/^\d+\.\d+\.\d+$/.test(value.content_version) || typeof value.exported_at !== 'string' || !Number.isFinite(Date.parse(value.exported_at)))
        throw Error('版・書き出し日時が不正です。');
    for (const name of DATA_STORES) {
        if (!Array.isArray(value[name]))
            throw Error(name + 'が配列ではありません。');
        const keys = new Set();
        for (const row of value[name]) {
            if (!object(row) || typeof row[KEYS[name]] !== 'string' || !row[KEYS[name]].length || keys.has(row[KEYS[name]]))
                throw Error(name + 'のIDが不正または重複しています。');
            keys.add(row[KEYS[name]]);
        }
    }
    const b = value;
    if (b.profile.length !== 1 || b.profile[0].id !== 'singleton' || !Array.isArray(b.profile[0].interest_domains) || !b.profile[0].interest_domains.every(x => typeof x === 'string') || ![15, 30, 35, 40].includes(b.profile[0].mode_minutes))
        throw Error('プロフィールが不正です。');
    try {
        new Intl.DateTimeFormat('ja', { timeZone: b.profile[0].timezone }).format();
    }
    catch {
        throw Error('タイムゾーンが不正です。');
    }
    const units = new Set(b.units.map(u => u.unit_id)), sessions = new Set(b.sessions.map(s => s.session_id)), attempts = new Set(b.attempts.map(a => a.attempt_id));
    const refUnits = (v) => Array.isArray(v) && v.every(x => typeof x === 'string' && units.has(x));
    const num = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
    const strings = (v) => Array.isArray(v) && v.every(x => typeof x === 'string');
    const validDraft = (d) => d === null || d === undefined || object(d) && typeof d.attempt_id === 'string' && typeof d.task_id === 'string' && num(d.started_at) && object(d.previous_exposures) && Object.values(d.previous_exposures).every(v => v === null || num(v)) && object(d.learned) && Object.values(d.learned).every(v => typeof v === 'boolean') && typeof d.text === 'string' && typeof d.raw === 'string' && typeof d.hint === 'boolean' && typeof d.spoken === 'boolean' && typeof d.revealed === 'boolean' && strings(d.axes);
    if (b.profile[0].text_scale !== undefined && ![1, 1.5, 2].includes(b.profile[0].text_scale))
        throw Error('文字の大きさが不正です。');
    if (typeof b.profile[0].onboarded !== 'boolean' || !Number.isInteger(b.profile[0].max_phase) || b.profile[0].max_phase < 0 || b.profile[0].max_phase > 4 || typeof b.profile[0].dialect !== 'string')
        throw Error('プロフィールの型が不正です。');
    for (const u of b.units)
        if (!/^(FRAME:F\d{3}|SRC:[EV]\d{4}:example0|PACKET:[A-Za-z0-9_]+|COMM:[A-Za-z0-9_:.-]+)$/.test(u.unit_id) || typeof u.active !== 'boolean' || (u.paused !== undefined && typeof u.paused !== 'boolean') || !num(u.introduced_at) || typeof u.queue_family !== 'string')
            throw Error('学習単位が不正です。');
    for (const s of b.unit_state) {
        if (!units.has(s.unit_id) || !Number.isInteger(s.memory_index) || s.memory_index < -1 || s.memory_index > 6 || !num(s.current_stage) || s.current_stage > 6 || !num(s.best_stage) || s.best_stage > 6 || !object(s.facets) || !(s.due_at === null || num(s.due_at)) || !(s.fluency_due_at === null || num(s.fluency_due_at)) || !(s.last_exposure_at === null || num(s.last_exposure_at)) || typeof s.provisional !== 'boolean' || !num(s.version) || !num(s.longest_interval_days))
            throw Error('習得状態または参照が不正です。');
        if (s.facets.evidence !== undefined && (!Array.isArray(s.facets.evidence) || !s.facets.evidence.every(e => object(e) && attempts.has(String(e.attempt_id)) && typeof e.date === 'string' && typeof e.context === 'string' && typeof e.mode === 'string' && num(e.gap) && typeof e.fast === 'boolean' && typeof e.success === 'boolean' && typeof e.oral === 'boolean' && strings(e.axes))))
            throw Error('技能の証拠データが不正です。');
    }
    for (const s of b.sessions)
        if ((s.probe_cohort !== undefined && (!object(s.probe_cohort) || typeof s.probe_cohort.id !== 'string' || !strings(s.probe_cohort.unit_ids))) || !Array.isArray(s.plan) || !Array.isArray(s.blocks) || !s.blocks.length || !s.blocks.every(block => object(block) && typeof block.id === 'string' && typeof block.label === 'string' && num(block.seconds)) || !Number.isInteger(s.cursor) || s.cursor < 0 || s.cursor > s.plan.length || !num(s.elapsed) || !num(s.version) || !['daily', 'placement', 'practice'].includes(s.kind) || ![15, 30, 35, 40].includes(s.mode_minutes) || !strings(s.unfinished_ids) || !validDraft(s.draft) || !s.plan.every(t => object(t) && typeof t.id === 'string' && typeof t.prompt_ja === 'string' && strings(t.unit_ids) && typeof t.context_id === 'string' && Number.isInteger(t.block) && t.block >= 0 && t.block < s.blocks.length && typeof t.kind === 'string' && num(t.estimated_seconds)))
            throw Error('セッションが不正です。');
    for (const a of b.attempts)
        if (!sessions.has(a.session_id) || !refUnits(a.observed_unit_ids) || !refUnits(a.credited_unit_ids) || !num(a.started_at) || !num(a.ended_at) || !['success', 'failure', 'assisted', 'needs_review', 'not_scorable'].includes(a.content_result) || typeof a.context_id !== 'string' || typeof a.content_version !== 'string' || typeof a.spoken_confirmed !== 'boolean' || !Array.isArray(a.changed_axes) || !num(a.assessment_revision) || !['self_reported', 'unavailable', 'validated_local_onset'].includes(a.timing_basis))
            throw Error('試行の型または参照が不正です。');
    for (const e of b.exposures)
        if (!refUnits(e.unit_ids) || !num(e.time_utc) || typeof e.context_id !== 'string')
            throw Error('接触履歴の参照が不正です。');
    for (const r of b.scenario_runs)
        if (!sessions.has(r.session_id) || !/^SC(0[1-9]|1\d|2[0-4])_[1-4]$/.test(r.scenario_id) || !['start', 'challenge', 'question', 'closing', 'alternative', 'summary', 'repair', 'end'].includes(r.node_id) || ![null, 'main', 'alternative'].includes(r.follow_up_route) || !object(r.visits) || !Object.values(r.visits).every(v => Number.isInteger(v) && v >= 0) || !strings(r.completed_nodes) || !['guided', 'transfer'].includes(r.mode) || !['active', 'achieved', 'alternative_goal_completed', 'partial'].includes(r.outcome) || typeof r.hint_used !== 'boolean' || typeof r.content_revision !== 'string' || !validDraft(r.suspended_draft) || !num(r.started_at) || !num(r.version) || (r.node_id === 'repair' && (!r.return_to || ['repair', 'end'].includes(r.return_to))))
            throw Error('対話の経路または参照が不正です。');
    for (const r of b.reviews)
        if (!attempts.has(r.attempt_id) || !refUnits(r.unit_ids) || typeof r.correction !== 'string')
            throw Error('確認記録の参照が不正です。');
    for (const o of b.local_answer_overrides)
        if (o.scope !== 'prompt' || o.confirmed_by !== 'self' || typeof o.raw_es !== 'string' || typeof o.active !== 'boolean' || typeof o.prompt_id !== 'string')
            throw Error('別解の保存形式が不正です。');
    if (value.checksum !== null) {
        if (typeof value.checksum !== 'string' || !/^[a-f0-9]{64}$/.test(value.checksum))
            throw Error('チェックサムが不正です。');
        const { checksum, ...data } = value;
        const calculated = await digest(data);
        if (!calculated)
            throw Error('この環境ではチェックサムを確認できません。');
        if (calculated !== checksum)
            throw Error('チェックサムが一致しません。ファイルが変更されています。');
    }
    return b;
}
