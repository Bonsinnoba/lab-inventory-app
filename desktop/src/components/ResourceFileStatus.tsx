import type {Resource} from '../api/resources';
import {isTauriRuntime} from '../lib/runtime';

export default function ResourceFileStatus({resource:r}:{resource:Resource}){
  if(!isTauriRuntime()||!(r.kind==='file'||r.local_media_filename))return null;
  const copy=r.local_copy;
  const message=r.local_file_available?'LOCAL':copy?.error?'ERROR':
    copy?.state==='copying'&&copy.size_bytes?`${Math.floor(copy.verified_bytes/copy.size_bytes*100)}%`:
    'COPYING';
  return <span className={`ui-badge ${r.local_file_available?'ui-badge-ok':copy?.error?'ui-badge-warn':''}`} title={copy?.error||message}>{message}</span>;
}
