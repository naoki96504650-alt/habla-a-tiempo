import { newId } from "./platform.js";
import { VERSION } from "./engine.js";
export function startRun(s, session_id, task_id, mode, now = Date.now()) { return { run_id: newId(), session_id, task_id, scenario_id: s.id, family_id: s.family_id, node_id: 'start', return_to: null, visits: { start: 1 }, mode, hint_used: false, completed_nodes: [], outcome: 'active', follow_up_route: null, content_revision: VERSION, version: 0, started_at: now, short_turns: 0 }; }
export function scenarioTask(s, run, block = 6) {
    const n = s.nodes.find(n => n.id === run.node_id);
    if (n.id === 'summary' && !run.follow_up_route)
        throw Error('実際に通った経路を選んでください。');
    return { id: s.id + ':' + n.id, kind: 'scenario', unit_ids: s.frame_ids.map(id => 'FRAME:' + id), scenario_id: s.id, answer_set_id: n.answer_set_id, prompt_ja: n.id === 'summary' ? n.task_by_route[run.follow_up_route] : n.task_ja ?? '', context_id: VERSION + ':' + s.id + ':' + n.id + ':' + (run.follow_up_route ?? 'unselected'), phase: s.phase, block, estimated_seconds: 40, rubric: n.id === 'summary' ? n.rubric_by_route[run.follow_up_route] : s.rubric_ja };
}
export function advanceScenario(s, input, intent, success = false, now = Date.now()) {
    const r = structuredClone(input), n = s.nodes.find(n => n.id === r.node_id);
    if (n.terminal)
        return r;
    if (intent === 'repair') {
        if (r.node_id === 'repair')
            return r;
        if ((r.visits.repair ?? 0) >= 2) {
            r.hint_used = true;
            r.pending_npc = '聞き返しはここまでです。例を確認して、この発言から続けましょう。';
            return r;
        }
        r.return_to = r.node_id;
        r.node_id = 'repair';
        r.hint_used = true;
        r.visits.repair = (r.visits.repair ?? 0) + 1;
        r.version++;
        return r;
    }
    let next = n.next;
    if (n.id === 'start') {
        const route = n.routes?.find(x => x.intent === intent);
        if (!route || !route.follow_up_route)
            throw Error('伝えた意図を確認してから続けてください。');
        next = route.next;
        r.follow_up_route = route.follow_up_route;
        r.route_goal_success = success;
    }
    if (next === '$return_to') {
        if (!r.return_to || ['repair', 'end'].includes(r.return_to))
            throw Error('戻り先が不正です。');
        next = r.return_to;
        r.return_to = null;
    }
    else {
        r.completed_nodes.push(n.id);
        r.short_turns = (r.short_turns ?? 0) + 1;
    }
    if (n.id === 'closing' || n.id === 'alternative') {
        r.outcome = success && r.route_goal_success !== false ? (r.follow_up_route === 'alternative' ? 'alternative_goal_completed' : 'achieved') : 'partial';
    }
    r.node_id = next ?? 'end';
    r.visits[r.node_id] = (r.visits[r.node_id] ?? 0) + 1;
    r.pending_npc = n.npc_after_response_es ?? null;
    r.version++;
    if (r.node_id === 'end')
        r.finished_at = now;
    return r;
}
export function chooseRouteAfterRepair(r, route) { return { ...r, follow_up_route: route }; }
