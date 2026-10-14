import { transformDocx } from './docx-transform.js';

process.once('message', async ({ mode, html, buffer }) => {
  try {
    const result = await transformDocx(mode, mode === 'render' ? buffer : html);
    process.send(mode === 'render' ? result : { buffer: result }, () => process.exit(0));
  } catch (error) {
    process.send({ error: error.message, status: error.status || 422 }, () => process.exit(0));
  }
});
