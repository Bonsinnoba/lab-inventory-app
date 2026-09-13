import { useEffect, useState } from 'react';
import { apiFetch } from '../api/http';
import { getLocalThumbnailUrl } from '../api/mediaDownloads';

interface ResourceThumbnailProps {
  resourceId: string;
  fallbackUrl?: string;
  alt: string;
  className?: string;
}

export default function ResourceThumbnail({ resourceId, fallbackUrl, alt, className = 'w-full h-full object-cover' }: ResourceThumbnailProps) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    const controller = new AbortController();

    const load = async () => {
      try {
        const response = await apiFetch(`/media-downloads/${resourceId}/thumbnail`, { signal: controller.signal });
        if (!response.ok) throw new Error(`Thumbnail request failed: ${response.status}`);
        const blob = await response.blob();
        if (!blob.size) throw new Error('Thumbnail response was empty');
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      } catch (error) {
        if ((error as Error)?.name !== 'AbortError') {
          console.warn(`LabOS thumbnail load failed for resource ${resourceId}`, error);
          setSrc(fallbackUrl || getLocalThumbnailUrl(resourceId));
        }
      }
    };

    void load();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [resourceId, fallbackUrl]);

  return <img src={src || fallbackUrl || getLocalThumbnailUrl(resourceId)} alt={alt} className={className} />;
}
