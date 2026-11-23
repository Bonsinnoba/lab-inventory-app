// Local availability is advisory: only the server can confirm competing allocations.
export function projectReservationReview(projects: any[], items: any[]) {
  const inventory = new Map(items.map(item => [item.id, item]));
  const reservations = projects.flatMap(project => Array.isArray(project.reservations)
    ? project.reservations.map((row: any) => ({...row, project_name:project.name,
      project_status:project.status, project_priority:project.priority,
      project_start_date:project.start_date, project_due_date:project.due_date})) : []);
  const missingProjects = projects.filter(project => !Array.isArray(project.reservations)).length;
  const rows = reservations.filter(row => row.status === 'pending_review').map(row => {
    const item = inventory.get(row.item_id);
    let overlap: number | null = item && missingProjects===0 ? 0 : null;
    for (const other of reservations) {
      if (other.item_id !== row.item_id || other.status !== 'confirmed') continue;
      const reusable = ['equipment','instrument','tool'].includes(item?.type);
      if (reusable) {
        const dates = [row.needed_from, other.needed_from];
        const ends = [row.needed_until, other.needed_until];
        if (dates.some(date => !Number.isFinite(Date.parse(date))) || ends.some(date => date != null && !Number.isFinite(Date.parse(date)))) { overlap = null; break; }
        if (other.needed_until && Date.parse(other.needed_until) <= Date.parse(row.needed_from)) continue;
        if (row.needed_until && Date.parse(other.needed_from) >= Date.parse(row.needed_until)) continue;
      }
      const quantity = other.quantity == null || other.quantity === '' ? NaN : Number(other.quantity);
      if (!Number.isFinite(quantity) || quantity < 0) { overlap = null; break; }
      if (overlap !== null) overlap += quantity;
    }
    const quantity = item?.current_quantity == null || item.current_quantity === '' ? NaN : Number(item.current_quantity);
    return {...row, item_name:item?.name || row.item_name || 'Inventory item unavailable',
      item_type:item?.type || '', current_quantity:Number.isFinite(quantity) ? quantity : null,
      overlapping_confirmed:overlap};
  }).sort((a,b) => String(a.created_at).localeCompare(String(b.created_at)));
  return {items:rows, source:'local' as const, missingProjects};
}
