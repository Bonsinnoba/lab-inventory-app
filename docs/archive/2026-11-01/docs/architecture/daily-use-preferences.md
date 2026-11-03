# Daily-use preference ownership contract (approved hybrid)

Decision: `notifications_enabled` is a per-account preference. `auto_pause_music`
and `music_volume` are per-device preferences. This is the owner's choice for
the three fields currently exposed by Daily Use; it does not imply that other
assistant, notification-read, or media settings share this contract.

## Current state and migration boundary

- Implemented in Phase 2: Tauri notification changes commit account-scoped
  SQLite state and an immutable outbox event atomically. Music values remain
  installation/account-local. Browser notification PATCH uses the same server
  apply/version rules; browser music values use account-scoped localStorage.
- Populated SQLite music values and PostgreSQL legacy media columns are
  retained. Browser migration is an explicit import and refuses to overwrite
  existing device values. Pending notifications are labelled pending, not synced.
- A PostgreSQL BEFORE INSERT notification gate suppresses new delivery when
  disabled or the account is inactive. Historical notifications remain intact.
  Automation counts only notifications actually inserted.
- Real PostgreSQL probing exposed and fixed a UUID/text parameter inference
  error in browser PATCH (2026-10-08). Automated disk-client, browser API and
  database evidence is tracked in `../audits/PHASE2_EVIDENCE.md`. Running two
  GUI clients and checking controls visually is still Phase 3 acceptance work.

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
