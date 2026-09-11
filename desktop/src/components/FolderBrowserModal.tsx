import { useState, useEffect } from 'react';
import { X, FileText, Image as ImageIcon, Video, Music, File as FileIcon, Folder } from 'lucide-react';
import { getResourceManifest, getResource, ResourceManifest, Resource } from '../api/resources';
import ResourceViewerModal from './ResourceViewerModal';

interface FolderBrowserModalProps {
  folderResourceId: string;
  onClose: () => void;
}

function iconForMime(mime: string) {
  if (mime?.startsWith('image/')) return ImageIcon;
  if (mime?.startsWith('video/')) return Video;
  if (mime?.startsWith('audio/')) return Music;
  if (mime === 'application/pdf') return FileText;
  return FileIcon;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function FolderBrowserModal({ folderResourceId, onClose }: FolderBrowserModalProps) {
  const [manifest, setManifest] = useState<ResourceManifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openingFile, setOpeningFile] = useState<Resource | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  useEffect(() => {
    getResourceManifest(folderResourceId)
      .then(setManifest)
      .catch(() => setError('Could not load this folder.'));
  }, [folderResourceId]);

  const openFile = async (fileId: string) => {
    setOpenError(null);
    try {
      const resource = await getResource(fileId);
      // Types with no in-app viewer (documents, generic "other") fall back
      // to a plain message rather than pretending to open them — there's
      // no built-in viewer for e.g. .docx here, and silently doing nothing
      // would be its own kind of dead affordance.
      if (['image', 'video', 'audio', 'pdf', 'youtube'].includes(resource.file_type)) {
        setOpeningFile(resource);
      } else {
        setOpenError(`"${resource.name}" doesn't have an in-app preview yet for this file type.`);
      }
    } catch {
      setOpenError('Could not open that file.');
    }
  };

  // Group flat manifest entries by their subfolder (the part of
  // relative_path before the filename), so nested structure is still
  // visible rather than a flat dump of every file.
  const grouped: Record<string, ResourceManifest['files']> = {};
  if (manifest) {
    for (const file of manifest.files) {
      const parts = file.relative_path.split('/');
      const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
      if (!grouped[dir]) grouped[dir] = [];
      grouped[dir].push(file);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-surface border border-border rounded-md w-[560px] max-h-[75vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border flex-shrink-0">
          <h3 className="text-section-header font-ui font-semibold flex items-center gap-2">
            <Folder size={18} className="text-text-secondary" />
            {manifest?.folder || 'Folder'}
          </h3>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {error && <div className="text-status-danger text-sm">{error}</div>}
          {openError && (
            <div className="mb-3 text-sm text-status-warn bg-status-warn/10 border border-status-warn/30 rounded-sm px-3 py-2">
              {openError}
            </div>
          )}

          {!manifest && !error && (
            <div className="text-text-secondary text-sm py-8 text-center">Loading…</div>
          )}

          {manifest && manifest.files.length === 0 && (
            <div className="text-text-secondary text-sm py-8 text-center">This folder is empty.</div>
          )}

          {Object.entries(grouped).map(([dir, files]) => (
            <div key={dir} className="mb-4 last:mb-0">
              {dir && (
                <div className="text-xs text-text-secondary font-mono mb-1.5 flex items-center gap-1.5">
                  <Folder size={12} />
                  {dir}
                </div>
              )}
              <div className="space-y-1">
                {files.map((file) => {
                  const Icon = iconForMime(file.mime_type);
                  return (
                    <button
                      key={file.id}
                      onClick={() => openFile(file.id)}
                      className="w-full flex items-center gap-3 px-3 py-2 bg-surface-raised border border-border rounded-sm hover:border-accent transition-colors text-left"
                    >
                      <Icon size={16} className="text-text-secondary flex-shrink-0" />
                      <span className="flex-1 min-w-0 text-sm text-text-primary truncate">
                        {file.original_filename}
                      </span>
                      <span className="text-xs text-text-secondary font-mono flex-shrink-0">
                        {formatSize(file.size_bytes)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {openingFile && (
        <ResourceViewerModal resource={openingFile} onClose={() => setOpeningFile(null)} />
      )}
    </div>
  );
}
