import ResourceViewerModal from './ResourceViewerModal';
import type { Resource } from '../api/resources';
import { getLocalMediaUrl } from '../api/mediaDownloads';

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

function prepareLocalVideo(resource: Resource): Resource {
  const filename = resource.local_media_filename || 'video.mp4';
  const ext = filename.split('.').pop()?.toLowerCase() || 'mp4';
  return {
    ...resource,
    kind: 'file',
    file_type: 'video',
    name: /\.[a-z0-9]{2,5}$/i.test(resource.name || '') ? resource.name : `${resource.name || filename}.${ext}`,
    original_filename: filename,
    url: getLocalMediaUrl(resource.id),
    mime_type: resource.local_media_mime_type || resource.mime_type || `video/${ext}`,
  };
}

export default function ResourceViewerModalLocal({ resource, resources = [], onClose, onEdit }: Props) {
  const prepare = (item: Resource) => isDownloadedVideo(item) ? prepareLocalVideo(item) : item;
  const preparedResource = prepare(resource);
  const preparedResources = resources.map(prepare);

  return (
    <ResourceViewerModal
      resource={preparedResource}
      resources={preparedResources}
      onClose={onClose}
      onEdit={onEdit}
    />
  );
}
