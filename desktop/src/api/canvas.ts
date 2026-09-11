import { apiFetch } from './http';

export interface CanvasBlock {
  id: string;
  project_id: string;
  block_type: 'text' | 'image' | 'video' | 'audio' | 'pdf' | 'link' | 'folder';
  title?: string | null;
  text_content?: string;
  resource_id?: string;
  // Free-form position/size, in pixels — independent per block, no grid,
  // no shared row, no overlap restriction.
  x: number;
  y: number;
  width: number;
  height: number;
  created_at: string;
  updated_at: string;
}

export interface CanvasConnector {
  id: string;
  project_id: string;
  source_block_id: string;
  target_block_id: string;
  label?: string;
  created_at: string;
}

export interface CanvasData {
  blocks: CanvasBlock[];
  connectors: CanvasConnector[];
  permissions?: { access: 'admin' | 'edit' | 'view'; member_role: string; can_edit: boolean };
}

// Every function below reads the backend's actual error message out of the
// response body when a request fails, rather than throwing a generic
// string — this is what makes real failures (a stale schema, a bad
// payload, whatever it turns out to be) visible and diagnosable instead
// of just "something didn't work."
async function extractError(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => ({}));
  const error = body?.error;
  if (typeof error === 'string') return error;
  if (error && typeof error.message === 'string') return error.message;
  if (typeof body?.message === 'string') return body.message;
  return fallback;
}

export async function getCanvas(projectId: string): Promise<CanvasData> {
  const response = await apiFetch(`/projects/${projectId}/canvas`);
  if (!response.ok) throw new Error(await extractError(response, 'Failed to fetch canvas'));
  return response.json();
}

export async function createBlock(
  projectId: string,
  block: Partial<Pick<CanvasBlock, 'block_type' | 'title' | 'text_content' | 'resource_id' | 'x' | 'y' | 'width' | 'height'>>
): Promise<CanvasBlock> {
  const response = await apiFetch(`/projects/${projectId}/blocks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(block),
  });
  if (!response.ok) throw new Error(await extractError(response, 'Failed to create block'));
  return response.json();
}

export async function updateBlock(
  blockId: string,
  block: Partial<Pick<CanvasBlock, 'x' | 'y' | 'width' | 'height' | 'title' | 'text_content'>>
): Promise<CanvasBlock> {
  const response = await apiFetch(`/blocks/${blockId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(block),
  });
  if (!response.ok) throw new Error(await extractError(response, 'Failed to update block'));
  return response.json();
}

export async function deleteBlock(blockId: string): Promise<void> {
  const response = await apiFetch(`/blocks/${blockId}`, { method: 'DELETE' });
  if (!response.ok) throw new Error(await extractError(response, 'Failed to delete block'));
}

export async function createConnector(
  projectId: string,
  connector: Omit<CanvasConnector, 'id' | 'project_id' | 'created_at'>
): Promise<CanvasConnector> {
  const response = await apiFetch(`/projects/${projectId}/connectors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(connector),
  });
  if (!response.ok) throw new Error(await extractError(response, 'Failed to create connector'));
  return response.json();
}

export async function deleteConnector(connectorId: string): Promise<void> {
  const response = await apiFetch(`/connectors/${connectorId}`, { method: 'DELETE' });
  if (!response.ok) throw new Error(await extractError(response, 'Failed to delete connector'));
}
