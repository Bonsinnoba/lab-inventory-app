import { fork } from 'node:child_process';
import { DOCX_INPUT_LIMIT } from './docx-input.js';

export const DOCX_FILE_LIMIT = 16 * 1024 * 1024;

function failure(message, status) { return Object.assign(new Error(message), { status }); }

// Isolate parser CPU/heap failures from the API. There is no unbounded job queue.
// Options are internal test seams, never derived from a request.
export function createDocxConverter({ timeoutMs = 15000, maxConcurrent = 2, workerUrl = new URL('./docx-worker.js', import.meta.url) } = {}) {
  let active = 0;
  async function run(mode, input) {
    if (mode === 'render') {
      if (!Buffer.isBuffer(input)) throw failure('DOCX input must be binary', 400);
      if (input.length > DOCX_FILE_LIMIT) throw failure('DOCX input exceeds 16 MiB', 413);
      if (input.length < 4 || !input.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4]))) throw failure('Invalid DOCX file', 422);
    } else {
      if (typeof input !== 'string') throw failure('html must be a string', 400);
      if (Buffer.byteLength(input) > DOCX_INPUT_LIMIT) throw failure('DOCX input exceeds 4 MiB', 413);
    }
    if (active >= maxConcurrent) throw failure('DOCX conversion is busy. Retry shortly.', 503);
    active++;
    try {
      return await new Promise((resolve, reject) => {
        const child = fork(workerUrl, [], { execArgv: ['--max-old-space-size=128'], serialization: 'advanced', windowsHide: true, stdio: ['ignore','ignore','ignore','ipc'],
          // Do not pass database credentials, tokens or NODE_OPTIONS to parsers.
          env: Object.fromEntries(['SystemRoot','WINDIR','TEMP','TMP','TMPDIR','PATH'].filter(key => process.env[key]).map(key => [key, process.env[key]])),
        });
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
          if (!message || typeof message !== 'object') return finish(failure('Invalid DOCX conversion result', 422));
          if (message.error) return finish(failure(message.error, message.status || 422));
          if (mode === 'render') {
            if (typeof message.html !== 'string' || Buffer.byteLength(message.html) > DOCX_INPUT_LIMIT ||
                !Array.isArray(message.messages) || message.messages.length > 100 ||
                message.messages.some(item => !item || typeof item.message !== 'string' || item.message.length > 1000 || !['warning','error'].includes(item.type))) {
              return finish(failure('Invalid DOCX preview result', 422));
            }
            return finish(null, { html: message.html, messages: message.messages });
          }
          if (!Buffer.isBuffer(message.buffer) || message.buffer.length > DOCX_FILE_LIMIT) return finish(failure('Invalid DOCX conversion result', 422));
          finish(null, message.buffer);
        });
        child.send(mode === 'render' ? { mode, buffer: input } : { mode, html: input }, error => { if (error) finish(failure('DOCX conversion could not start', 503)); });
      });
    } finally { active--; }
  }
  const convert = html => run('convert', html);
  convert.render = buffer => run('render', buffer);
  return convert;
}

export const convertDocx = createDocxConverter();
// Read and write work share the same two-process limit; there is no wait queue.
export const renderDocx = buffer => convertDocx.render(buffer);
