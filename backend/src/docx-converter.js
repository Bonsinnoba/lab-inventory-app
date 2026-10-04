import { fork } from 'node:child_process';
import { DOCX_INPUT_LIMIT } from './docx-input.js';

function failure(message, status) { return Object.assign(new Error(message), { status }); }

// Isolate parser CPU/heap failures from the API. There is no unbounded job queue.
// Options are internal test seams, never derived from a request.
export function createDocxConverter({ timeoutMs = 15000, maxConcurrent = 2, workerUrl = new URL('./docx-worker.js', import.meta.url) } = {}) {
  let active = 0;
  return async function convert(html) {
    if (typeof html !== 'string') throw failure('html must be a string', 400);
    if (Buffer.byteLength(html) > DOCX_INPUT_LIMIT) throw failure('DOCX input exceeds 4 MiB', 413);
    if (active >= maxConcurrent) throw failure('DOCX conversion is busy. Retry shortly.', 503);
    active++;
    try {
      return await new Promise((resolve, reject) => {
        const child = fork(workerUrl, [], { execArgv: ['--max-old-space-size=128'], serialization: 'advanced', windowsHide: true, stdio: ['ignore','ignore','ignore','ipc'] });
        let settled = false;
        const timer = setTimeout(() => finish(failure('DOCX conversion timed out', 504)), timeoutMs);
        function finish(error, buffer) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          child.kill();
          if (error) reject(error); else resolve(buffer);
        }
        child.once('error', () => finish(failure('DOCX conversion could not start', 503)));
        child.once('exit', () => finish(failure('DOCX conversion stopped unexpectedly', 422)));
        child.once('message', message => {
          if (message.error) return finish(failure(message.error, message.status || 422));
          if (!Buffer.isBuffer(message.buffer) || message.buffer.length > 16 * 1024 * 1024) return finish(failure('Invalid DOCX conversion result', 422));
          finish(null, message.buffer);
        });
        child.send({ html }, error => { if (error) finish(failure('DOCX conversion could not start', 503)); });
      });
    } finally { active--; }
  };
}

export const convertDocx = createDocxConverter();
