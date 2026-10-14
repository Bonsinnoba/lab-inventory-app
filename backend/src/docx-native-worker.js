import { transformDocx } from './docx-transform.js';

// One binary frame per process: mode byte + uint32-BE length + body.
// 1 = DOCX -> JSON preview; 2 = UTF-8 HTML -> DOCX; 3 = JSON error response.
// No paths, auth values or executable names are accepted in this protocol.
function reply(kind, body) {
  const header = Buffer.alloc(5); header[0] = kind; header.writeUInt32BE(body.length, 1);
  process.stdout.write(header); process.stdout.write(body, () => process.exit(0));
}
try {
  let length = 0; const chunks = [];
  for await (const chunk of process.stdin) {
    length += chunk.length;
    if (length > 16 * 1024 * 1024 + 5) throw new Error('DOCX input frame is too large');
    chunks.push(chunk);
  }
  const frame = Buffer.concat(chunks);
  if (frame.length < 5 || frame.readUInt32BE(1) !== frame.length - 5 || ![1, 2].includes(frame[0])) throw new Error('Invalid DOCX input frame');
  const body = frame.subarray(5);
  if (frame[0] === 2 && body.length > 4 * 1024 * 1024) throw new Error('DOCX markup exceeds 4 MiB');
  const result = await transformDocx(frame[0] === 1 ? 'render' : 'convert', frame[0] === 1 ? body : new TextDecoder('utf-8', { fatal: true }).decode(body));
  reply(frame[0], frame[0] === 1 ? Buffer.from(JSON.stringify(result)) : result);
} catch (error) {
  reply(3, Buffer.from(JSON.stringify({ error: String(error.message || 'DOCX conversion failed').slice(0, 1000) })));
}
