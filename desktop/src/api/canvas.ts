import {captureAccountSession,isAccountSessionCurrent} from './auth';
import {writeProjectWorkHttp,reviewedProjectWork} from './project-work-http';
import { apiFetch } from './http';
import { invoke } from '@tauri-apps/api/tauri';
const isTauri=()=>typeof window!=='undefined'&&Boolean((window as any).__TAURI_IPC__);
async function local<T>(command:string,args:Record<string,unknown>={}):Promise<T|null>{
 if(!isTauri())return null;
 const session=captureAccountSession();if(!session)throw Error('Sign in to access the local canvas');
 const result=await invoke<T>(command,args);
 if(!isAccountSessionCurrent(session))throw Error('Account changed while accessing the canvas');
 if(result==null&&!command.startsWith('delete_'))throw Error('Local canvas response is unavailable');
 return result;
}

function requireLocalCanvasWrite(): never { throw new Error('Local canvas is unavailable. Refresh the project before changing its canvas.'); }

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
  permissions?: { access: 'admin' | 'edit' | 'view'; member_role: string | null; can_edit: boolean; user_id?: string };
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
  const localCanvas=await local<CanvasData>('get_local_project_canvas',{projectId});
  if(localCanvas!==null){if(!Array.isArray(localCanvas.blocks)||!Array.isArray(localCanvas.connectors))throw Error('Local canvas snapshot is incomplete');return localCanvas;}
  const session=captureAccountSession();if(!session)throw Error('Sign in to read the canvas');
  const response = await apiFetch(`/projects/${projectId}/canvas`);
  if (!response.ok) throw new Error(await extractError(response, 'Failed to fetch canvas'));
  const data=await response.json();
  if(!isAccountSessionCurrent(session))throw Error('Account changed while reading the canvas');
  if(!data||!Array.isArray(data.blocks)||!Array.isArray(data.connectors))throw Error('Canvas snapshot is incomplete');
  return data;
}

export async function createBlock(
  projectId: string,
  block: Partial<Pick<CanvasBlock, 'block_type' | 'title' | 'text_content' | 'resource_id' | 'x' | 'y' | 'width' | 'height'>>
): Promise<CanvasBlock> {
  const localBlock=await local<CanvasBlock>('create_local_project_block',{projectId,record:block});
  if(localBlock!==null)return localBlock;
  if(isTauri())requireLocalCanvasWrite();
  return writeProjectWorkHttp(`/projects/${projectId}/blocks`,'POST',block);
}

export async function updateBlock(
  blockId: string,
  block: Partial<Pick<CanvasBlock, 'x' | 'y' | 'width' | 'height' | 'title' | 'text_content'>> & { project_id?: string },
  expected?:CanvasBlock
): Promise<CanvasBlock> {
  const localBlock=await local<CanvasBlock>('update_local_project_block',{projectId:block.project_id,recordId:blockId,patch:block,expected:expected??null});
  if(localBlock!==null)return localBlock;
  if(isTauri())requireLocalCanvasWrite();
  return writeProjectWorkHttp(`/blocks/${blockId}`,'PUT',{...block,expected:reviewedProjectWork('block',expected)});
}

export async function deleteBlock(blockId: string, projectId?: string,expected?:CanvasBlock): Promise<void> {
  if(projectId){const localResult=await local<void>('delete_local_project_block',{projectId,recordId:blockId,expected:expected??null});if(localResult!==null)return;}
  if(isTauri())requireLocalCanvasWrite();
  return writeProjectWorkHttp(`/blocks/${blockId}`,'DELETE',{project_id:projectId,expected:reviewedProjectWork('block',expected)});
}

export async function createConnector(
  projectId: string,
  connector: Omit<CanvasConnector, 'id' | 'project_id' | 'created_at'>
): Promise<CanvasConnector> {
  const localConnector=await local<CanvasConnector>('create_local_project_connector',{projectId,record:connector});
  if(localConnector!==null)return localConnector;
  if(isTauri())requireLocalCanvasWrite();
  return writeProjectWorkHttp(`/projects/${projectId}/connectors`,'POST',connector);
}

export async function deleteConnector(connectorId: string, projectId?: string,expected?:CanvasConnector): Promise<void> {
  if(projectId){const localResult=await local<void>('delete_local_project_connector',{projectId,recordId:connectorId,expected:expected??null});if(localResult!==null)return;}
  if(isTauri())requireLocalCanvasWrite();
  return writeProjectWorkHttp(`/connectors/${connectorId}`,'DELETE',{project_id:projectId,expected:reviewedProjectWork('connector',expected)});
}
