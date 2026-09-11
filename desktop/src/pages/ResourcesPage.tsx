import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAllResources, uploadFile, createLink, deleteResource, Resource } from '../api/resources';
import { getItems } from '../api/items';
import { getProjects } from '../api/projects';
import { getNotes } from '../api/notes';
import { useState, useRef } from 'react';
import { Upload, Link as LinkIcon, File, Folder, Trash2, Play } from 'lucide-react';
import ResourceViewerModal from '../components/ResourceViewerModal';
import { useToast } from '../contexts/ToastContext';
import { getResourceDownloadUrl } from '../api/resources';

type ParentType = 'none' | 'item' | 'project' | 'note';

export default function ResourcesPage() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showAttachModal, setShowAttachModal] = useState<{ mode: 'upload' | 'link'; file?: File } | null>(null);
  const [selectedResource, setSelectedResource] = useState<Resource | null>(null);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkName, setLinkName] = useState('');
  const [category, setCategory] = useState('general');
  const [description, setDescription] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [parentType, setParentType] = useState<ParentType>('none');
  const [parentId, setParentId] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: resources = [], isLoading, error } = useQuery<Resource[]>({
    queryKey: ['resources', 'all'],
    queryFn: getAllResources,
  });

  const { data: items = [] } = useQuery({ queryKey: ['items', 'picker'], queryFn: () => getItems() });
  const { data: projects = [] } = useQuery({ queryKey: ['projects', 'picker'], queryFn: getProjects });
  const { data: notes = [] } = useQuery({ queryKey: ['notes', 'picker'], queryFn: () => getNotes() });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['resources', 'all'] });

  const parentPayload = () => ({
    item_id: parentType === 'item' ? parentId : undefined,
    project_id: parentType === 'project' ? parentId : undefined,
    note_id: parentType === 'note' ? parentId : undefined,
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadFile(file, parentPayload(), undefined, setUploadProgress, { category, description, tags: tagsInput.split(',').map(t => t.trim()).filter(Boolean) }),
    onSuccess: () => {
      invalidate();
      setUploadProgress(null);
      setShowAttachModal(null);
      setCategory('general'); setDescription(''); setTagsInput('');
      showToast('File uploaded');
    },
    onError: (err: any) => {
      setUploadProgress(null);
      showToast(err?.message || 'Upload failed', 'error');
    },
  });

  const linkMutation = useMutation({
    mutationFn: () => createLink(linkUrl, parentPayload(), linkName || undefined, { category, description, tags: tagsInput.split(',').map(t => t.trim()).filter(Boolean) }),
    onSuccess: () => {
      invalidate();
      setShowAttachModal(null);
      setLinkUrl('');
      setLinkName('');
      setCategory('general'); setDescription(''); setTagsInput('');
      showToast('Link added');
    },
    onError: (err: any) => showToast(err?.message || 'Failed to add link', 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteResource,
    onSuccess: () => {
      invalidate();
      showToast('Resource deleted');
    },
    onError: (err: any) => showToast(err?.message || 'Failed to delete resource', 'error'),
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setShowAttachModal({ mode: 'upload', file });
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) setShowAttachModal({ mode: 'upload', file });
  };

  const confirmAttach = () => {
    if (parentType !== 'none' && !parentId) return;
    if (showAttachModal?.mode === 'upload' && showAttachModal.file) {
      uploadMutation.mutate(showAttachModal.file);
    } else if (showAttachModal?.mode === 'link') {
      linkMutation.mutate();
    }
  };

  const attachedToLabel = (r: Resource) => {
    if (r.item_name) return `Item: ${r.item_name}`;
    if (r.project_name) return `Project: ${r.project_name}`;
    if (r.note_title) return `Note: ${r.note_title}`;
    return 'Unattached';
  };

  const renderThumbnail = (resource: Resource) => {
    const thumbnailUrl = resource.thumbnail_url;
    const downloadUrl = getResourceDownloadUrl(resource.id);

    if (resource.kind === 'folder') {
      return (
        <div className="w-full h-full flex items-center justify-center bg-surface-raised">
          <Folder size={48} className="text-accent" />
        </div>
      );
    }
    if (resource.kind === 'link') {
      return thumbnailUrl ? (
        <img src={thumbnailUrl} alt={resource.name} className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-surface-raised">
          <LinkIcon size={48} className="text-accent" />
        </div>
      );
    }
    if (resource.file_type === 'image' && !thumbnailUrl) {
      return <img src={downloadUrl} alt={resource.name} className="w-full h-full object-cover" />;
    }
    if (resource.file_type === 'video') {
      return (
        <div className="w-full h-full flex items-center justify-center bg-surface-raised relative">
          <Play size={32} className="text-accent" />
          <video src={downloadUrl} className="absolute inset-0 w-full h-full object-cover opacity-50" preload="metadata" />
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

  const parentOptions = parentType === 'item' ? items : parentType === 'project' ? projects : parentType === 'note' ? notes : [];

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-page-title font-ui font-semibold">Resources</h2>
        <div className="flex gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-3 py-1.5 bg-surface-raised border border-border rounded-sm hover:border-accent transition-colors text-sm"
          >
            <Upload size={16} />
            Upload
          </button>
          <button
            onClick={() => setShowAttachModal({ mode: 'link' })}
            className="flex items-center gap-2 px-3 py-1.5 bg-surface-raised border border-border rounded-sm hover:border-accent transition-colors text-sm"
          >
            <LinkIcon size={16} />
            Add Link
          </button>
        </div>
      </div>

      <input ref={fileInputRef} type="file" onChange={handleFileSelect} className="hidden" />

      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={(e) => { e.preventDefault(); setIsDragOver(false); }}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-md p-8 mb-6 text-center transition-colors ${
          isDragOver ? 'border-accent bg-accent/5' : 'border-border'
        }`}
      >
        <Upload size={32} className="mx-auto mb-2 text-text-secondary" />
        <p className="text-text-secondary text-sm">Drag and drop files here, or use the upload button</p>
      </div>

      {isLoading ? (
        <div className="text-text-secondary text-sm py-8 text-center">Loading…</div>
      ) : error ? (
        <div className="text-status-danger text-sm py-8 text-center">Error loading resources</div>
      ) : resources.length === 0 ? (
        <div className="text-text-secondary text-sm py-8 text-center">
          No resources yet across the lab — upload a file or add a link to get started.
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
          {resources.map((resource) => (
            <div
              key={resource.id}
              onClick={() => setSelectedResource(resource)}
              className="group relative bg-surface border border-border rounded-md overflow-hidden hover:border-accent transition-colors cursor-pointer"
            >
              <div className="aspect-video">{renderThumbnail(resource)}</div>
              <div className="p-3">
                <div className="text-sm text-text-primary truncate" title={resource.name}>
                  {resource.name}
                </div>
                <div className="text-xs text-text-secondary mt-1 truncate">
                  {attachedToLabel(resource)}
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
          ))}
        </div>
      )}

      {showAttachModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowAttachModal(null)}>
          <div className="bg-surface border border-border rounded-md p-6 w-96" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-section-header font-ui font-semibold mb-4">
              {showAttachModal.mode === 'upload' ? `Attach "${showAttachModal.file?.name}" to…` : 'Add Link'}
            </h3>

            {showAttachModal.mode === 'link' && (
              <div className="space-y-3 mb-4">
                <input
                  type="text"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  placeholder="https://…"
                  className="w-full bg-surface-raised border border-border rounded-sm px-3 py-2 text-sm focus:outline-none focus:border-accent"
                />
                <input
                  type="text"
                  value={linkName}
                  onChange={(e) => setLinkName(e.target.value)}
                  placeholder="Label (optional)"
                  className="w-full bg-surface-raised border border-border rounded-sm px-3 py-2 text-sm focus:outline-none focus:border-accent"
                />
              </div>
            )}

            <div className="space-y-3 mb-4">
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-text-secondary col-span-2">Knowledge category
                  <select value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1 w-full px-3 py-2 bg-surface-raised border border-border rounded-sm text-sm">
                    {['general','datasheet','manual','schematic','research','tutorial','reference','specification','image','cad','report','video','other'].map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label className="text-xs text-text-secondary col-span-2">Description
                  <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="What is this useful for?" className="mt-1 w-full px-3 py-2 bg-surface-raised border border-border rounded-sm text-sm resize-none" />
                </label>
                <label className="text-xs text-text-secondary col-span-2">Tags <span className="opacity-70">(comma separated)</span>
                  <input value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} placeholder="esp32, power, reference" className="mt-1 w-full px-3 py-2 bg-surface-raised border border-border rounded-sm text-sm" />
                </label>
              </div>
              <div className="flex gap-2">
                {(['none', 'item', 'project', 'note'] as ParentType[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => { setParentType(t); setParentId(''); }}
                    className={`flex-1 px-3 py-1.5 rounded-sm text-sm border transition-colors capitalize ${
                      parentType === t ? 'bg-accent/10 border-accent text-accent' : 'bg-surface-raised border-border text-text-secondary'
                    }`}
                  >
                    {t === 'none' ? 'None' : t}
                  </button>
                ))}
              </div>
              {parentType === 'none' ? (
                <p className="text-xs text-text-secondary px-1">
                  Not attached to anything — it'll live in the general resource library and can be linked to something later.
                </p>
              ) : (
                <select
                  value={parentId}
                  onChange={(e) => setParentId(e.target.value)}
                  className="w-full bg-surface-raised border border-border rounded-sm px-3 py-2 text-sm focus:outline-none focus:border-accent"
                >
                  <option value="">Select {parentType}…</option>
                  {parentOptions.map((opt: any) => (
                    <option key={opt.id} value={opt.id}>{opt.name || opt.title}</option>
                  ))}
                </select>
              )}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setShowAttachModal(null)}
                className="flex-1 px-4 py-2 bg-surface border border-border rounded-sm hover:bg-surface-raised transition-colors text-sm"
              >
                Cancel
              </button>
              <button
                onClick={confirmAttach}
                disabled={(parentType !== 'none' && !parentId) || (showAttachModal.mode === 'link' && !linkUrl.trim())}
                className="flex-1 px-4 py-2 bg-accent text-bg rounded-sm hover:bg-accent-dim transition-colors text-sm disabled:opacity-40"
              >
                Attach
              </button>
            </div>

            {uploadProgress !== null && (
              <div className="mt-3 h-2 bg-bg rounded-sm overflow-hidden">
                <div className="h-full bg-accent transition-all" style={{ width: `${uploadProgress}%` }} />
              </div>
            )}
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
