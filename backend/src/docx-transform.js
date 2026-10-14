import HTMLtoDOCX from '@turbodocx/html-to-docx';
import mammoth from 'mammoth';
import { validateDocxHtml, DOCX_INPUT_LIMIT } from './docx-input.js';

// Called only in a dedicated child process (API IPC or native framed stdio).
export async function transformDocx(mode, input) {
  if (mode === 'render') {
    if (!Buffer.isBuffer(input) || input.length > 16 * 1024 * 1024) throw new Error('Invalid DOCX preview input');
    const result = await mammoth.convertToHtml({ buffer: input }, {
      externalFileAccess: false,
      styleMap: ["p[style-name='Title'] => h1", "p[style-name='Heading 1'] => h2", "p[style-name='Heading 2'] => h3", "p[style-name='Heading 3'] => h4"],
    });
    const html = validateDocxHtml(result.value);
    if (Buffer.byteLength(html) > DOCX_INPUT_LIMIT) throw new Error('DOCX preview exceeds 4 MiB');
    return { html, messages: result.messages.slice(0, 100).map(item => ({
      type: item.type === 'error' ? 'error' : 'warning', message: String(item.message).slice(0, 1000),
    })) };
  }
  if (mode !== 'convert') throw new Error('Unsupported DOCX operation');
  const buffer = Buffer.from(await HTMLtoDOCX(validateDocxHtml(input), null, {
    table: { row: { cantSplit: true } }, preprocessing: { skipHTMLMinify: true },
    imageProcessing: { maxRetries: 0, maxImageSize: 2 * 1024 * 1024, maxCacheSize: 8 * 1024 * 1024, suppressSharpWarning: true },
  }));
  if (buffer.length > 16 * 1024 * 1024) throw new Error('Converted DOCX exceeds 16 MiB');
  return buffer;
}
