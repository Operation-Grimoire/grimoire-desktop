use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DaemonSnapshot {
    pub ready: bool,
    pub cover_base_url: Option<String>,
    pub host_api: Option<String>,
    pub state: Option<Value>,
    pub startup_error: Option<String>,
}

pub struct SidecarManager {
    stdin: Mutex<Option<ChildStdin>>,
    child: Mutex<Option<Child>>,
    pending: Mutex<HashMap<u64, oneshot::Sender<Result<(), String>>>>,
    next_id: AtomicU64,
    snapshot: Mutex<DaemonSnapshot>,
}

impl SidecarManager {
    pub fn spawn(app: AppHandle) -> Result<Arc<Self>, String> {
        let lib_dir = resolve_sidecar_lib_dir()?;
        let classpath = format!("{}/*", lib_dir.to_string_lossy());
        let java_bin = std::env::var("GRIMOIRE_JAVA_BIN").unwrap_or_else(|_| "java".to_string());

        let mut cmd = Command::new(&java_bin);
        cmd.arg("-cp")
            .arg(&classpath)
            .arg("io.grimoire.desktop.DaemonMainKt")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());

        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);

        if let Ok(data_dir) = std::env::var("GRIMOIRE_DATA_DIR") {
            cmd.arg("--data").arg(data_dir);
        }
        if let Ok(ext_manifest) = std::env::var("GRIMOIRE_EXTENSION") {
            cmd.arg("--extension").arg(ext_manifest);
        }

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to start JVM sidecar ({java_bin}): {e}"))?;

        let stdin = child.stdin.take().ok_or("Missing sidecar stdin")?;
        let stdout = child.stdout.take().ok_or("Missing sidecar stdout")?;

        let manager = Arc::new(Self {
            stdin: Mutex::new(Some(stdin)),
            child: Mutex::new(Some(child)),
            pending: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            snapshot: Mutex::new(DaemonSnapshot::default()),
        });

        let reader_mgr = Arc::clone(&manager);
        std::thread::Builder::new()
            .name("grimoire-sidecar-stdout".into())
            .spawn(move || {
                let reader = BufReader::new(stdout);
                for line in reader.lines() {
                    let Ok(line) = line else { break };
                    if line.trim().is_empty() {
                        continue;
                    }
                    let Ok(msg) = serde_json::from_str::<Value>(&line) else {
                        continue;
                    };
                    match msg.get("type").and_then(Value::as_str) {
                        Some("ready") => {
                            let cover_base_url = msg
                                .get("coverBaseUrl")
                                .and_then(Value::as_str)
                                .map(str::to_string);
                            let host_api = msg
                                .get("hostApi")
                                .and_then(Value::as_str)
                                .map(str::to_string);
                            if let Ok(mut snap) = reader_mgr.snapshot.lock() {
                                snap.ready = true;
                                snap.cover_base_url = cover_base_url.clone();
                                snap.host_api = host_api.clone();
                            }
                            let _ = app.emit(
                                "daemon://ready",
                                json!({ "coverBaseUrl": cover_base_url, "hostApi": host_api }),
                            );
                        }
                        Some("state") => {
                            if let Some(state) = msg.get("state").cloned() {
                                if let Ok(mut snap) = reader_mgr.snapshot.lock() {
                                    snap.state = Some(state.clone());
                                }
                                let _ = app.emit("daemon://state", state);
                            }
                        }
                        Some("response") => {
                            if let Some(id) = msg.get("id").and_then(Value::as_u64) {
                                let ok = msg.get("ok").and_then(Value::as_bool).unwrap_or(false);
                                let result = if ok {
                                    Ok(())
                                } else {
                                    Err(msg
                                        .get("error")
                                        .and_then(Value::as_str)
                                        .unwrap_or("Unknown sidecar error")
                                        .to_string())
                                };
                                if let Ok(mut pending) = reader_mgr.pending.lock() {
                                    if let Some(tx) = pending.remove(&id) {
                                        let _ = tx.send(result);
                                    }
                                }
                            }
                        }
                        _ => {}
                    }
                }
                // Drain any pending calls if the sidecar exits unexpectedly.
                if let Ok(mut pending) = reader_mgr.pending.lock() {
                    for (_, tx) in pending.drain() {
                        let _ = tx.send(Err("Sidecar process exited".into()));
                    }
                }
            })
            .map_err(|e| format!("Failed to spawn sidecar reader thread: {e}"))?;

        Ok(manager)
    }

    pub fn snapshot(&self) -> DaemonSnapshot {
        self.snapshot
            .lock()
            .map(|s| s.clone())
            .unwrap_or_default()
    }

    pub async fn call(&self, method: &str, params: Value) -> Result<(), String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        {
            let mut pending = self.pending.lock().map_err(|_| "Sidecar lock poisoned")?;
            pending.insert(id, tx);
        }
        let payload = json!({ "id": id, "method": method, "params": params }).to_string();
        {
            let mut guard = self.stdin.lock().map_err(|_| "Sidecar stdin lock poisoned")?;
            let stdin = guard.as_mut().ok_or("Sidecar is shutting down")?;
            if let Err(err) = writeln!(stdin, "{payload}").and_then(|_| stdin.flush()) {
                if let Ok(mut pending) = self.pending.lock() {
                    pending.remove(&id);
                }
                return Err(format!("Failed to write to sidecar: {err}"));
            }
        }
        match tokio::time::timeout(std::time::Duration::from_secs(30), rx).await {
            Ok(Ok(res)) => res,
            Ok(Err(_)) => Err("Sidecar closed before replying".into()),
            Err(_) => {
                if let Ok(mut pending) = self.pending.lock() {
                    pending.remove(&id);
                }
                Err("Sidecar request timed out".into())
            }
        }
    }

    pub fn shutdown(&self) {
        if let Ok(mut guard) = self.stdin.lock() {
            if let Some(mut stdin) = guard.take() {
                let _ = writeln!(stdin, r#"{{"method":"shutdown"}}"#);
                let _ = stdin.flush();
            }
        }
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut child) = guard.take() {
                for _ in 0..30 {
                    if let Ok(Some(_)) = child.try_wait() {
                        return;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

fn resolve_sidecar_lib_dir() -> Result<PathBuf, String> {
    if let Ok(custom) = std::env::var("GRIMOIRE_SIDECAR_LIB") {
        let p = PathBuf::from(custom);
        if p.is_dir() {
            return Ok(p);
        }
    }
    let mut candidates = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("sidecar").join("lib"));
            candidates.push(dir.join("resources").join("sidecar").join("lib"));
            // Dev mode: target/debug/grimoire-desktop -> ../../.. -> repo root
            for ancestor in dir.ancestors().take(5) {
                candidates.push(
                    ancestor
                        .join("sidecar")
                        .join("build")
                        .join("install")
                        .join("grimoire-sidecar")
                        .join("lib"),
                );
            }
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        for ancestor in cwd.ancestors().take(4) {
            candidates.push(
                ancestor
                    .join("sidecar")
                    .join("build")
                    .join("install")
                    .join("grimoire-sidecar")
                    .join("lib"),
            );
        }
    }
    for candidate in candidates {
        if candidate.is_dir() {
            return Ok(candidate);
        }
    }
    Err("Could not locate grimoire-sidecar lib directory. Run `npm run sidecar` first.".into())
}
