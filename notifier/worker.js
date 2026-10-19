import { setTimeout } from 'node:timers/promises';
import { createRuntime } from './runtime.js';
const shutdown = new AbortController();
for (const event of ['SIGINT', 'SIGTERM']) process.on(event, () => shutdown.abort());
try {
    const { config, engine } = createRuntime();
    let failures = 0;
    do {
        const started = Date.now();
        try {
            const result = await engine.run(AbortSignal.any([shutdown.signal, AbortSignal.timeout(60000)]));
            console.log(JSON.stringify({ at: new Date().toISOString(), ...result }));
            failures = 0;
        } catch (error) {
            console.error(JSON.stringify({ status: 'error', code: /^SOURCE_|^STATE_/.test(error.message) ? error.message : 'CYCLE_FAILED' }));
            failures++;
        }
        if (process.argv.includes('--once')) { if (failures) process.exitCode = 1; break; }
        const delay = Math.max(config.interval * 1000, failures ? Math.min(900000, 30000 * 2 ** Math.min(failures, 5)) : 0);
        await setTimeout(Math.max(0, delay - (Date.now() - started)), undefined, { signal: shutdown.signal }).catch(() => {});
    } while (!shutdown.signal.aborted);
} catch {
    console.error('CONFIG_ERROR: check .env.example and README');
    process.exitCode = 1;
}
