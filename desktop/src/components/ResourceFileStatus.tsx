import type {Resource} from '../api/resources';
import {isTauriRuntime} from '../lib/runtime';

export default function ResourceFileStatus({resource:r}:{resource:Resource}){
  if(!isTauriRuntime()||!(r.kind==='file'||r.local_media_filename))return null;
  const copy=r.local_copy;
  const message=r.local_file_available?'Available on this PC':copy?.error?'PC copy needs attention':
    copy?.state==='copying'&&copy.size_bytes?`Copying to PC · ${Math.floor(copy.verified_bytes/copy.size_bytes*100)}%`:
    'Waiting for verified PC copy';
  return <p className={`mt-2 text-xs ${r.local_file_available?'text-status-success':copy?.error?'text-status-warn':'text-text-secondary'}`} title={copy?.error||message}>{message}</p>;
}
