// Project-scoped, citation-ready lexical evidence retrieval. No embeddings or AI-inferred facts.
export function normalizeEvidenceQuery(value){
 if(typeof value!=='string')throw new TypeError('Search query must be text');
 const query=value.trim().replace(/\s+/g,' ');
 if(query.length<2||query.length>160)throw new RangeError('Search query must be 2–160 characters');
 return query;
}
export function evidenceLimit(value){
 const n=Number(value??10);
 if(!Number.isInteger(n)||n<1)return 10;
 return Math.min(n,25);
}
export function evidenceResult(type,row){
 const title=type==='note'?row.title:row.name;
 return {ref:{type,id:row.id},title,updated_at:row.updated_at,source:{table:type==='note'?'notes':'resources',record_id:row.id,field:type==='note'?'title/body':'name/description'},excerpt:row.excerpt||'',match:'lexical'};
}
