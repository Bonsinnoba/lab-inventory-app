import {invoke} from '@tauri-apps/api/tauri';
export async function applyInventoryPage(body:any,cursor:string|null,accountId:string):Promise<{done:boolean;cursor:string|null}>{
  if(!Array.isArray(body?.items)||!Array.isArray(body?.deleted_item_ids)||typeof body?.has_more!=='boolean')throw new Error('Incomplete inventory sync response');
  if(!body.items.length&&!body.deleted_item_ids.length){
    if(body.has_more)throw new Error('Inventory cursor made no progress');
    if(!cursor){
      if(body.snapshot_complete!==true)throw new Error('Server did not confirm the initial empty inventory snapshot');
      await invoke('cache_local_inventory_snapshot',{snapshotJson:'[]',expectedAccountId:accountId});
    }
    return{done:true,cursor};
  }
  if(typeof body.next_cursor!=='string'||!body.next_cursor||body.next_cursor===cursor)throw new Error('Inventory cursor made no progress');
  await invoke('apply_server_inventory_pull',{itemsJson:JSON.stringify(body.items),deletedItemIds:body.deleted_item_ids,nextCursor:body.next_cursor,expectedAccountId:accountId});
  return{done:!body.has_more,cursor:body.next_cursor};
}
