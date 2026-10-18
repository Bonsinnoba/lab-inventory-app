import type { ReportsOverview } from './reports';

export function buildReportsCsv(data:ReportsOverview):string {
  const source=data.availability?'Local authorized snapshot; may include unsynced changes; server freshness and completeness unverified':'Server report';
  const rows:unknown[][]=[['Section','Category','Status','Unit','Count','Quantity','Availability','Source','Generated at']];
  for(const key of ['projects','inventory','tasks','experiments','resources','activity'] as const) {
    const availability=data.availability?.sections[key]??'available';
    // Empty and unavailable sections still have an explicit export row. A blank
    // count is unknown; it must not be converted to zero by export consumers.
    const section=data[key];
    if(!section.length||availability==='unavailable') {
      rows.push([key,'','','',availability==='available'?0:'','',availability,source,data.generated_at]);
    } else {
      for(const row of section) {
        rows.push([key,'type' in row?row.type:'kind' in row?row.kind:'action' in row?row.action:'',
          row.status??'','unit' in row?row.unit:'',row.count,'quantity' in row?row.quantity:'',availability,source,data.generated_at]);
      }
    }
  }
  return rows.map(row=>row.map(value=>{
    let text=String(value??'');
    // Quoting alone does not prevent spreadsheet formula interpretation.
    if(/^[\s]*[=+@-]/.test(text))text=`'${text}`;
    return `"${text.replace(/"/g,'""')}"`;
  }).join(',')).join('\r\n');
}
