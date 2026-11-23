import ResourceViewerModal from './ResourceViewerModal';
import type { Resource } from '../api/resources';

interface Props {
  resource: Resource;
  resources?: Resource[];
  navigationIds?: string[];
  outerResources?: Resource[];
  folderOriginId?: string;
  onClose: () => void;
  onEdit?: (resource: Resource) => void;
}

// Keep the original link and its resource identity intact. The viewer chooses
// verified local media separately from an explicit original-source online preview.
export default function ResourceViewerModalLocal({ resource, resources = [], navigationIds, outerResources, folderOriginId, onClose, onEdit }: Props) {
  return (
    <ResourceViewerModal
      resource={resource}
      resources={resources}
      navigationIds={navigationIds}
      outerResources={outerResources}
      folderOriginId={folderOriginId}
      onClose={onClose}
      onEdit={onEdit}
    />
  );
}
