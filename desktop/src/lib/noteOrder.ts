// Presentation only: do not reorder persisted state or rewrite authored events.
export function newestNotesFirst<T extends {id:string;created_at:string;updated_at:string}>(notes:T[]):T[]{
 const timestamp=(value:string)=>{const n=Date.parse(value);return Number.isFinite(n)?n:0;};
 return [...notes].sort((a,b)=>timestamp(b.created_at)-timestamp(a.created_at)||timestamp(b.updated_at)-timestamp(a.updated_at)||a.id.localeCompare(b.id));
}
