/** Serializes snapshots; a failed transaction never advances the live version. */
export class SessionSaver {
    tail = Promise.resolve();
    repository;
    current;
    constructor(repository, current) { this.repository = repository; this.current = current; }
    idle() { return this.tail; }
    save() {
        const source = this.current();
        if (!source)
            return Promise.resolve();
        const snapshot = structuredClone(source);
        const job = this.tail.catch(() => { }).then(async () => {
            const live = this.current();
            if (!live || live !== source || live.session_id !== snapshot.session_id || live.draft?.attempt_id !== snapshot.draft?.attempt_id)
                throw Error('練習の位置が変わりました。保存済みの位置を読み直してください。');
            const expected = live.version;
            snapshot.version = expected + 1;
            await this.repository.saveSession(snapshot, expected);
            live.version = snapshot.version;
        });
        this.tail = job;
        return job;
    }
}
