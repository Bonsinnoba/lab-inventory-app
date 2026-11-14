import ResourceViewerModal from './ResourceViewerModal';
import type { Resource } from '../api/resources';

interface Props {
  resource: Resource;
  resources?: Resource[];
  onClose: () => void;
  onEdit?: (resource: Resource) => void;
}

// Keep the original link and its resource identity intact. The viewer chooses
// verified local media separately from an explicit original-source online preview.
export default function ResourceViewerModalLocal({ resource, resources = [], onClose, onEdit }: Props) {
  return (
    <ResourceViewerModal
      resource={resource}
      resources={resources}
      onClose={onClose}
      onEdit={onEdit}
    />
  );
}
