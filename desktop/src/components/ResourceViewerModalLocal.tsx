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

function installPanelResizer() {
  const marker = Array.from(document.querySelectorAll<HTMLElement>('h1,h2,h3,h4,div,span')).find((el) => el.textContent?.trim() === 'Select resource');
  if (!marker) return () => {};

  let right: HTMLElement | null = marker;
  let split: HTMLElement | null = null;
  let left: HTMLElement | null = null;
  let rightPanel: HTMLElement | null = null;

  for (let i = 0; i < 8 && right; i += 1) {
    const parent = right.parentElement;
    if (!parent) break;
    const siblings = Array.from(parent.children).filter((child): child is HTMLElement => child instanceof HTMLElement && child !== right);
    const candidates = siblings.filter((child) => {
      const r = child.getBoundingClientRect();
      return r.width > 180 && r.height > 200;
    });
    const rr = right.getBoundingClientRect();
    const candidate = candidates.find((child) => {
      const r = child.getBoundingClientRect();
      return r.right <= rr.left + 24 && Math.abs(r.top - rr.top) < 80;
    });
    if (candidate && rr.width > 180 && rr.height > 200) {
      split = parent;
      left = candidate;
      rightPanel = right;
      break;
    }
    right = parent;
  }

  if (!split || !left || !rightPanel || split.dataset.labosResizable === 'true') return () => {};
  split.dataset.labosResizable = 'true';
  const computed = getComputedStyle(split);
  const isGrid = computed.display === 'grid';
  const originalTemplate = split.style.gridTemplateColumns;
  const originalLeftWidth = left.style.width;
  const originalRightWidth = rightPanel.style.width;
  const originalLeftFlex = left.style.flex;
  const originalRightFlex = rightPanel.style.flex;
  const originalRightMinWidth = rightPanel.style.minWidth;

  split.style.position = split.style.position === 'static' ? 'relative' : split.style.position;
  const divider = document.createElement('div');
  divider.setAttribute('aria-label', 'Resize viewer panels');
  divider.setAttribute('role', 'separator');
  divider.tabIndex = 0;
  divider.dataset.labosPanelResizer = 'true';
  Object.assign(divider.style, {
    position: 'absolute',
    top: '0',
    bottom: '0',
    width: '12px',
    transform: 'translateX(-50%)',
    zIndex: '30',
    cursor: 'col-resize',
    touchAction: 'none',
    background: 'transparent',
  });

  const setDividerPosition = () => {
    const l = left!.getBoundingClientRect();
    const s = split!.getBoundingClientRect();
    divider.style.left = `${l.right - s.left}px`;
  };

  const apply = (clientX: number) => {
    const s = split!.getBoundingClientRect();
    const minLeft = 280;
    const minRight = 280;
    const maxLeft = s.width - minRight;
    const nextLeft = Math.max(minLeft, Math.min(maxLeft, clientX - s.left));
    if (isGrid) {
      split!.style.gridTemplateColumns = `${nextLeft}px minmax(0, 1fr)`;
    } else {
      left!.style.flex = '0 0 auto';
      left!.style.width = `${nextLeft}px`;
      rightPanel!.style.flex = '1 1 auto';
      rightPanel!.style.minWidth = '0';
    }
    setDividerPosition();
  };

  const onPointerMove = (event: PointerEvent) => apply(event.clientX);
  const stop = () => {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', stop);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
  };
  const start = (event: PointerEvent) => {
    event.preventDefault();
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stop);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
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
    split!.style.gridTemplateColumns = originalTemplate;
    left!.style.width = originalLeftWidth;
    left!.style.flex = originalLeftFlex;
    rightPanel!.style.width = originalRightWidth;
    rightPanel!.style.flex = originalRightFlex;
    rightPanel!.style.minWidth = originalRightMinWidth;
    delete split!.dataset.labosResizable;
  };
}

export default function ResourceViewerModalLocal({ resource, resources = [], onClose, onEdit }: Props) {
  const prepare = (item: Resource) => isDownloadedVideo(item) ? prepareLocalVideo(item) : item;
  const preparedResource = prepare(resource);
  const preparedResources = resources.map(prepare);

  useEffect(() => {
    let cleanup = () => {};
    const timers = [50, 200, 500].map((delay) => window.setTimeout(() => {
      const installedCleanup = installPanelResizer();
      if (installedCleanup !== (() => {})) cleanup = installedCleanup;
    }, delay));
    return () => {
      timers.forEach(window.clearTimeout);
      cleanup();
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
