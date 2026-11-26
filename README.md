# Grimoire Desktop

Native desktop novel reader built with **Tauri v2 (Rust)** + **React / TypeScript / Tailwind CSS v4**, powered by Grimoire's shared headless **JVM extension runtime** (`sidecar/`).

## Architecture

- **`src/`** — React 19 + TypeScript + Tailwind v4 UI rendered in the OS WebView (WebView2 on Windows, WKWebView on macOS, WebKitGTK on Linux).
- **`src-tauri/`** — Rust Tauri v2 shell managing the frameless native window and supervising the headless JVM sidecar over NDJSON stdio IPC.
- **`sidecar/`** — Headless Kotlin/JVM engine consuming `io.grimoire:reading-core` and `io.grimoire:extensions-core` to run shared Grimoire JVM `.jar` extensions, SQLite library/checkpoint storage, and an offline-capable cover cache proxy.

## Development

Prerequisites: Rust (`cargo`), Node.js 20+, and JDK 17+ (`java`).

```bash
# 1. Build the headless JVM sidecar
npm run sidecar

# 2. Install frontend dependencies
npm install

# 3. Run the desktop app in dev mode
npm run tauri dev
```
