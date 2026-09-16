import ResourceViewerModal from './ResourceViewerModal';
import type { Resource } from '../api/resources';
import { getLocalMediaUrl } from '../api/mediaDownloads';
import { useEffect } from 'react';

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

function installPanelResizer(): (() => void) | null {
  const panels = Array.from(document.querySelectorAll<HTMLElement>('div')).filter((el) => {
    const c = el.classList;
    if (!c.contains('flex') || !c.contains('min-w-0') || !c.contains('min-h-0') || !c.contains('flex-1') || !c.contains('flex-col')) return false;
    if (!c.contains('border-slate-800')) return false;
    const r = el.getBoundingClientRect();
    return r.width > 200 && r.height > 250;
  });

  if (panels.length < 2) return null;

  // The actual viewer panes are the two similarly sized panel roots sharing a parent.
  let left: HTMLElement | null = null;
  let right: HTMLElement | null = null;
  let split: HTMLElement | null = null;

  for (const a of panels) {
    const parent = a.parentElement;
    if (!parent) continue;
    const siblings = panels.filter((p) => p.parentElement === parent);
    if (siblings.length < 2) continue;
    const ordered = siblings.slice().sort((x, y) => x.getBoundingClientRect().left - y.getBoundingClientRect().left);
    left = ordered[0];
    right = ordered[1];
    split = parent;
    break;
  }

  if (!left || !right || !split || split.dataset.labosResizable === 'true') return null;

  const originalTemplate = split.style.gridTemplateColumns;
  const originalLeftFlex = left.style.flex;
  const originalRightFlex = right.style.flex;
  const originalLeftWidth = left.style.width;
  const originalRightWidth = right.style.width;
  const originalRightMinWidth = right.style.minWidth;
  const originalPosition = split.style.position;

  split.dataset.labosResizable = 'true';
  if (getComputedStyle(split).position === 'static') split.style.position = 'relative';

  const divider = document.createElement('div');
  divider.setAttribute('role', 'separator');
  divider.setAttribute('aria-label', 'Resize viewer panels');
  divider.tabIndex = 0;
  Object.assign(divider.style, {
    position: 'absolute',
    top: '0',
    bottom: '0',
    width: '24px',
    transform: 'translateX(-50%)',
    zIndex: '9999',
    cursor: 'col-resize',
    touchAction: 'none',
    background: 'transparent',
  });

  const setDividerPosition = () => {
    if (!left || !split) return;
    const l = left.getBoundingClientRect();
    const s = split.getBoundingClientRect();
    divider.style.left = `${l.right - s.left}px`;
  };

  const apply = (clientX: number) => {
    if (!split || !left || !right) return;
    const s = split.getBoundingClientRect();
    const minLeft = 280;
    const minRight = 280;
    const maxLeft = Math.max(minLeft, s.width - minRight);
    const nextLeft = Math.max(minLeft, Math.min(maxLeft, clientX - s.left));

    left.style.flex = `0 0 ${nextLeft}px`;
    left.style.width = `${nextLeft}px`;
    right.style.flex = '1 1 0%';
    right.style.width = 'auto';
    right.style.minWidth = '0';
    setDividerPosition();
  };

  let dragging = false;
  const onPointerMove = (event: PointerEvent) => {
    if (!dragging) return;
    event.preventDefault();
    apply(event.clientX);
  };
  const stop = () => {
    dragging = false;
    window.removeEventListener('pointermove', onPointerMove, true);
    window.removeEventListener('pointerup', stop, true);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
  };
  const start = (event: PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    dragging = true;
    try { divider.setPointerCapture(event.pointerId); } catch {}
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('pointerup', stop, true);
  };

  divider.addEventListener('pointerdown', start);
  split.appendChild(divider);
  requestAnimationFrame(setDividerPosition);
  window.addEventListener('resize', setDividerPosition);

  return () => {
    stop();
    window.removeEventListener('resize', setDividerPosition);
    divider.removeEventListener('pointerdown', start);
    divider.remove();
    split.style.gridTemplateColumns = originalTemplate;
    left.style.flex = originalLeftFlex;
    right.style.flex = originalRightFlex;
    left.style.width = originalLeftWidth;
    right.style.width = originalRightWidth;
    right.style.minWidth = originalRightMinWidth;
    split.style.position = originalPosition;
    delete split.dataset.labosResizable;
  };
}

export default function ResourceViewerModalLocal({ resource, resources = [], onClose, onEdit }: Props) {
  const prepare = (item: Resource) => isDownloadedVideo(item) ? prepareLocalVideo(item) : item;
  const preparedResource = prepare(resource);
  const preparedResources = resources.map(prepare);

  useEffect(() => {
    let cleanup: (() => void) | null = null;
    const timers = [50, 150, 300, 600].map((delay) => window.setTimeout(() => {
      if (cleanup) return;
      const installedCleanup = installPanelResizer();
      if (installedCleanup) cleanup = installedCleanup;
    }, delay));
    return () => {
      timers.forEach(window.clearTimeout);
      cleanup?.();
    };
  }, [resource.id]);

  return (
    <ResourceViewerModal
      resource={preparedResource}
      resources={preparedResources}
      onClose={onClose}
      onEdit={onEdit}
    />
  );
}
