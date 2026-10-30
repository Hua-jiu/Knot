mod commands;
mod state;

use knot_core::vault::Vault;
use tauri::Manager;

use crate::state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            let vault = Vault::open(dir)?;
            app.manage(AppState::new(vault));
            #[cfg(target_os = "macos")]
            app.set_menu(mac_menu(app.handle())?)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id() == "close-window" {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::hosts_list,
            commands::host_save,
            commands::host_delete,
            commands::keys_list,
            commands::key_import,
            commands::key_generate,
            commands::key_rename,
            commands::key_delete,
            commands::sshconfig_import,
            commands::hostkey_respond,
            commands::settings_get,
            commands::settings_set,
            commands::app_info,
            commands::term_open,
            commands::term_write,
            commands::term_resize,
            commands::term_close,
            commands::sftp_open,
            commands::sftp_close,
            commands::fs_home,
            commands::fs_list,
            commands::fs_stat,
            commands::fs_preview,
            commands::fs_mkdir,
            commands::fs_rename,
            commands::fs_move,
            commands::fs_delete,
            commands::fs_transfer,
            commands::transfer_cancel,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Knot");
}

/// Like Tauri's default menu, but without ⌘W ("Close Window") and other accelerators that
/// would shadow the app's own keyboard shortcuts.
#[cfg(target_os = "macos")]
fn mac_menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem as P, Submenu};

    let name = app.package_info().name.clone();
    let app_menu = Submenu::with_items(
        app,
        &name,
        true,
        &[
            &P::about(app, None, None)?,
            &P::separator(app)?,
            &P::services(app, None)?,
            &P::separator(app)?,
            &P::hide(app, None)?,
            &P::hide_others(app, None)?,
            &P::show_all(app, None)?,
            &P::separator(app)?,
            &P::quit(app, None)?,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &P::undo(app, None)?,
            &P::redo(app, None)?,
            &P::separator(app)?,
            &P::cut(app, None)?,
            &P::copy(app, None)?,
            &P::paste(app, None)?,
            &P::select_all(app, None)?,
        ],
    )?;
    let window = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &P::minimize(app, None)?,
            &P::maximize(app, None)?,
            &P::fullscreen(app, None)?,
            &P::separator(app)?,
            &MenuItem::with_id(app, "close-window", "Close Window", true, None::<&str>)?,
        ],
    )?;
    Menu::with_items(app, &[&app_menu, &edit, &window])
}
