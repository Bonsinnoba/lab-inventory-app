// SQL projection only: never rewrite immutable outbox payloads/receipt hashes.
export function projectDateValue(field, value) {
  if (['start_date', 'due_date'].includes(field) && typeof value === 'string' && value.trim() === '') return null;
  return value ?? null;
}
