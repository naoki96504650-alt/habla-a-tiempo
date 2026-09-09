import { blankState, DAY, fastAttempt, reduceMastery, updateMemory } from "./engine.js";
export const KEYS = { profile: 'id', units: 'unit_id', unit_state: 'unit_id', attempts: 'attempt_id', exposures: 'exposure_id', sessions: 'session_id', scenario_runs: 'run_id', reviews: 'review_id', local_answer_overrides: 'override_id', migrations: 'version', meta: 'key' };
export const DATA_STORES = ['profile', 'units', 'unit_state', 'attempts', 'exposures', 'sessions', 'scenario_runs', 'reviews', 'local_answer_overrides'];
export const defaultProfile = () => ({ id: 'singleton', timezone: 'Asia/Tokyo', mode_minutes: 35, dialect: 'es-ES', interest_domains: ['university', 'work', 'friends', 'hobbies'], consent_voice: false, settings_version: 1, onboarded: false, max_phase: 0 });
export class ConflictError extends Error {
    constructor() { super('別の画面で学習記録が更新されました。保存済みの位置を読み直してください。'); }
}
const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
const done = (tx) => new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error ?? Error('保存が中止されました')); tx.onerror = () => { }; });
export class Repository {
    db;
    constructor(db) { this.db = db; db.onversionchange = () => db.close(); }
    static async open(name = 'habla_personal') {
        if (!globalThis.indexedDB)
            throw Error('この端末では学習記録を保存できません。IndexedDBを利用できるブラウザで開いてください。');
        const r = indexedDB.open(name, 1);
        r.onupgradeneeded = () => { const db = r.result; for (const [name, keyPath] of Object.entries(KEYS)) {
            const store = db.createObjectStore(name, { keyPath });
            if (name === 'attempts') {
                store.createIndex('unit_ids', 'observed_unit_ids', { multiEntry: true });
                store.createIndex('started_at', 'started_at');
                store.createIndex('session_id', 'session_id');
            }
            if (name === 'unit_state')
                store.createIndex('due_at', 'due_at');
        } };
        const db = await req(r);
        return new Repository(db);
    }
    async snapshot() { const tx = this.db.transaction([...DATA_STORES], 'readonly'), finish = done(tx); const values = await Promise.all(DATA_STORES.map(name => req(tx.objectStore(name).getAll()))); await finish; const order = { attempts: 'ended_at', exposures: 'time_utc', sessions: 'started_at', scenario_runs: 'started_at', reviews: 'created_at', units: 'introduced_at', local_answer_overrides: 'created_at' }; for (let i = 0; i < DATA_STORES.length; i++) {
        const key = order[DATA_STORES[i]];
        if (key)
            values[i].sort((a, b) => (Number(a[key]) || 0) - (Number(b[key]) || 0));
    } return Object.fromEntries(DATA_STORES.map((name, i) => [name, values[i]])); }
    async get(store, key) { return req(this.db.transaction(store).objectStore(store).get(key)); }
    async put(store, value) { const tx = this.db.transaction(store, 'readwrite'), finish = done(tx); tx.objectStore(store).put(value); await finish; }
    async saveSession(session, expected) {
        const tx = this.db.transaction('sessions', 'readwrite'), finish = done(tx), store = tx.objectStore('sessions');
        let conflict = false;
        store.get(session.session_id).onsuccess = e => { const old = e.target.result; if (expected !== undefined && old?.version !== expected) {
            conflict = true;
            tx.abort();
            return;
        } store.put(session); };
        try {
            await finish;
        }
        catch (e) {
            if (conflict)
                throw new ConflictError();
            throw e;
        }
    }
    async beginTask(session, exposure, units) {
        const tx = this.db.transaction(['sessions', 'exposures', 'unit_state', 'units', 'meta'], 'readwrite'), finish = done(tx);
        let conflict = false;
        tx.objectStore('sessions').get(session.session_id).onsuccess = e => {
            const old = e.target.result;
            if (old.version !== session.version - 1) {
                conflict = true;
                tx.abort();
                return;
            }
            tx.objectStore('sessions').put(session);
            tx.objectStore('exposures').put(exposure);
            for (const u of units) {
                const us = tx.objectStore('units');
                us.get(u.unit_id).onsuccess = e => { const existing = e.target.result; us.put(existing ? { ...existing, active: !existing.paused } : u); };
                const states = tx.objectStore('unit_state');
                states.get(u.unit_id).onsuccess = e => { const state = e.target.result ?? blankState(u.unit_id); states.put({ ...state, last_exposure_at: exposure.time_utc, version: state.version + 1 }); };
            }
        };
        try {
            await finish;
        }
        catch (e) {
            if (conflict)
                throw new ConflictError();
            throw e;
        }
    }
    async expose(exposure) {
        const tx = this.db.transaction(['exposures', 'unit_state'], 'readwrite'), finish = done(tx);
        tx.objectStore('exposures').put(exposure);
        for (const unit of exposure.unit_ids) {
            tx.objectStore('unit_state').get(unit).onsuccess = e => { const state = e.target.result; if (state)
                tx.objectStore('unit_state').put({ ...state, last_exposure_at: exposure.time_utc, version: state.version + 1 }); };
        }
        await finish;
    }
    async commit(attempt, session, expectedVersion, run, review) {
        const tx = this.db.transaction(['attempts', 'unit_state', 'sessions', 'scenario_runs', 'reviews', 'meta'], 'readwrite'), finish = done(tx);
        let conflict = false, duplicate = false;
        const attempts = tx.objectStore('attempts');
        attempts.get(attempt.attempt_id).onsuccess = e => {
            if (e.target.result) {
                duplicate = true;
                return;
            }
            tx.objectStore('sessions').get(session.session_id).onsuccess = e => {
                const old = e.target.result;
                if (!old || old.version !== expectedVersion) {
                    conflict = true;
                    tx.abort();
                    return;
                }
                tx.objectStore('meta').get('last_clock_utc').onsuccess = e => {
                    const last = e.target.result?.value ?? 0;
                    if (attempt.ended_at < last - 60000) {
                        attempt.clock_anomaly = true;
                        attempt.kpi_eligible = false;
                        attempt.exclusion_reason = 'clock_rollback';
                    }
                    tx.objectStore('meta').put({ key: 'last_clock_utc', value: Math.max(last, attempt.ended_at) });
                    attempts.add(attempt);
                    tx.objectStore('sessions').put(session);
                    if (run)
                        tx.objectStore('scenario_runs').put(run);
                    if (review)
                        tx.objectStore('reviews').put(review);
                    if (attempt.repair_review_id) {
                        const reviews = tx.objectStore('reviews');
                        reviews.getAll().onsuccess = e => { for (const r of e.target.result) {
                            if (r.closed_at || r.error_type === 'needs_review' || !r.unit_ids.some(id => attempt.observed_unit_ids.includes(id)))
                                continue;
                            const count = r.repair_count + 1;
                            reviews.put({ ...r, repair_count: count, closed_at: attempt.content_result === 'success' && attempt.mode !== 'short_lag_retest' ? attempt.ended_at : null, repair_due: attempt.ended_at + ((count >= 2 || attempt.mode === 'short_lag_retest') ? DAY : 600000) });
                        } };
                    }
                    const pending = ['needs_review', 'not_scorable'].includes(attempt.content_result);
                    const assessed = attempt.assessed_unit_ids ?? attempt.observed_unit_ids;
                    const targets = pending ? assessed : [...new Set([...attempt.credited_unit_ids, ...(attempt.content_result === 'failure' || attempt.content_result === 'assisted' ? assessed : [])])];
                    for (const unit of targets) {
                        const store = tx.objectStore('unit_state');
                        store.get(unit).onsuccess = e => {
                            const old = e.target.result ?? blankState(unit);
                            if (pending) {
                                store.put({ ...old, review_pending: true, version: old.version + 1 });
                                return;
                            }
                            let next = attempt.clock_anomaly ? old : updateMemory(old, attempt.ended_at, attempt.content_result, attempt.timezone, !fastAttempt(attempt));
                            if (!attempt.clock_anomaly)
                                next = reduceMastery(next, attempt);
                            next.last_exposure_at = Math.max(old.last_exposure_at ?? 0, attempt.ended_at);
                            next.version = old.version + 1;
                            next.review_pending = false;
                            store.put(next);
                        };
                    }
                };
            };
        };
        try {
            await finish;
        }
        catch (e) {
            if (conflict)
                throw new ConflictError();
            throw e;
        }
        return !duplicate;
    }
    async correctAttempt(id, result, reason, credits) {
        const tx = this.db.transaction(['attempts', 'unit_state', 'reviews'], 'readwrite'), finish = done(tx);
        const allReq = tx.objectStore('attempts').getAll();
        allReq.onsuccess = () => {
            const all = allReq.result, a = all.find(a => a.attempt_id === id);
            if (!a) {
                tx.abort();
                return;
            }
            const originalCredits = a.credited_unit_ids;
            a.revision_history = [...(a.revision_history ?? []), { revision: a.assessment_revision, result: a.content_result, at: Date.now(), reason }];
            a.supersedes_revision = a.assessment_revision;
            a.assessment_revision++;
            a.content_result = result === 'success' && (a.hint_before_answer || a.transcript_edit_kind === 'answer_revision') ? 'assisted' : result;
            a.content_basis = 'self_reviewed';
            a.credited_unit_ids = credits;
            tx.objectStore('attempts').put(a);
            tx.objectStore('reviews').getAll().onsuccess = e => { for (const r of e.target.result)
                if (r.attempt_id === id && !r.closed_at)
                    tx.objectStore('reviews').put({ ...r, closed_at: a.content_result === 'success' ? Date.now() : null, error_type: a.content_result === 'success' ? 'assessment_resolved' : 'recall_repair', repair_due: Date.now() + DAY }); };
            for (const unit of new Set([...originalCredits, ...credits, ...(a.assessed_unit_ids ?? a.observed_unit_ids)])) {
                const r = tx.objectStore('unit_state').get(unit);
                r.onsuccess = () => { const old = r.result; let state = blankState(unit); for (const trial of all.filter(t => t.credited_unit_ids.includes(unit) || (['failure', 'assisted'].includes(t.content_result) && (t.assessed_unit_ids ?? t.observed_unit_ids).includes(unit))).sort((x, y) => x.ended_at - y.ended_at)) {
                    if (trial.clock_anomaly)
                        continue;
                    state = reduceMastery(updateMemory(state, trial.ended_at, trial.content_result, trial.timezone, !fastAttempt(trial)), trial);
                } state.last_exposure_at = old?.last_exposure_at ?? null; state.version = (old?.version ?? 0) + 1; tx.objectStore('unit_state').put(state); };
            }
            tx.objectStore('reviews').put({ review_id: 'correction:' + id + ':' + a.assessment_revision, attempt_id: id, unit_ids: a.observed_unit_ids, error_type: 'assessment_correction', correction: reason, repair_due: 0, closed_at: Date.now(), self_or_bounded: 'self_reviewed', created_at: Date.now(), context_id: a.context_id, repair_count: 0 });
        };
        await finish;
    }
    async replace(s) { const tx = this.db.transaction([...DATA_STORES], 'readwrite'), finish = done(tx); for (const name of DATA_STORES) {
        const st = tx.objectStore(name);
        st.clear();
        for (const row of s[name])
            st.put(row);
    } await finish; }
}
