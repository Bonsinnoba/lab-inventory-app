import ResourceViewerModal from './ResourceViewerModal';
import type { Resource } from '../api/resources';
import { getLocalMediaUrl } from '../api/mediaDownloads';
import { Download, Video, X } from 'lucide-react';

interface Props {
  resource: Resource;
  resources?: Resource[];
  onClose: () => void;
  onEdit?: (resource: Resource) => void;
}

const videoExtensions = new Set(['mp4', 'webm', 'mov', 'm4v', 'mkv']);

function isDownloadedVideo(resource: Resource) {
  if (!resource.local_media_filename) return false;
  const mime = resource.local_media_mime_type || resource.mime_type || '';
  if (mime.startsWith('video/')) return true;
  const ext = resource.local_media_filename.split('.').pop()?.toLowerCase() || '';
  return videoExtensions.has(ext);
}

function localVideoResource(resource: Resource): Resource {
  const filename = resource.local_media_filename || 'video.mp4';
  const ext = filename.split('.').pop()?.toLowerCase() || 'mp4';
  const displayName = /\.[a-z0-9]{2,5}$/i.test(resource.name || '')
    ? resource.name
    : `${resource.name || filename}.${ext}`;

  return {
    ...resource,
    kind: 'file',
    file_type: 'video',
    name: displayName,
    original_filename: filename,
    url: getLocalMediaUrl(resource.id),
    mime_type: resource.local_media_mime_type || resource.mime_type || `video/${ext}`,
  };
}

export default function ResourceViewerModalLocal({ resource, resources = [], onClose, onEdit }: Props) {
  const hasLocalMedia = isDownloadedVideo(resource);

  if (!hasLocalMedia) {
    return <ResourceViewerModal resource={resource} resources={resources} onClose={onClose} onEdit={onEdit} />;
  }

  const localUrl = getLocalMediaUrl(resource.id);
  const prepared = localVideoResource(resource);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-3">
      <div className="flex h-full max-h-[90vh] w-full max-w-6xl min-h-0 flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900">
        <div className="flex min-h-12 items-center justify-between gap-3 border-b border-slate-800 px-4">
          <div className="flex min-w-0 items-center gap-2">
            <Video size={16} className="shrink-0 text-slate-400" />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-slate-100">{resource.name}</div>
              <div className="text-[10px] text-slate-500">DOWNLOADED • LOCAL PLAYBACK • {resource.local_media_filename}</div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <a href={localUrl} download={resource.local_media_filename} className="rounded p-1.5 text-slate-300 hover:bg-slate-800" title="Download local copy">
              <Download size={14} />
            </a>
            <button onClick={onClose} className="rounded p-1.5 text-slate-300 hover:bg-slate-800" title="Close viewer" aria-label="Close viewer">
              <X size={15} />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 bg-black p-3">
          <video
            key={prepared.id}
            controls
            playsInline
            preload="metadata"
            src={localUrl}
            className="h-full w-full object-contain"
          />
        </div>
      </div>
    </div>
  );
}
