import type {Resource} from '../api/resources';

// Metadata owns membership and display fields. A slower file scan cannot
// resurrect a removed row or overwrite a newer title, parent or revision.
export function withResourceAvailability(metadata:Resource[],verified?:Resource[]):Resource[]{
  const byId=new Map((verified||[]).map(row=>[row.id,row]));
  return metadata.map(row=>{
    const proof=byId.get(row.id);
    const matches=proof&&proof.kind===row.kind&&proof.updated_at===row.updated_at&&
      proof.local_media_filename===row.local_media_filename&&proof.local_media_downloaded_at===row.local_media_downloaded_at;
    return {...row,local_file_available:matches?!!proof.local_file_available:false,
      local_file_pending:matches?!!proof.local_file_pending:false,
      local_copy:matches?proof.local_copy:undefined};
  });
}
