#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let show = tauri::CustomMenuItem::new("show".to_string(), "Show");
    let hide = tauri::CustomMenuItem::new("hide".to_string(), "Hide");
    let quit = tauri::CustomMenuItem::new("quit".to_string(), "Quit");
    let tray_menu = tauri::SystemTrayMenu::new()
        .add_item(show)
        .add_item(hide)
        .add_item(quit);

    tauri::Builder::default()
        .system_tray(tauri::SystemTray::new().with_menu(tray_menu))
        .on_system_tray_event(|app, event| match event {
            tauri::SystemTrayEvent::LeftClick {
                position: _,
                size: _,
                ..
            } => {
                if let Some(window) = app.get_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            tauri::SystemTrayEvent::MenuItemClick { id, .. } => {
                match id.as_str() {
                    "quit" => std::process::exit(0),
                    "hide" => {
                        if let Some(window) = app.get_window("main") {
                            let _ = window.hide();
                        }
                    }
                    "show" => {
                        if let Some(window) = app.get_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    _ => {}
                }
            }
            _ => {}
        })
        .on_menu_event(|event| match event.menu_item_id() {
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
