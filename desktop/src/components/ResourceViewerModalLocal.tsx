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

function findViewerSplit(marker: HTMLElement) {
  let ancestor: HTMLElement | null = marker.parentElement;
  for (let depth = 0; ancestor && depth < 12; depth += 1) {
    const ancestorRect = ancestor.getBoundingClientRect();
    const children = Array.from(ancestor.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement && child !== marker && getComputedStyle(child).display !== 'none',
    );

    const large = children.filter((child) => {
      const rect = child.getBoundingClientRect();
      return rect.width >= 220 && rect.height >= 180;
    });

    const pairs: Array<{ left: HTMLElement; right: HTMLElement; score: number }> = [];
    for (const right of large) {
      const rightRect = right.getBoundingClientRect();
      if (!(right.contains(marker) || right === marker || marker.contains(right))) continue;
      for (const left of large) {
        if (left === right) continue;
        const leftRect = left.getBoundingClientRect();
        const verticalOverlap = Math.min(leftRect.bottom, rightRect.bottom) - Math.max(leftRect.top, rightRect.top);
        const horizontalGap = rightRect.left - leftRect.right;
        if (leftRect.right > rightRect.left || verticalOverlap < Math.min(leftRect.height, rightRect.height) * 0.55) continue;
        if (horizontalGap < -4 || horizontalGap > 48) continue;
        const coverage = (leftRect.width + rightRect.width + Math.max(0, horizontalGap)) / Math.max(1, ancestorRect.width);
        const score = Math.abs(1 - coverage) + Math.abs(leftRect.top - rightRect.top) / Math.max(1, ancestorRect.height);
        pairs.push({ left, right, score });
      }
    }

    if (pairs.length) {
      pairs.sort((a, b) => a.score - b.score);
      const best = pairs[0];
      return { split: ancestor, left: best.left, right: best.right };
    }

    ancestor = ancestor.parentElement;
  }
  return null;
}

function installPanelResizer(): (() => void) | null {
  const marker = Array.from(document.querySelectorAll<HTMLElement>('h1,h2,h3,h4,div,span')).find(
    (el) => el.textContent?.trim() === 'Select resource' && el.getBoundingClientRect().width > 0,
  );
  if (!marker) return null;

  const found = findViewerSplit(marker);
  if (!found) return null;

  const { split, left, right } = found;
  if (split.dataset.labosResizable === 'true') return null;

  split.dataset.labosResizable = 'true';
  const computed = getComputedStyle(split);
  const isGrid = computed.display === 'grid';
  const originalTemplate = split.style.gridTemplateColumns;
  const originalLeftWidth = left.style.width;
  const originalLeftFlex = left.style.flex;
  const originalRightWidth = right.style.width;
  const originalRightFlex = right.style.flex;
  const originalRightMinWidth = right.style.minWidth;

  if (getComputedStyle(split).position === 'static') split.style.position = 'relative';

  const divider = document.createElement('div');
  divider.setAttribute('aria-label', 'Resize viewer panels');
  divider.setAttribute('role', 'separator');
  divider.tabIndex = 0;
  divider.dataset.labosPanelResizer = 'true';
  Object.assign(divider.style, {
    position: 'absolute',
    top: '0',
    bottom: '0',
    width: '18px',
    marginLeft: '-9px',
    zIndex: '9999',
    cursor: 'col-resize',
    touchAction: 'none',
    pointerEvents: 'auto',
    background: 'transparent',
  });

  const setDividerPosition = () => {
    const leftRect = left.getBoundingClientRect();
    const splitRect = split.getBoundingClientRect();
    divider.style.left = `${leftRect.right - splitRect.left}px`;
  };

  const apply = (clientX: number) => {
    const splitRect = split.getBoundingClientRect();
    const minLeft = 280;
    const minRight = 280;
    const maxLeft = Math.max(minLeft, splitRect.width - minRight);
    const nextLeft = Math.max(minLeft, Math.min(maxLeft, clientX - splitRect.left));

    if (isGrid) {
      split.style.gridTemplateColumns = `${nextLeft}px minmax(${minRight}px, 1fr)`;
    } else {
      left.style.flex = `0 0 ${nextLeft}px`;
      left.style.width = `${nextLeft}px`;
      right.style.flex = '1 1 auto';
      right.style.minWidth = `${minRight}px`;
    }
    setDividerPosition();
  };

  let dragging = false;
  let activePointerId: number | null = null;

  const onPointerMove = (event: PointerEvent) => {
    if (!dragging || (activePointerId !== null && event.pointerId !== activePointerId)) return;
    apply(event.clientX);
  };

  const stop = (event?: PointerEvent) => {
    if (event && activePointerId !== null && event.pointerId !== activePointerId) return;
    dragging = false;
    activePointerId = null;
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
  };

  const start = (event: PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    dragging = true;
    activePointerId = event.pointerId;
    try { divider.setPointerCapture(event.pointerId); } catch { /* pointer capture is optional */ }
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    apply(event.clientX);
  };

  divider.addEventListener('pointerdown', start);
  divider.addEventListener('pointermove', onPointerMove);
  divider.addEventListener('pointerup', stop);
  divider.addEventListener('pointercancel', stop);
  divider.addEventListener('lostpointercapture', () => stop());
  split.appendChild(divider);
  requestAnimationFrame(setDividerPosition);
  window.addEventListener('resize', setDividerPosition);

  return () => {
    stop();
    window.removeEventListener('resize', setDividerPosition);
    divider.removeEventListener('pointerdown', start);
    divider.removeEventListener('pointermove', onPointerMove);
    divider.removeEventListener('pointerup', stop);
    divider.removeEventListener('pointercancel', stop);
    divider.remove();
    split.style.gridTemplateColumns = originalTemplate;
    left.style.width = originalLeftWidth;
    left.style.flex = originalLeftFlex;
    right.style.width = originalRightWidth;
    right.style.flex = originalRightFlex;
    right.style.minWidth = originalRightMinWidth;
    delete split.dataset.labosResizable;
  };
}

export default function ResourceViewerModalLocal({ resource, resources = [], onClose, onEdit }: Props) {
  const prepare = (item: Resource) => isDownloadedVideo(item) ? prepareLocalVideo(item) : item;
  const preparedResource = prepare(resource);
  const preparedResources = resources.map(prepare);

  useEffect(() => {
    let cleanup: (() => void) | null = null;
    const install = () => {
      cleanup?.();
      cleanup = installPanelResizer();
    };
    const timers = [0, 50, 150, 300, 600].map((delay) => window.setTimeout(install, delay));
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
