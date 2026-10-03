# Daily-use preference ownership contract (approved hybrid)

Decision: `notifications_enabled` is a per-account preference. `auto_pause_music`
and `music_volume` are per-device preferences. This is the owner's choice for
the three fields currently exposed by Daily Use; it does not imply that other
assistant, notification-read, or media settings share this contract.

## Current state and migration boundary

- Tauri currently writes all three fields to account-scoped SQLite `sync_state`
  without an outbox entry. Browser mode writes all three to
  `user_daily_use_preferences` in PostgreSQL. Neither path currently provides
  a consistent cross-device notification value.
- Phase 1 records the ownership decision. Phase 2 must implement the paths
  below as one vertical slice. Until then, the UI must not claim that a Tauri
  notification change has synchronized. Existing PostgreSQL music columns and
  SQLite values must not be deleted or silently assigned to another account.
- The `notifications_enabled` label currently promises "delivery", but a
  repository search found no consumer of that column outside its API and UI.
  Phase 2 must wire an actual delivery gate or relabel it as a preference;
  passing a persistence test alone is not enough.

## Per-account notification preference

1. PostgreSQL is authoritative for each authenticated `user_id`. The browser
   and desktop present the same value when online.
2. A Tauri change commits its account-scoped local value **and** an outbox
   event in one SQLite transaction. The event has a stable `change_id`, user
   ownership, a desired boolean value, and the last known server version.
3. Server apply is idempotent by `change_id` and compare-and-swaps the version.
   A different value at a newer version is a visible conflict; an old offline
   edit must not silently overwrite a newer setting from another device.
4. Pull returns the current value and version for the authenticated account.
   A pending local event is not overwritten by pull. On acknowledgement, the
   server value replaces local state; on conflict, the UI offers retry with
   current value or discard of the local intent.
5. Browser PATCH uses the same version/conflict rule and an idempotency key.
   Disabled or unauthenticated accounts cannot read or mutate preferences.

## Per-device media preferences

- Tauri keeps `auto_pause_music` and `music_volume` in account-scoped SQLite
  on that installation. These writes are deliberately **not** outbox events.
- Browser mode keeps them in account-scoped browser storage. A one-time,
  explicit compatibility import may seed that browser's local value from its
  existing PostgreSQL row; it must not overwrite an existing local setting.
- Both runtimes validate booleans and `music_volume` in `[0, 1]`. The setting
  applies immediately on the current device and stays different across
  devices by design. The UI should say so.
- The existing PostgreSQL music columns remain readable in backup/export
  during transition; removal requires a later migration and verification.

## Verification required before Phase 2 sign-off

- Two desktop clients and a browser on the existing PostgreSQL service:
  offline notification edit, reconnect, same-change replay, concurrent edit
  conflict, account switch, disabled account, and server restart.
- Different music volume and auto-pause on two devices for the same account;
  changing either device leaves the other unchanged and survives restart.
- Fresh account defaults and upgrade from populated SQLite/PostgreSQL rows,
  with no loss or cross-account transfer of historical values.
