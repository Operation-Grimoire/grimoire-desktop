mod sidecar;

use serde_json::Value;
use sidecar::{DaemonSnapshot, SidecarManager};
use std::sync::Arc;
use tauri::{Manager, State};

#[tauri::command]
fn get_initial_state(sidecar: State<'_, Arc<SidecarManager>>) -> DaemonSnapshot {
    sidecar.snapshot()
}

#[tauri::command]
async fn rpc_call(
    method: String,
    params: Option<Value>,
    sidecar: State<'_, Arc<SidecarManager>>,
) -> Result<(), String> {
    sidecar.call(&method, params.unwrap_or(Value::Object(Default::default()))).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let manager = SidecarManager::spawn(app.handle().clone())
                .map_err(|err| Box::<dyn std::error::Error>::from(err))?;
            app.manage(manager);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                if let Some(sidecar) = window.app_handle().try_state::<Arc<SidecarManager>>() {
                    sidecar.shutdown();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![get_initial_state, rpc_call])
        .run(tauri::generate_context!())
        .expect("error while running Grimoire Desktop");
}
