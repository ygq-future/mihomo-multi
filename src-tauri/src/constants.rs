pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
pub const APP_USER_AGENT: &str = concat!("mihomo-multi/", env!("CARGO_PKG_VERSION"), " (clash.meta)");
pub const GITHUB_OWNER: &str = "ygq-future";
pub const GITHUB_REPO: &str = "mihomo-multi";

/// 主窗口默认及最小宽高 (与 tauri.conf.json 保持统一)
pub const DEFAULT_WINDOW_WIDTH: f64 = 1080.0;
pub const DEFAULT_WINDOW_HEIGHT: f64 = 680.0;
