import { CORE, VERSION } from "./engine.js";
export let content;
export let answers, frames;
export function setContent(c) { if (c.content_version !== VERSION || c.frames.length !== 60 || c.scenarios.length !== 96 || c.sources.length !== 3000)
    throw Error('教材の版または件数が一致しません。オンラインで更新を確認してください。'); content = c; answers = new Map(c.answer_sets.map(a => [a.id, a])); frames = new Map(c.frames.map(f => [f.id, f])); }
export async function loadContent() { const res = await fetch(new URL('../data/content.json', import.meta.url)); if (!res.ok)
    throw Error('教材を取得できません。初回はオンラインで開いてください。'); setContent(await res.json()); return content; }
export function unitFor(id, at = Date.now()) {
    const f = frames.get(id.replace('FRAME:', ''));
    const source = content.sources.find(s => 'SRC:' + s.source_id + ':example0' === id);
    return { unit_id: id, active: true, queue_family: f?.id ?? source?.canonical_group ?? id, introduced_at: at, content_version: VERSION, frame_id: f?.id, source_id: source?.source_id, sense_label: f?.conversation_function_ja ?? source?.meaning_ja ?? 'この課題の発話' };
}
export function availableDrills(frame, mastered, explained = []) { return frame.output_drills.filter(d => !frame.advanced_drill_ids?.includes(d.id) || frame.advanced_prerequisites?.every(p => mastered.includes('FRAME:' + p) || explained.includes(p))); }
export function taskForUnit(unit_id, index = 0, mode = 'recall', block = 1, mastered = []) {
    const f = frames.get(unit_id.replace('FRAME:', ''));
    if (f) {
        const ds = availableDrills(f, mastered);
        const d = ds[index % ds.length];
        return { id: d.id, kind: mode, unit_ids: [unit_id], frame_id: f.id, answer_set_id: d.answer_set_id, prompt_ja: d.prompt_ja, context_id: VERSION + ':' + d.context_id, phase: f.phase, block, estimated_seconds: 25 };
    }
    const s = content.sources.find(x => 'SRC:' + x.source_id + ':example0' === unit_id);
    if (s)
        return { id: s.source_id, kind: mode, unit_ids: [unit_id], answer_set_id: s.source_answer_set_id, prompt_ja: s.practice_example_ja, context_id: VERSION + ':' + unit_id, phase: s.phase, block, estimated_seconds: 25 };
    const packet = content.verb_packets.find(v => v.drills.some(d => 'PACKET:' + answers.get(d.answer_set_id)?.packet_drill_evidence_id === unit_id));
    const d = packet?.drills.find(d => 'PACKET:' + answers.get(d.answer_set_id)?.packet_drill_evidence_id === unit_id);
    return d ? { id: d.id, kind: 'transform', unit_ids: [unit_id], answer_set_id: d.answer_set_id, prompt_ja: d.prompt_ja, context_id: VERSION + ':' + d.context_id, phase: 1, block, estimated_seconds: 30 } : null;
}
export function candidates(s) {
    const state = new Map(s.unit_state.map(u => [u.unit_id, u]));
    const rows = content.frames.map(f => { const sources = content.sources.filter(x => f.source_ids.includes(x.source_id)); const core = sources.find(x => x.core_verb_guard); return { id: 'FRAME:' + f.id, phase: f.phase, prerequisites: f.prerequisites.map(p => 'FRAME:' + p), priority_band: f.phase < 2 ? 'P0' : 'P1', lemma: core?.term.replace('(se)', ''), core_verb_guard: !!core, domain: sources[0]?.domain ?? '', generativity_rating: 5, necessity_rating: 5, conversation_functions: [f.id], recent_context_count: s.exposures.filter(e => e.unit_ids.includes('FRAME:' + f.id)).length, placement_usable: state.get('FRAME:' + f.id)?.provisional, queue_family: f.id, cost: 240 }; });
    for (const x of content.sources) {
        const lemma = x.term.replace('(se)', '');
        rows.push({ id: 'SRC:' + x.source_id + ':example0', phase: x.phase, prerequisites: [], priority_band: x.priority_band, lemma: CORE.includes(lemma) ? lemma : undefined, core_verb_guard: x.core_verb_guard, domain: x.domain, generativity_rating: x.generativity_rating, necessity_rating: x.necessity_rating, conversation_functions: x.frame_ids, recent_context_count: 0, placement_usable: state.get('SRC:' + x.source_id + ':example0')?.provisional, queue_family: x.canonical_group, cost: 100 });
    }
    return rows;
}
