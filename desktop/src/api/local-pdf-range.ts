import { pdfjs } from 'react-pdf';
import { captureAccountSession, isAccountSessionCurrent } from './auth';

const CHUNK = 1024 * 1024;
// PDF.js may coalesce adjacent chunks. Bound each assembled response and queue
// work serially: a malformed document must not trigger many large allocations.
const MAX_REQUEST = 16 * CHUNK;
const MAX_FILE = 500 * CHUNK;
export const LOCAL_PDF_OPTIONS = { disableStream: true, disableAutoFetch: true, rangeChunkSize: CHUNK };

export async function openLocalPdfRange(url: string, signal: AbortSignal, onError: (error: Error) => void) {
  const parsed = new URL(url);
  if (!(parsed.protocol === 'labos-file:' ||
      (['http:', 'https:'].includes(parsed.protocol) && parsed.hostname === 'labos-file.localhost'))) {
    throw new Error('Local PDF access requires a native file URL');
  }
  const session = captureAccountSession();
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal.addEventListener('abort', cancel, { once: true });
  const stop = () => { cancel(); signal.removeEventListener('abort', cancel); };
  if (signal.aborted) stop();
  const check = () => {
    if (controller.signal.aborted) throw new Error('PDF preview closed');
    if (!session || !isAccountSessionCurrent(session)) throw new Error('Account changed. Reopen the PDF.');
  };
  let revision: string | null = null;
  let size: number | null = null;
  const read = async (begin: number, end: number) => {
    check();
    const target = new URL(url);
    if (revision) target.searchParams.set('revision', revision);
    const response = await fetch(target.toString(), {
      headers: { Range: `bytes=${begin}-${end - 1}` }, signal: controller.signal,
      cache: 'no-store', redirect: 'error',
    });
    check();
    const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('Content-Range') || '');
    const currentRevision = response.headers.get('X-LabOS-File-Revision');
    if (response.status !== 206 || !match || !currentRevision || !/^[a-f0-9]{64}$/.test(currentRevision)) {
      throw new Error('Local PDF is unavailable. Reopen it after checking access and the desktop version.');
    }
    const total = Number(match[3]);
    const last = Math.min(end, total) - 1;
    if (!Number.isSafeInteger(total) || total < 5 || total > MAX_FILE ||
        Number(match[1]) !== begin || Number(match[2]) !== last || last < begin ||
        Number(response.headers.get('Content-Length')) !== last - begin + 1 ||
        (size !== null && size !== total) || (revision !== null && currentRevision !== revision)) {
      throw new Error('PDF content changed or its local range is invalid. Reopen the PDF.');
    }
    size = total; revision = currentRevision;
    const bytes = new Uint8Array(await response.arrayBuffer());
    check();
    if (bytes.length !== last - begin + 1) throw new Error('Incomplete local PDF read. Reopen the PDF.');
    return bytes;
  };
  try {
    const initial = await read(0, CHUNK);
    class LocalPdfTransport extends pdfjs.PDFDataRangeTransport {
      private pending = Promise.resolve();
      private queued = 0;
      private failed = false;
      private fail(error: unknown) {
        if (this.failed || controller.signal.aborted) return;
        this.failed = true; stop();
        onError(error instanceof Error ? error : new Error('Local PDF read failed'));
      }
      requestDataRange(begin: number, end: number) {
        if (this.failed || controller.signal.aborted) return;
        if (!Number.isSafeInteger(begin) || !Number.isSafeInteger(end) || begin < 0 || end <= begin ||
            end > this.length || end - begin > MAX_REQUEST || this.queued >= 64) {
          this.fail(new Error('This PDF exceeds the bounded preview limits.')); return;
        }
        this.queued++;
        this.pending = this.pending.then(async () => {
          check();
          const bytes = new Uint8Array(end - begin);
          for (let offset = begin; offset < end; offset += CHUNK) {
            bytes.set(await read(offset, Math.min(end, offset + CHUNK)), offset - begin);
          }
          check(); this.onDataRange(begin, bytes);
        }).catch(error => this.fail(error)).finally(() => { this.queued--; });
      }
      abort() { stop(); }
    }
    return new LocalPdfTransport(size!, initial, true);
  } catch (error) { stop(); throw error; }
}
