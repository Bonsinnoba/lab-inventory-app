import { useState } from 'react';
import type { Resource } from '../api/resources';
import { getResourceDownloadUrl } from '../api/resources';
import { localFileUrl } from '../api/resource-uploads';
import { isTauriRuntime } from '../lib/runtime';

/** Desktop image cards only use current native file grants, never HTTP fallback. */
export default function ResourceImageThumbnail({ resource }: { resource: Resource }) {
  const desktop = isTauriRuntime();
  const src = desktop ? localFileUrl(resource.id) : getResourceDownloadUrl(resource.id);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return src && src !== failedUrl
    ? <img src={src} alt={resource.name} className="w-full h-full object-cover" onError={() => setFailedUrl(src)}/>
    : <div className="w-full h-full flex items-center justify-center bg-surface-raised px-3 text-center text-xs text-text-secondary">
        {src ? 'Image preview could not be read' : desktop ? 'Image not available on this PC yet' : 'Image preview unavailable'}
      </div>;
}
