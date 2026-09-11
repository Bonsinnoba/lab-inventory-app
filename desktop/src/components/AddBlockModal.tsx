import { useState } from 'react';
import { X, Type, Image, Video, FileText, Music, Link as LinkIcon, Folder } from 'lucide-react';
import { uploadFile, createFolder, uploadFolderFiles, createLink, Resource } from '../api/resources';

type BlockKind = 'text' | 'image' | 'video' | 'pdf' | 'audio' | 'link' | 'folder';

interface AddBlockModalProps {
  projectId: string;
  onClose: () => void;
  onCreate: (block: { block_type: BlockKind; title?: string; text_content?: string; resource_id?: string }) => void;
}

const MEDIA_TYPES: { id: BlockKind; label: string; icon: typeof Image; accept?: string }[] = [
  { id: 'image', label: 'Image', icon: Image, accept: 'image/*' },
  { id: 'video', label: 'Video', icon: Video, accept: 'video/*' },
  { id: 'pdf', label: 'PDF', icon: FileText, accept: 'application/pdf' },
  { id: 'audio', label: 'Audio', icon: Music, accept: 'audio/*' },
];

export default function AddBlockModal({ projectId, onClose, onCreate }: AddBlockModalProps) {
  const [mode, setMode] = useState<'choose' | 'text' | 'link' | 'uploading'>('choose');
  const [textValue, setTextValue] = useState('');
  const [textTitle, setTextTitle] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkName, setLinkName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleUpload = async (file: File, blockType: BlockKind) => {
    setMode('uploading');
    setError(null);
    try {
      const resource: Resource = await uploadFile(file, { project_id: projectId });
      onCreate({ block_type: blockType, resource_id: resource.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed. Please try again.');
      setMode('choose');
    }
  };

  const handleFolderUpload = async (fileList: FileList) => {
    if (fileList.length === 0) return;
    setMode('uploading');
    setError(null);
    try {
      const files = Array.from(fileList);
      // webkitRelativePath looks like "MySchematics/rev1/board.svg" —
      // strip the top-level folder name (that becomes the folder
      // resource's own name) and keep the rest as each file's path
      // within it, so nested subfolders survive.
      const topLevelName = files[0].webkitRelativePath.split('/')[0] || 'Folder';
      const relativePaths = files.map((f) => f.webkitRelativePath.split('/').slice(1).join('/'));

      const folderResource = await createFolder(topLevelName, { project_id: projectId });
      await uploadFolderFiles(folderResource.id, files, relativePaths);
      onCreate({ block_type: 'folder', resource_id: folderResource.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Folder upload failed. Please try again.');
      setMode('choose');
    }
  };

  const handleLinkSubmit = async () => {
    if (!linkUrl.trim()) return;
    setError(null);
    try {
      const resource = await createLink(linkUrl.trim(), { project_id: projectId }, linkName.trim() || undefined);
      const isYouTube = resource.file_type === 'youtube';
      onCreate({ block_type: isYouTube ? 'link' : 'link', resource_id: resource.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add that link.');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-surface border border-border rounded-md p-6 w-96 max-h-[80vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-section-header font-ui font-semibold">Add Block</h3>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary">
            <X size={18} />
          </button>
        </div>

        {error && (
          <div className="mb-3 text-sm text-status-danger bg-status-danger/10 border border-status-danger/30 rounded-sm px-3 py-2">
            {error}
          </div>
        )}

        {mode === 'choose' && (
          <div className="space-y-2">
            <button
              onClick={() => setMode('text')}
              className="w-full flex items-center gap-3 px-4 py-3 bg-surface-raised border border-border rounded-sm hover:border-accent transition-colors text-left"
            >
              <Type size={18} className="text-text-secondary flex-shrink-0" />
              <div>
                <div className="font-medium text-sm">Text</div>
                <div className="text-xs text-text-secondary">Write a note</div>
              </div>
            </button>

            {MEDIA_TYPES.map(({ id, label, icon: Icon, accept }) => (
              <label
                key={id}
                className="w-full flex items-center gap-3 px-4 py-3 bg-surface-raised border border-border rounded-sm hover:border-accent transition-colors text-left cursor-pointer"
              >
                <Icon size={18} className="text-text-secondary flex-shrink-0" />
                <div>
                  <div className="font-medium text-sm">{label}</div>
                  <div className="text-xs text-text-secondary">Upload a {label.toLowerCase()} file</div>
                </div>
                <input
                  type="file"
                  accept={accept}
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleUpload(file, id);
                  }}
                />
              </label>
            ))}

            <label className="w-full flex items-center gap-3 px-4 py-3 bg-surface-raised border border-border rounded-sm hover:border-accent transition-colors text-left cursor-pointer">
              <Folder size={18} className="text-text-secondary flex-shrink-0" />
              <div>
                <div className="font-medium text-sm">Folder</div>
                <div className="text-xs text-text-secondary">Upload a whole folder (e.g. schematics)</div>
              </div>
              <input
                type="file"
                // @ts-ignore — webkitdirectory isn't in the standard DOM lib types
                webkitdirectory=""
                directory=""
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) handleFolderUpload(e.target.files);
                }}
              />
            </label>

            <button
              onClick={() => setMode('link')}
              className="w-full flex items-center gap-3 px-4 py-3 bg-surface-raised border border-border rounded-sm hover:border-accent transition-colors text-left"
            >
              <LinkIcon size={18} className="text-text-secondary flex-shrink-0" />
              <div>
                <div className="font-medium text-sm">Link</div>
                <div className="text-xs text-text-secondary">YouTube or any URL</div>
              </div>
            </button>
          </div>
        )}

        {mode === 'text' && (
          <div className="space-y-3">
            <input
              type="text"
              value={textTitle}
              onChange={(e) => setTextTitle(e.target.value)}
              placeholder="Title (optional)"
              className="w-full bg-surface-raised border border-border rounded-sm px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent"
            />
            <textarea
              autoFocus
              value={textValue}
              onChange={(e) => setTextValue(e.target.value)}
              placeholder="Write a note…"
              rows={6}
              className="w-full bg-surface-raised border border-border rounded-sm px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent resize-none"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setMode('choose')}
                className="flex-1 px-4 py-2 bg-surface border border-border rounded-sm hover:bg-surface-raised transition-colors text-sm"
              >
                Back
              </button>
              <button
                onClick={() => textValue.trim() && onCreate({ block_type: 'text', title: textTitle.trim() || undefined, text_content: textValue.trim() })}
                disabled={!textValue.trim()}
                className="flex-1 px-4 py-2 bg-accent text-bg rounded-sm hover:bg-accent-dim transition-colors text-sm disabled:opacity-40"
              >
                Add
              </button>
            </div>
          </div>
        )}

        {mode === 'link' && (
          <div className="space-y-3">
            <input
              autoFocus
              type="text"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="https://…"
              className="w-full bg-surface-raised border border-border rounded-sm px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent"
            />
            <input
              type="text"
              value={linkName}
              onChange={(e) => setLinkName(e.target.value)}
              placeholder="Label (optional)"
              className="w-full bg-surface-raised border border-border rounded-sm px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setMode('choose')}
                className="flex-1 px-4 py-2 bg-surface border border-border rounded-sm hover:bg-surface-raised transition-colors text-sm"
              >
                Back
              </button>
              <button
                onClick={handleLinkSubmit}
                disabled={!linkUrl.trim()}
                className="flex-1 px-4 py-2 bg-accent text-bg rounded-sm hover:bg-accent-dim transition-colors text-sm disabled:opacity-40"
              >
                Add
              </button>
            </div>
          </div>
        )}

        {mode === 'uploading' && (
          <div className="py-8 text-center text-sm text-text-secondary">Uploading…</div>
        )}
      </div>
    </div>
  );
}
