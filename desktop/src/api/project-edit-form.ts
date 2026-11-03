// Project dates are calendar dates. Preserve their written day rather than
// converting through the device timezone (which can move midnight backwards).
export function projectInputDate(value: unknown): string {
  if (typeof value !== 'string') return '';
  const match = /^(\d{4}-\d{2}-\d{2})(?:T|$)/.exec(value);
  return match?.[1] || '';
}

export function projectEditForm(project: any) {
  return {name:project.name||'',description:project.description||'',
    status:project.status||'active',budget:project.budget??'',
    priority:project.priority||'normal',start_date:projectInputDate(project.start_date),
    due_date:projectInputDate(project.due_date),expected_lifecycle_revision:project.lifecycle_revision};
}
