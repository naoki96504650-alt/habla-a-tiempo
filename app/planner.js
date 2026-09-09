import { newId } from "./platform.js";
import { DAY, VERSION, hashSeed, isLeech, localDate, orderNewCandidates, planNew, repairEligible, stableShuffle } from "./engine.js";
import { answers, availableDrills, candidates, content, frames, taskForUnit } from "./content.js";
export const BLOCK_NAMES = ['高速想起', 'SRS復習', '新規・弱点の再導入', '日本語から一文', '文を変える', '自分のことを話す', '短い対話', '誤りを修復', '最後の再テスト'];
export function blocksFor(mode) { let minutes = mode === 15 ? [1, 4, 1, 2, 1, 1, 2, 1, 2] : [2, 9, 5, 4, 3, 3, 5, 2, 2].map(x => x * mode / 35); if (mode >= 30) {
    minutes[8] = 2;
    minutes[6] = Math.max(3, minutes[6]);
    minutes[1] += mode - minutes.reduce((a, b) => a + b, 0);
} return minutes.map((x, i) => ({ id: 'block' + i, label: BLOCK_NAMES[i], seconds: Math.round(x * 60) })); }
const isActive = (s, id) => s.units.some(u => u.unit_id === id && u.active && !u.paused);
export function reviewLoad(s, now) { const dates = (x) => [x.due_at, x.fluency_due_at].filter((v) => v !== null), states = s.unit_state.filter(x => isActive(s, x.unit_id)); const due = states.filter(x => dates(x).some(v => v <= now)); const forecast = [1, 2, 3].map(d => states.filter(x => dates(x).some(v => v > now + (d - 1) * DAY && v <= now + d * DAY)).length * 25); return { due, seconds: due.length * 25, forecast }; }
export function repairReady(s, reviewId, now, allowShort = false) {
    const r = s.reviews.find(r => r.review_id === reviewId);
    if (!r || r.closed_at || r.error_type === 'needs_review' || r.repair_due > now)
        return false;
    const id = r.unit_ids[0];
    if (!id || !isActive(s, id))
        return false;
    const date = localDate(now, s.profile[0]?.timezone), today = s.attempts.filter(a => a.local_date === date), repairs = today.filter(a => a.repair_review_id || a.mode === 'repair');
    const count = repairs.filter(a => a.observed_unit_ids.includes(id)).length;
    if (count >= 2)
        return false;
    const leeches = new Set(repairs.filter(a => a.observed_unit_ids.some(u => isLeech(s.attempts, u))).flatMap(a => a.observed_unit_ids));
    if (isLeech(s.attempts, id) && leeches.size >= 2 && !leeches.has(id))
        return false;
    const prev = s.attempts.filter(a => a.observed_unit_ids.includes(id)).at(-1);
    if (!prev || prev.local_date !== date)
        return true;
    const between = new Set(today.filter(a => a.ended_at > prev.ended_at && !a.observed_unit_ids.includes(id)).map(a => a.prompt_id)).size;
    return repairEligible(prev.ended_at, now, between, count) || (allowShort && !repairs.some(a => a.observed_unit_ids.includes(id) && a.mode === 'short_lag_retest'));
}
export function eligibleMastered(s) { return s.unit_state.filter(x => x.current_stage >= 2 || x.provisional).map(x => x.unit_id); }
export function selectProbes(s, mode, now, seed, cohort) {
    const done = new Set(s.attempts.filter(a => a.local_date === localDate(now, s.profile[0]?.timezone) && a.preselected_probe).flatMap(a => a.observed_unit_ids));
    const priorReservations = new Set(s.sessions.filter(x => x.date_local === localDate(now, s.profile[0]?.timezone)).flatMap(x => x.plan.filter(t => t.probe).flatMap(t => t.unit_ids)));
    const used = new Set([...done, ...priorReservations]);
    const candidates = s.unit_state.filter(u => isActive(s, u.unit_id) && u.memory_index >= 0 && u.last_exposure_at !== null && now - u.last_exposure_at >= DAY && !used.has(u.unit_id)).map(u => taskForUnit(u.unit_id, hashSeed(seed + u.unit_id) % 3, 'recall', 0, eligibleMastered(s))).filter((x) => !!x && x.prompt_ja.length <= 32 && answers.get(x.answer_set_id)?.timing_prompt_eligible !== false);
    const buckets = new Map();
    for (const t of candidates) {
        const key = t.phase + ':' + (t.frame_id ?? 'source');
        buckets.set(key, [...(buckets.get(key) ?? []), t]);
    }
    const chosen = [];
    const groups = stableShuffle([...buckets.entries()], seed, x => x[0]);
    for (let round = 0; chosen.length < (mode === 15 ? 3 : 6); round++) {
        let any = false;
        for (const [key, rows] of groups) {
            const task = stableShuffle(rows, seed + key, x => x.id)[round];
            if (task) {
                chosen.push({ ...task, probe: true, cohort: cohort?.unit_ids.includes(task.unit_ids[0]) ? cohort.id : undefined, probe_reserved_exposure_at: s.unit_state.find(u => u.unit_id === task.unit_ids[0]).last_exposure_at });
                any = true;
                if (chosen.length === (mode === 15 ? 3 : 6))
                    break;
            }
        }
        if (!any)
            break;
    }
    return chosen;
}
export function placementTasks() { return content.items.filter(i => i.pool === 'anchor').map(i => fromPlacement(i)); }
function fromPlacement(i) { return { id: i.id, kind: i.scenario_id ? 'scenario' : i.pool.startsWith('delayed_') ? 'diagnostic_recheck' : 'placement', unit_ids: i.unit_id ? ['FRAME:' + i.unit_id] : (i.unit_ids ?? []).map(x => 'FRAME:' + x), scenario_id: i.scenario_id, answer_set_id: i.answer_set_id, prompt_ja: i.prompt_ja, context_id: VERSION + ':' + i.id, phase: i.phase ?? 0, block: 0, placement_pool: i.pool, placement_item_id: i.id, estimated_seconds: i.scenario_id ? 90 : 25 }; }
export function adaptivePlacement(as) {
    const anchor = as.filter(a => a.placement_pool === 'anchor');
    const successes = anchor.filter(a => a.content_result === 'success' && a.spoken_confirmed && !a.hint_before_answer).length;
    let adaptive = successes <= 5 ? content.items.filter(i => i.pool === 'adaptive' && i.phase === 1).slice(0, 6) : successes <= 9 ? content.items.filter(i => i.pool === 'adaptive' && i.phase === 2).slice(0, 12) : [...content.items.filter(i => i.pool === 'adaptive' && i.phase === 2).slice(0, 6), ...content.items.filter(i => i.pool === 'adaptive' && i.phase === 3).slice(0, 6)];
    const probes = content.items.filter(i => i.pool === 'scenario_probe').slice(successes >= 10 ? 2 : 0, successes >= 10 ? 4 : 2);
    return [...adaptive, ...probes].map(fromPlacement);
}
export function stopHigherPlacement(plan, as, cursor) { const rows = as.filter(a => a.placement_pool === 'adaptive'); const tail = rows.slice(-3); if (tail.length === 3 && tail.every(a => a.content_result === 'failure' && a.placement_phase === tail[0].placement_phase)) {
    return plan.filter((t, i) => i < cursor || t.kind === 'scenario' || t.phase <= (tail[0].placement_phase ?? 0));
} return plan; }
export function chooseScenario(s, now) {
    const unfinished = s.scenario_runs.find(r => r.outcome === 'active' && r.node_id !== 'end');
    if (unfinished)
        return content.scenarios.find(x => x.id === unfinished.scenario_id);
    const mastered = eligibleMastered(s), available = content.scenarios.filter(x => x.phase <= (s.profile[0]?.max_phase ?? 0) && x.required_frame_ids.every(f => mastered.includes('FRAME:' + f)));
    const eligible = content.families.filter(f => available.some(x => x.family_id === f.id));
    for (const f of eligible) {
        const runs = s.scenario_runs.filter(r => r.family_id === f.id).sort((a, b) => a.started_at - b.started_at);
        if (runs.length) {
            const offset = f.recurrence_days[Math.min(runs.length, 5)];
            const due = runs.length < 6 ? runs[0].started_at + offset * DAY : runs.at(-1).started_at + 30 * DAY;
            if (now >= due) {
                const variants = available.filter(x => x.family_id === f.id), unseen = variants.find(x => !runs.some(r => r.scenario_id === x.id && r.content_revision === VERSION));
                return unseen ?? variants[runs.length % variants.length];
            }
        }
    }
    return available.find(x => !s.scenario_runs.some(r => r.family_id === x.family_id)) ?? available[0] ?? content.scenarios.find(x => x.phase === 0) ?? content.scenarios[0];
}
export function planSession(s, mode, now = Date.now(), kind = 'daily') {
    const tz = s.profile[0]?.timezone ?? 'Asia/Tokyo', date = localDate(now, tz), seed = date + VERSION, session_id = newId();
    const session = { session_id, kind, plan: [], blocks: kind === 'placement' ? [{ id: 'diagnosis', label: '最初の診断', seconds: 25 * 60 }] : blocksFor(mode), date_local: date, timezone: tz, seed, cursor: 0, elapsed: 0, mode_minutes: mode, unfinished_ids: [], finished_at: null, version: 0, new_count: 0, started_at: now };
    if (kind === 'placement') {
        session.plan = placementTasks();
        return session;
    }
    const mastered = eligibleMastered(s), active = s.units.filter(x => x.active && !x.paused).map(x => x.unit_id), load = reviewLoad(s, now), weekly = content.scenarios.find(x => x.id === chooseScenario(s, now).id).frame_ids;
    const seen = new Set();
    const ordered = orderNewCandidates(candidates(s), mastered, weekly, s.profile[0]?.interest_domains ?? [], s.profile[0]?.max_phase ?? 0).filter(c => !s.units.some(u => u.unit_id === c.id && (u.active || u.paused))).filter(c => { const groups = c.queue_family.split(';'); if (groups.some(g => seen.has(g)))
        return false; groups.forEach(g => seen.add(g)); return true; });
    const trials = s.attempts.filter(a => a.ended_at >= now - 7 * DAY && a.first_attempt && !a.hint_before_answer && !a.interrupted && ['success', 'failure'].includes(a.content_result));
    const unique = [...new Map(trials.map(a => [a.local_date + ':' + a.observed_unit_ids.join('|'), a])).values()];
    const n = planNew(mode, unique.filter(a => a.content_result === 'success').length, unique.length, load.seconds, load.forecast, ordered.map(c => c.cost));
    session.new_count = n;
    const add = (t) => { if (t?.unit_ids && !t.unit_ids.some(id => s.units.some(u => u.unit_id === id && u.paused)))
        session.plan.push({ ...t, id: t.id + ':q' + session.plan.length }); };
    session.probe_cohort = s.sessions.find(x => x.probe_cohort)?.probe_cohort;
    if (!session.probe_cohort) {
        const cohortUnits = s.unit_state.filter(u => isActive(s, u.unit_id) && u.memory_index >= 0 && u.last_exposure_at !== null && now - u.last_exposure_at >= DAY).map(u => u.unit_id);
        if (cohortUnits.length)
            session.probe_cohort = { id: date, unit_ids: cohortUnits };
    }
    const probes = selectProbes(s, mode, now, seed, session.probe_cohort);
    probes.forEach(add);
    const probeUnits = new Set(probes.flatMap(t => t.unit_ids));
    if (!probes.length)
        active.slice(0, mode === 15 ? 1 : 2).forEach(id => add(taskForUnit(id, 0, 'recall', 0, mastered)));
    const repaired = new Set();
    const repairs = s.reviews.filter(r => repairReady(s, r.review_id, now, true)).filter(r => { if (repaired.has(r.unit_ids[0]))
        return false; repaired.add(r.unit_ids[0]); return true; }).slice(0, 2);
    const repairTask = (r, block) => { const t = taskForUnit(r.unit_ids[0], block === 1 ? 1 : 2, 'repair', block, mastered); return t ? { ...t, repair_review_id: r.review_id } : null; };
    repairs.filter(r => repairReady(s, r.review_id, now)).forEach(r => add(repairTask(r, 1)));
    load.due.filter(x => !probeUnits.has(x.unit_id)).sort((a, b) => (a.due_at ?? 0) - (b.due_at ?? 0)).slice(0, Math.floor(session.blocks[1].seconds / 25)).forEach(u => add(taskForUnit(u.unit_id, hashSeed(seed + u.unit_id) % 3, 'recall', 1, mastered)));
    s.unit_state.filter(x => isActive(s, x.unit_id) && x.fluency_due_at && x.fluency_due_at <= now && !load.due.includes(x) && !probeUnits.has(x.unit_id)).slice(0, 3).forEach(u => add(taskForUnit(u.unit_id, 1, 'recall', 1, mastered)));
    const introduced = ordered.slice(0, n);
    const focus = introduced.find(c => c.id.startsWith('FRAME:'))?.id ?? active.find(id => id.startsWith('FRAME:')) ?? 'FRAME:F001';
    const f = frames.get(focus.replace('FRAME:', ''));
    for (const c of introduced) {
        const t = taskForUnit(c.id, 0, 'generation', 2, mastered);
        if (t)
            add({ ...t, intro: true });
        const ff = frames.get(c.id.replace('FRAME:', ''));
        if (ff)
            availableDrills(ff, mastered).slice(1, 4).forEach((d, i) => add({ ...taskForUnit(c.id, i + 1, 'generation', 3, mastered), target_form: ff.pattern }));
    }
    if (!n) {
        const weak = s.unit_state.filter(x => isActive(s, x.unit_id) && x.current_stage < 3).sort((a, b) => a.current_stage - b.current_stage).map(u => taskForUnit(u.unit_id, 0, 'generation', 2, mastered)).find(Boolean) ?? taskForUnit(focus, 0, 'generation', 2, mastered);
        if (weak)
            add({ ...weak, intro: true });
    }
    if (!session.plan.some(t => t.block === 3))
        availableDrills(f, mastered).slice(0, 3).forEach((d, i) => add(taskForUnit(focus, i, 'generation', 3, mastered)));
    const packet = content.verb_packets.find(v => f.source_ids.includes(v.source_id)) ?? content.verb_packets[hashSeed(seed) % content.verb_packets.length];
    const vd = packet.drills[hashSeed(seed + 'verb') % 5], va = answers.get(vd.answer_set_id);
    add({ id: vd.id, kind: 'transform', unit_ids: ['PACKET:' + va.packet_drill_evidence_id], answer_set_id: vd.answer_set_id, prompt_ja: vd.prompt_ja, context_id: VERSION + ':' + vd.context_id, phase: 1, block: 4, estimated_seconds: 45 });
    add({ id: f.id + ':free', kind: 'generation', unit_ids: [focus], frame_id: f.id, prompt_ja: f.meaningful_generation_prompt_ja, context_id: VERSION + ':' + f.id + ':free', phase: f.phase, block: 5, rubric: f.meaningful_generation_rubric_ja, estimated_seconds: 60 });
    const scenario = chooseScenario(s, now);
    add({ id: scenario.id, kind: 'scenario', unit_ids: scenario.frame_ids.map(f => 'FRAME:' + f), scenario_id: scenario.id, prompt_ja: scenario.context.learner_goal_ja, context_id: VERSION + ':' + scenario.id, phase: scenario.phase, block: 6, estimated_seconds: mode === 15 ? 120 : 300 });
    for (const r of repairs)
        add(repairTask(r, 7));
    if (!repairs.length)
        add(taskForUnit(focus, 2, 'repair', 7, mastered));
    for (const id of [...new Set([...introduced.map(c => c.id), focus])].slice(0, mode === 15 ? 2 : 4))
        add(taskForUnit(id, 4, 'retest', 8, mastered));
    // Placement rechecks are independent of cold KPI, with their supplied alternate contexts.
    if (s.profile[0]?.placement_completed_at) {
        const age = now - s.profile[0].placement_completed_at;
        const pool = age >= 7 * DAY ? 'delayed_day_7' : age >= 20 * 3600000 ? 'delayed_day_1' : null;
        if (pool) {
            const completed = new Set(s.attempts.filter(a => a.placement_pool === pool).map(a => a.prompt_id));
            const checks = content.items.filter(i => i.pool === pool && !completed.has(i.id)).slice(0, 3).map(i => ({ ...fromPlacement(i), block: 1 }));
            session.plan.splice(probes.length, 0, ...checks);
        }
    }
    session.plan.sort((a, b) => a.block - b.block);
    return session;
}
export function shortenSession(s) { const remaining = s.plan.slice(s.cursor + 1); const introduced = new Set(s.plan.slice(0, s.cursor + 1).filter(t => t.intro).flatMap(t => t.unit_ids)); const drop = new Set(remaining.filter(t => t.intro && !t.unit_ids.some(id => introduced.has(id))).flatMap(t => t.unit_ids)); const plan = [...s.plan.slice(0, s.cursor + 1), ...remaining.filter(t => t.block === 8 || t.kind === 'scenario' || !t.unit_ids.some(id => drop.has(id)))]; return { ...s, plan, mode_minutes: 15, new_count: introduced.size, blocks: blocksFor(15), version: s.version + 1 }; }
export function fitSessionTime(s) {
    if (s.kind !== 'daily' || s.cursor >= s.plan.length)
        return s;
    const next = structuredClone(s), current = next.plan[next.cursor];
    const stopNew = next.elapsed - (next.block_started_elapsed ?? 0) > (next.blocks[next.block_anchor ?? current.block]?.seconds ?? Infinity);
    if (stopNew) {
        const remove = new Set(next.plan.slice(next.cursor).filter(t => t.intro).flatMap(t => t.unit_ids));
        next.plan = next.plan.filter((t, i) => i < next.cursor || t.block === 8 || !remove.size || !t.unit_ids.some(id => remove.has(id)));
    }
    if (next.elapsed >= next.mode_minutes * 60 - 120) {
        const at = next.plan.findIndex((t, i) => i >= next.cursor && t.block === 8);
        if (at >= 0) {
            next.unfinished_ids.push(...next.plan.slice(next.cursor, at).map(t => t.id));
            next.cursor = at;
        }
    }
    else if (stopNew) {
        let at = next.cursor;
        while (at < next.plan.length && next.plan[at].block === next.block_anchor && next.plan[at].block !== 8)
            at++;
        next.unfinished_ids.push(...next.plan.slice(next.cursor, at).map(t => t.id));
        next.cursor = at;
    }
    return next;
}
