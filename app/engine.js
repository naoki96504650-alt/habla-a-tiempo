export const VERSION = '1.1.0', ALGORITHM = 'habla-1.1.0-r1', DAY = 86400000;
export const LADDER = [1, 3, 7, 14, 30, 60, 120];
export const CORE = 'ser estar tener hacer ir venir poder querer decir dar poner quedar llevar pasar volver'.split(' ');
export const localDate = (at, tz = 'Asia/Tokyo') => new Intl.DateTimeFormat('sv-SE', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
export const surfaceKey = (s) => s.normalize('NFKC').normalize('NFC').toLocaleLowerCase('es').replace(/[^\p{L}\p{N}_\s]/gu, ' ').replace(/\s+/g, ' ').trim();
export const normalizedKey = (s) => surfaceKey(s.normalize('NFKC').normalize('NFD').replace(/[\u0301\u0308]/g, '').normalize('NFC'));
const conflicts = 'hablo hablé canto tomo llevo paso dejo llego entro miro preparo llamo trabajo estudio practico termino compro cambio pago gano tomo si el tu mi de se te mas'.split(' ');
export function matchAnswer(text, a) {
    if (a.mode !== 'bounded_exact')
        return { kind: 'needs_review', variant: null, feedback: '' };
    const strict = surfaceKey(text);
    const exact = a.accepted_es.find(v => surfaceKey(v) === strict);
    if (exact)
        return { kind: 'exact_content_match', variant: exact, feedback: '' };
    const error = a.known_errors?.find(e => surfaceKey(e.exact_es) === strict);
    if (error)
        return { kind: 'known_error', variant: null, feedback: error.feedback_ja };
    const matches = a.accepted_es.filter(v => normalizedKey(v) === normalizedKey(text));
    if (!matches.length)
        return { kind: 'needs_review', variant: null, feedback: '' };
    const words = strict.split(' ');
    for (const v of matches) {
        const cw = surfaceKey(v).split(' ');
        if (words.some((w, i) => w !== cw[i] && (conflicts.includes(normalizedKey(w)) || (w.endsWith('o') && cw[i]?.endsWith('ó')) || (w.endsWith('ó') && cw[i]?.endsWith('o')))))
            return { kind: 'needs_review', variant: null, feedback: 'アクセントで意味や時制が変わるため、自分で確認してください。' };
    }
    return { kind: 'content_match_orthography_unverified', variant: matches[0], feedback: '' };
}
export function evidenceCredits(a, variant, confirmedUnits = []) {
    const v = a.variant_evidence?.find(x => x.text_es === variant);
    const frames = !a.contrast_only_for_target_frame && v?.status === 'curated_form' ? v.frame_evidence_ids.map(id => 'FRAME:' + id) : [];
    const sources = v?.status === 'curated_form' ? v.source_evidence_ids.map(id => 'SRC:' + id + ':example0') : [];
    return [...new Set([...frames, ...sources, ...confirmedUnits.filter(id => !a.contrast_only_for_target_frame || !id.startsWith('FRAME:'))])];
}
export function blankState(unit_id) { return { unit_id, memory_index: -1, due_at: null, fluency_due_at: null, current_stage: 0, best_stage: 0, facets: { evidence: [] }, provisional: false, freshness: 'new', last_exposure_at: null, longest_interval_days: 0, version: 0 }; }
export function updateMemory(state, now, outcome, tz = 'Asia/Tokyo', slow = false) {
    const s = structuredClone(state);
    if (['needs_review', 'not_scorable'].includes(outcome))
        return s;
    const date = localDate(now, tz);
    if (outcome === 'failure' || outcome === 'assisted') {
        s.memory_index = 0;
        s.due_at = now + DAY;
        s.fluency_due_at = now + DAY;
        s.last_promoted_local_date = date;
    }
    else if (s.memory_index < 0 || (now >= (s.due_at ?? 0) && s.last_promoted_local_date !== date)) {
        s.memory_index = Math.min(6, s.memory_index + 1);
        s.due_at = now + LADDER[s.memory_index] * DAY;
        s.last_promoted_local_date = date;
    }
    if (outcome === 'success')
        s.fluency_due_at = slow ? now + DAY : null;
    s.longest_interval_days = Math.max(s.longest_interval_days, LADDER[Math.max(0, s.memory_index)]);
    return s;
}
export function stageFromEvidence(f) {
    const checks = [!!f.recognition_confirmed, (f.recall_contexts ?? 0) >= 2 && f.recall_gap24, (f.generation_contexts ?? 0) >= 3 && (f.changed_axes ?? 0) >= 2 && (f.generation_days ?? 0) >= 2, (f.spontaneous_families ?? 0) >= 2 && f.spontaneous_gap7, (f.speed_n ?? 0) >= 10 && (f.speed_success_last10 ?? 0) >= 8 && (f.speed_days ?? 0) >= 3, f.retention7 && f.retention30 && f.retention30_fast];
    let n = 0;
    for (const pass of checks) {
        if (!pass)
            break;
        n++;
    }
    return n;
}
const distinct = (a) => new Set(a).size;
export const fastAttempt = (a) => a.latency_bucket === 'le3s' && a.within_turn_pause_gt5s === false && a.response_duration_ms !== null && a.response_duration_ms <= 15000;
export function reduceMastery(state, a) {
    const s = structuredClone(state);
    const f = s.facets;
    const success = a.content_result === 'success' && !a.hint_before_answer && a.spoken_confirmed && !a.clock_anomaly;
    const e = { attempt_id: a.attempt_id, date: a.local_date, context: a.context_id, mode: a.mode, gap: a.gap_seconds ?? 0, fast: fastAttempt(a), axes: a.changed_axes, family: a.family_id, spontaneous: a.spontaneous, success, oral: a.spoken_confirmed, failure: a.content_result === 'failure', speed_eligible: a.short_prompt && ['self_reported', 'validated_local_onset'].includes(a.timing_basis) && a.first_attempt && !a.interrupted && !a.clock_anomaly && !a.hint_before_answer && a.spoken_confirmed && ['success', 'failure'].includes(a.content_result) };
    f.evidence = [...(f.evidence ?? []).filter(x => x.attempt_id !== a.attempt_id), e];
    f.recognition_confirmed = !!f.recognition_confirmed || a.recognition_confirmed || success;
    const ok = f.evidence.filter(x => x.success), recall = ok.filter(x => x.mode !== 'placement'), gen = ok.filter(x => ['generation', 'transform'].includes(x.mode)), trans = ok.filter(x => x.spontaneous && x.family);
    const speed = f.evidence.filter(x => x.speed_eligible && x.mode !== 'placement' && x.gap >= 86400).slice(-10);
    Object.assign(f, { recall_contexts: distinct(recall.map(x => x.context)), recall_gap24: recall.some(x => x.gap >= 86400), generation_contexts: distinct(gen.map(x => x.context)), generation_days: distinct(gen.map(x => x.date)), changed_axes: distinct(gen.flatMap(x => x.axes)), spontaneous_families: distinct(trans.map(x => x.family)), spontaneous_gap7: trans.some(x => x.gap >= 604800), speed_n: speed.length, speed_success_last10: speed.filter(x => x.success && x.fast).length, speed_days: distinct(speed.map(x => x.date)), retention7: !!f.retention7 || recall.some(x => x.gap >= 604800), retention30: !!f.retention30 || recall.some(x => x.gap >= 2592000), retention30_fast: !!f.retention30_fast || recall.some(x => x.gap >= 2592000 && x.fast) });
    const stage = stageFromEvidence(f);
    s.current_stage = stage;
    s.best_stage = Math.max(s.best_stage, stage);
    const failures = f.evidence.filter(x => x.failure && x.oral).slice(-5);
    if (a.content_result === 'failure' && distinct(failures.map(x => x.date)) >= 2)
        s.current_stage = Math.min(stage, Math.max(0, state.current_stage - 1));
    if (a.mode === 'placement' && ['anchor', 'adaptive'].includes(a.placement_pool ?? '') && success) {
        s.provisional = true;
        s.current_stage = Math.max(s.current_stage, e.fast ? 3 : 2);
        s.best_stage = Math.max(s.best_stage, s.current_stage);
        s.memory_index = e.fast ? 1 : 0;
        s.due_at = a.ended_at + (e.fast ? 3 : 1) * DAY;
    }
    if (s.provisional && recall.some(x => x.gap >= 604800 && recall.some(y => y.gap >= 86400 && y.context !== x.context && y.date !== x.date)))
        s.provisional = false;
    return s;
}
export function orderNewCandidates(cs, mastered, weekly, domains, maxPhase) {
    const have = new Set(mastered);
    const key = (c) => ([!c.conversation_functions.some(f => weekly.includes(f)) ? 1 : 0, { P0: 0, P1: 1, P2: 2, P3: 3 }[c.priority_band], (CORE.includes(c.lemma ?? '') || c.core_verb_guard) ? 0 : 1, domains.includes(c.domain) ? 0 : 1, -c.generativity_rating, -c.necessity_rating, c.recent_context_count, CORE.includes(c.lemma ?? '') ? CORE.indexOf(c.lemma) : 999]);
    return cs.filter(c => !have.has(c.id) && !c.placement_usable && c.phase <= maxPhase && c.prerequisites.every(p => have.has(p))).sort((a, b) => { const aa = key(a), bb = key(b); for (let i = 0; i < aa.length; i++)
        if (aa[i] !== bb[i])
            return aa[i] - bb[i]; return a.id.localeCompare(b.id); });
}
export function planNew(mode, successes, scored, due, forecast, costs) {
    if (forecast.length !== 3)
        throw Error('Three forecast days required');
    const normal = mode >= 30, scale = normal ? mode / 35 : 1, srs = (normal ? 540 : 240) * scale, intro = (normal ? 300 : 60) * scale, pool = (normal ? 720 : 240) * scale;
    const max = scored < 10 ? (normal ? 2 : 1) : (normal ? 6 : 2);
    if ((scored >= 10 && (successes + 2) / (scored + 4) < .8) || due > srs || Math.max(...forecast) > srs)
        return 0;
    let n = 0, spent = 0, initial = 0;
    for (const cost of costs) {
        const ic = cost >= 240 ? 60 : 30;
        if (n === max || spent + cost > pool || initial + ic > intro || forecast[0] + 25 * (n + 1) > srs)
            break;
        n++;
        spent += cost;
        initial += ic;
    }
    return n;
}
export function kpi(attempts) {
    const selected = attempts.filter(a => a.preselected_probe && a.learned_before && ((a.gap_seconds ?? 0) >= 86400 || a.contaminated === true) && a.short_prompt);
    const eligible = selected.filter(a => !a.contaminated && !a.clock_anomaly);
    const scored = eligible.filter(a => ['success', 'failure', 'assisted'].includes(a.content_result) && ['self_reported', 'validated_local_onset'].includes(a.timing_basis) && !a.interrupted);
    const numerator = scored.filter(a => a.content_result === 'success' && !a.hint_before_answer && a.first_attempt && a.spoken_confirmed && fastAttempt(a)).length;
    return { numerator, denominator: scored.length, rate: scored.length ? numerator / scored.length : null, started: selected.length, coverage: selected.length ? scored.length / selected.length : null, pending: selected.length - scored.length, contaminated: selected.filter(a => a.contaminated).length };
}
export function kpiBySeries(as) { const out = {}; for (const a of as) {
    const key = a.timing_basis + '/' + a.content_basis;
    out[key] = kpi(as.filter(x => x.timing_basis + '/' + x.content_basis === key));
} return out; }
export function hashSeed(s) { let n = 2166136261; for (const c of s) {
    n ^= c.charCodeAt(0);
    n = Math.imul(n, 16777619);
} return n >>> 0; }
export function stableShuffle(a, seed, id) { return [...a].sort((x, y) => hashSeed(seed + id(x)) - hashSeed(seed + id(y)) || id(x).localeCompare(id(y))); }
export function repairEligible(first, now, differentTasks, count) { return count < 2 && now - first >= 600000 && differentTasks >= 3; }
export function isLeech(as, unit) { const rows = as.filter(a => a.observed_unit_ids.includes(unit) && ['success', 'failure'].includes(a.content_result) && a.first_attempt).slice(-5); return distinct(rows.map(a => a.local_date)) >= 4 && rows.filter(a => a.content_result === 'failure').length >= 3; }
