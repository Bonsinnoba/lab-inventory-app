// Only recognized provider URLs become embeds. Never forward LabOS credentials,
// arbitrary query parameters, or a server download URL to a third-party player.
export function originalResourceSource(raw?: string): { url: string; embed: string | null } | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = new URL(raw.trim());
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
    let id = '';
    if (!parsed.port) {
      if (host === 'youtu.be') id = parsed.pathname.split('/').filter(Boolean)[0] || '';
      else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
        if (parsed.pathname === '/watch') id = parsed.searchParams.get('v') || '';
        else if (/^\/(shorts|embed|live)\//.test(parsed.pathname)) id = parsed.pathname.split('/')[2] || '';
      }
    }
    return {
      url: parsed.href,
      embed: /^[a-zA-Z0-9_-]{11}$/.test(id) ? `https://www.youtube.com/embed/${id}?rel=0` : null,
    };
  } catch { return null; }
}

export function resourceCopyMessage(resource: { local_media_filename?: string; local_copy?: { state: string; error?: string | null } }): string {
  if (!resource.local_media_filename) return 'Original link. A downloaded copy is not recorded yet.';
  const state = resource.local_copy?.state;
  if (state === 'error' || resource.local_copy?.error) return 'Downloaded on server. The PC copy needs attention.';
  if (state === 'copying') return 'Downloaded on server. Copying to this PC.';
  return 'Downloaded on server. A verified copy is not available on this PC yet.';
}
