import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getResources, uploadFile, createLink, deleteResource, getResourceDownloadUrl, Resource } from '../api/resources';
import { useState, useRef } from 'react';
import { Upload, Link as LinkIcon, File, Folder, Trash2, Play } from 'lucide-react';
import ResourceViewerModal from './ResourceViewerModal';
import { useToast } from '../contexts/ToastContext';

interface ResourcesPanelProps {
  parent: { item_id?: string; project_id?: string; note_id?: string };
}

export default function ResourcesPanel({ parent }: ResourcesPanelProps) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [selectedResource, setSelectedResource] = useState<Resource | null>(null);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkName, setLinkName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: resources = [], isLoading, error } = useQuery<Resource[]>({
    queryKey: ['resources', parent],
    queryFn: () => getResources(parent),
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadFile(file, parent, undefined, setUploadProgress),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['resources', parent] });
      setUploadProgress(null);
      showToast('File uploaded');
    },
    onError: (err: any) => {
      setUploadProgress(null);
      showToast(err?.message || 'Upload failed', 'error');
    },
  });

  const linkMutation = useMutation({
    mutationFn: () => createLink(linkUrl, parent, linkName || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['resources', parent] });
      setShowLinkModal(false);
      setLinkUrl('');
      setLinkName('');
      showToast('Link added');
    },
    onError: (err: any) => showToast(err?.message || 'Failed to add link', 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteResource,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['resources', parent] });
      showToast('Resource deleted');
    },
    onError: (err: any) => showToast(err?.message || 'Failed to delete resource', 'error'),
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      uploadMutation.mutate(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      uploadMutation.mutate(file);
    }
  };

  const handleAddLink = () => {
    if (linkUrl) {
      linkMutation.mutate();
    }
  };

  const renderResourceCard = (resource: Resource) => {
    const thumbnailUrl = resource.thumbnail_url;
    const downloadUrl = getResourceDownloadUrl(resource.id);

    const renderThumbnail = () => {
      if (resource.kind === 'folder') {
        return (
          <div className="w-full h-full flex items-center justify-center bg-surface-raised">
            <Folder size={48} className="text-accent" />
          </div>
        );
      }

      if (resource.kind === 'link') {
        if (thumbnailUrl) {
          return (
            <img
              src={thumbnailUrl}
              alt={resource.name}
              className="w-full h-full object-cover"
            />
          );
        }
        return (
          <div className="w-full h-full flex items-center justify-center bg-surface-raised">
            <LinkIcon size={48} className="text-accent" />
          </div>
        );
      }

      if (resource.file_type === 'image' && !thumbnailUrl) {
        return (
          <img
            src={downloadUrl}
            alt={resource.name}
            className="w-full h-full object-cover"
          />
        );
      }

      if (resource.file_type === 'video') {
        return (
          <div className="w-full h-full flex items-center justify-center bg-surface-raised relative">
            <Play size={32} className="text-accent" />
            <video
              src={downloadUrl}
              className="absolute inset-0 w-full h-full object-cover opacity-50"
              preload="metadata"
            />
          </div>
        );
      }

      if (resource.file_type === 'audio') {
        return (
          <div className="w-full h-full flex items-center justify-center bg-surface-raised">
            <File size={48} className="text-accent" />
          </div>
        );
      }

      if (resource.file_type === 'pdf') {
        return (
          <div className="w-full h-full flex items-center justify-center bg-surface-raised">
            <File size={48} className="text-status-warn" />
          </div>
        );
      }

      return (
        <div className="w-full h-full flex items-center justify-center bg-surface-raised">
          <File size={48} className="text-text-secondary" />
        </div>
      );
    };

    return (
      <div
        key={resource.id}
        onClick={() => setSelectedResource(resource)}
        className="group relative bg-surface border border-border rounded-md overflow-hidden hover:border-accent transition-colors cursor-pointer"
      >
        <div className="aspect-video">
          {renderThumbnail()}
        </div>
        <div className="p-3">
          <div className="text-sm text-text-primary truncate" title={resource.name}>
            {resource.name}
          </div>
          <div className="text-xs text-text-secondary mt-1">
            {resource.size_bytes ? `${(resource.size_bytes / 1024 / 1024).toFixed(2)} MB` : ''}
          </div>
        </div>
        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              deleteMutation.mutate(resource.id);
            }}
            className="p-1.5 bg-surface-raised border border-border rounded-sm hover:bg-status-danger hover:border-status-danger transition-colors"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="bg-surface border border-border rounded-md p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-section-header font-ui font-semibold">Resources</h3>
        <div className="flex gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-3 py-1.5 bg-surface-raised border border-border rounded-sm hover:border-accent transition-colors text-sm"
          >
            <Upload size={16} />
            Upload
          </button>
          <button
            onClick={() => setShowLinkModal(true)}
            className="flex items-center gap-2 px-3 py-1.5 bg-surface-raised border border-border rounded-sm hover:border-accent transition-colors text-sm"
          >
            <LinkIcon size={16} />
            Add Link
          </button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        onChange={handleFileSelect}
        className="hidden"
      />

      {uploadProgress !== null && (
        <div className="mb-4 bg-surface-raised border border-border rounded-sm p-3">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-text-primary">Uploading...</span>
            <span className="text-text-secondary">{Math.round(uploadProgress)}%</span>
          </div>
          <div className="h-2 bg-bg rounded-sm overflow-hidden">
            <div
              className="h-full bg-accent transition-all duration-300"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        </div>
      )}

      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-md p-8 mb-4 transition-colors ${
          isDragOver ? 'border-accent bg-surface-raised' : 'border-border'
        }`}
      >
        <div className="text-center">
          <Upload size={32} className="mx-auto mb-2 text-text-secondary" />
          <p className="text-sm text-text-secondary">
            Drag and drop files here, or use the upload button
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-8 text-text-secondary">Loading...</div>
      ) : error ? (
        <div className="text-center py-8 text-status-danger">Error loading resources</div>
      ) : resources.length === 0 ? (
        <div className="text-center py-8 text-text-secondary">No resources yet</div>
      ) : (
        <div className="grid grid-cols-4 gap-4">
          {resources.map(renderResourceCard)}
        </div>
      )}

      {showLinkModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-surface border border-border rounded-md p-6 w-96">
            <h3 className="text-section-header font-ui font-semibold mb-4">Add Link</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-text-secondary mb-1">URL</label>
                <input
                  type="text"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full px-3 py-2 bg-bg border border-border rounded-sm text-text-primary focus:outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-1">Name (optional)</label>
                <input
                  type="text"
                  value={linkName}
                  onChange={(e) => setLinkName(e.target.value)}
                  placeholder="Link name"
                  className="w-full px-3 py-2 bg-bg border border-border rounded-sm text-text-primary focus:outline-none focus:border-accent"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setShowLinkModal(false)}
                  className="px-4 py-2 bg-surface-raised border border-border rounded-sm hover:bg-surface-raised transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddLink}
                  disabled={!linkUrl || linkMutation.isPending}
                  className="px-4 py-2 bg-accent text-bg rounded-sm hover:bg-accent-dim transition-colors disabled:opacity-50"
                >
                  Add Link
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedResource && (
        <ResourceViewerModal
          resource={selectedResource}
          resources={resources}
          onClose={() => setSelectedResource(null)}
        />
      )}
    </div>
  );
}
