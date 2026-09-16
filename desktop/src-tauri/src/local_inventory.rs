use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::local_db;

const INVENTORY_SCHEMA_VERSION: &str = "002_local_inventory";

#[derive(Debug, Deserialize, Serialize)]
pub struct LocalInventoryItem {
    pub item_id: String,
    pub sku: Option<String>,
    pub name: String,
    pub description: Option<String>,
    pub unit: Option<String>,
    pub current_quantity: f64,
    pub reorder_level: Option<f64>,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct InventoryAdjustmentInput {
    pub item_id: String,
    pub delta: f64,
    pub reason: String,
    pub reference: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct InventoryAdjustmentResult {
    pub change_id: String,
    pub item_id: String,
    pub previous_quantity: f64,
    pub new_quantity: f64,
    pub delta: f64,
}

fn connection(app: &AppHandle) -> Result<Connection, String> {
    local_db::open_local_connection(app)
}

fn ensure_inventory_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS local_inventory_items (
            item_id TEXT PRIMARY KEY,
            sku TEXT,
            name TEXT NOT NULL,
            description TEXT,
            unit TEXT,
            current_quantity REAL NOT NULL DEFAULT 0,
            reorder_level REAL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_local_inventory_items_sku
            ON local_inventory_items(sku)
            WHERE sku IS NOT NULL;

        CREATE TABLE IF NOT EXISTS local_inventory_movements (
            movement_id TEXT PRIMARY KEY,
            item_id TEXT NOT NULL REFERENCES local_inventory_items(item_id),
            delta REAL NOT NULL,
            quantity_after REAL NOT NULL,
            reason TEXT NOT NULL,
            reference TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_local_inventory_movements_item
            ON local_inventory_movements(item_id, created_at);
        "#,
    )
    .map_err(|err| format!("Unable to initialize local inventory schema: {err}"))?;

    conn.execute(
        "INSERT OR IGNORE INTO local_schema_migrations(version) VALUES (?1)",
        [INVENTORY_SCHEMA_VERSION],
    )
    .map_err(|err| format!("Unable to record local inventory schema version: {err}"))?;

    Ok(())
}

pub fn initialize(app: &AppHandle) -> Result<(), String> {
    let conn = connection(app)?;
    ensure_inventory_schema(&conn)
}

#[tauri::command]
pub fn list_local_inventory(app: AppHandle) -> Result<Vec<LocalInventoryItem>, String> {
    let conn = connection(&app)?;
    ensure_inventory_schema(&conn)?;

    let mut stmt = conn
        .prepare(
            r#"
            SELECT item_id, sku, name, description, unit,
                   current_quantity, reorder_level, updated_at
            FROM local_inventory_items
            ORDER BY name COLLATE NOCASE ASC
            "#,
        )
        .map_err(|err| format!("Unable to prepare local inventory query: {err}"))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(LocalInventoryItem {
                item_id: row.get(0)?,
                sku: row.get(1)?,
                name: row.get(2)?,
                description: row.get(3)?,
                unit: row.get(4)?,
                current_quantity: row.get(5)?,
                reorder_level: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })
        .map_err(|err| format!("Unable to read local inventory: {err}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("Unable to decode local inventory: {err}"))
}

#[tauri::command]
pub fn upsert_local_inventory_item(
    app: AppHandle,
    item: LocalInventoryItem,
) -> Result<(), String> {
    let conn = connection(&app)?;
    ensure_inventory_schema(&conn)?;

    conn.execute(
        r#"
        INSERT INTO local_inventory_items
            (item_id, sku, name, description, unit, current_quantity, reorder_level, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, CURRENT_TIMESTAMP)
        ON CONFLICT(item_id) DO UPDATE SET
            sku = excluded.sku,
            name = excluded.name,
            description = excluded.description,
            unit = excluded.unit,
            reorder_level = excluded.reorder_level,
            updated_at = CURRENT_TIMESTAMP
        "#,
        params![
            item.item_id,
            item.sku,
            item.name,
            item.description,
            item.unit,
            item.current_quantity,
            item.reorder_level
        ],
    )
    .map_err(|err| format!("Unable to save local inventory item: {err}"))?;

    Ok(())
}

#[tauri::command]
pub fn adjust_local_inventory(
    app: AppHandle,
    input: InventoryAdjustmentInput,
) -> Result<InventoryAdjustmentResult, String> {
    if input.delta == 0.0 {
        return Err("Inventory adjustment cannot be zero".to_string());
    }
    if input.reason.trim().is_empty() {
        return Err("Inventory adjustment reason is required".to_string());
    }

    let item_id = input.item_id.clone();
    let mut conn = connection(&app)?;
    ensure_inventory_schema(&conn)?;

    let tx = conn
        .transaction()
        .map_err(|err| format!("Unable to begin local inventory transaction: {err}"))?;

    let previous_quantity: f64 = tx
        .query_row(
            "SELECT current_quantity FROM local_inventory_items WHERE item_id = ?1",
            [&item_id],
            |row| row.get(0),
        )
        .map_err(|err| format!("Unable to read local inventory quantity: {err}"))?;

    let new_quantity = previous_quantity + input.delta;
    if new_quantity < 0.0 {
        return Err("Inventory quantity cannot become negative".to_string());
    }

    let movement_id: String = tx
        .query_row("SELECT lower(hex(randomblob(16)))", [], |row| row.get(0))
        .map_err(|err| format!("Unable to create inventory movement id: {err}"))?;

    tx.execute(
        r#"
        UPDATE local_inventory_items
        SET current_quantity = ?1,
            updated_at = CURRENT_TIMESTAMP
        WHERE item_id = ?2
        "#,
        params![new_quantity, &item_id],
    )
    .map_err(|err| format!("Unable to update local inventory quantity: {err}"))?;

    tx.execute(
        r#"
        INSERT INTO local_inventory_movements
            (movement_id, item_id, delta, quantity_after, reason, reference)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        "#,
        params![
            movement_id,
            &item_id,
            input.delta,
            new_quantity,
            &input.reason,
            &input.reference
        ],
    )
    .map_err(|err| format!("Unable to record local inventory movement: {err}"))?;

    let device_id: String = tx
        .query_row("SELECT device_id FROM device_identity WHERE id = 1", [], |row| row.get(0))
        .map_err(|err| format!("Unable to read device identity: {err}"))?;

    let change_id: String = tx
        .query_row("SELECT lower(hex(randomblob(16)))", [], |row| row.get(0))
        .map_err(|err| format!("Unable to create sync change id: {err}"))?;

    let payload = serde_json::json!({
        "movement_id": movement_id,
        "item_id": &item_id,
        "delta": input.delta,
        "quantity_after": new_quantity,
        "reason": &input.reason,
        "reference": &input.reference,
    });

    tx.execute(
        r#"
        INSERT INTO sync_outbox
            (change_id, device_id, entity_type, entity_id, operation, payload_json)
        VALUES (?1, ?2, 'inventory_movement', ?3, 'create', ?4)
        "#,
        params![change_id, device_id, &item_id, payload.to_string()],
    )
    .map_err(|err| format!("Unable to queue inventory movement for sync: {err}"))?;

    tx.commit()
        .map_err(|err| format!("Unable to commit local inventory transaction: {err}"))?;

    Ok(InventoryAdjustmentResult {
        change_id,
        item_id,
        previous_quantity,
        new_quantity,
        delta: input.delta,
    })
}
