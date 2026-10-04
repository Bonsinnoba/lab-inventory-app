import HTMLtoDOCX from '@turbodocx/html-to-docx';
import { validateDocxHtml } from './docx-input.js';

process.once('message', async ({ html }) => {
  try {
    const buffer = Buffer.from(await HTMLtoDOCX(validateDocxHtml(html), null, {
      table: { row: { cantSplit: true } },
      preProcessing: { skipHTMLMinify: true },
      imageProcessing: { maxRetries: 0, maxImageSize: 2 * 1024 * 1024, maxCacheSize: 8 * 1024 * 1024, suppressSharpWarning: true },
    }));
    if (buffer.length > 16 * 1024 * 1024) throw new Error('Converted DOCX exceeds 16 MiB');
    process.send({ buffer }, () => process.exit(0));
  } catch (error) {
    process.send({ error: error.message, status: error.status || 422 }, () => process.exit(0));
  }
});
