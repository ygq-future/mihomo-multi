use thiserror::Error;

/// Stable machine-readable code for errors caused by a stopped Mihomo core.
pub const ERROR_CODE_CORE_NOT_RUNNING: &str = "CORE_NOT_RUNNING";

/// Fallback code for errors that only carry a message.
pub const ERROR_CODE_UNKNOWN: &str = "UNKNOWN";

/// Returns `true` when the native surface is currently rendered in English.
///
/// The frontend pushes the effective locale through `set_ui_locale`, which updates the tray
/// locale before the webview is destroyed in lightweight mode, so every backend message can
/// follow the same locale without keeping duplicated state.
pub(crate) fn is_english() -> bool {
    crate::tray::is_english()
}

/// Picks the message matching the current UI locale. Both operands are only evaluated for the
/// selected branch, so formatting a large message in the other language costs nothing.
#[macro_export]
macro_rules! tr {
    ($zh:expr, $en:expr $(,)?) => {
        if $crate::error::is_english() {
            $en
        } else {
            $zh
        }
    };
}

/// Builds the localized "core is not running" message.
pub(crate) fn core_not_running_message(detail_zh: &str, detail_en: &str) -> String {
    if is_english() {
        detail_en.to_string()
    } else {
        detail_zh.to_string()
    }
}

/// Formats a localized prefix followed by a nested error's detail.
fn with_prefix(prefix_zh: &str, prefix_en: &str, detail: &dyn std::fmt::Display) -> String {
    if is_english() {
        format!("{prefix_en}: {detail}")
    } else {
        format!("{prefix_zh}: {detail}")
    }
}

fn port_occupied_message(port: &u16) -> String {
    if is_english() {
        format!("Port {port} is already occupied")
    } else {
        format!("端口 {port} 已被占用")
    }
}

fn duplicate_node_binding_message(node_name: &str, port: &u16) -> String {
    if is_english() {
        format!("Proxy node \"{node_name}\" is already bound to port {port}; it cannot be bound to another port")
    } else {
        format!("代理节点「{node_name}」已绑定到端口 {port}，不可重复绑定至其他端口")
    }
}

/// Structured IPC error: `code` is stable across locales, `message` is already localized and
/// safe to display as-is.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: String,
    pub message: String,
}

impl CommandError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }

    /// Builds a `CORE_NOT_RUNNING` error whose message follows the active UI locale.
    pub fn core_not_running(detail_zh: &str, detail_en: &str) -> Self {
        Self::new(
            ERROR_CODE_CORE_NOT_RUNNING,
            core_not_running_message(detail_zh, detail_en),
        )
    }
}

impl std::fmt::Display for CommandError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for CommandError {}

impl From<String> for CommandError {
    fn from(message: String) -> Self {
        Self::new(ERROR_CODE_UNKNOWN, message)
    }
}

impl From<&str> for CommandError {
    fn from(message: &str) -> Self {
        Self::new(ERROR_CODE_UNKNOWN, message)
    }
}

impl From<AppError> for CommandError {
    fn from(error: AppError) -> Self {
        Self::new(ERROR_CODE_UNKNOWN, error.to_string())
    }
}

#[derive(Error, Debug)]
pub enum AppError {
    #[error("{}", with_prefix("I/O 错误", "I/O error", .0))]
    Io(#[from] std::io::Error),

    #[error("{}", with_prefix("序列化错误", "Serialization error", .0))]
    Serialization(#[from] serde_json::Error),

    #[error("{}", with_prefix("YAML 错误", "YAML error", .0))]
    Yaml(#[from] serde_yaml_ng::Error),

    #[error("{}", with_prefix("网络请求错误", "Network request error", .0))]
    Network(#[from] reqwest::Error),

    #[error("{}", with_prefix("未找到内核可执行文件", "Sidecar binary not found", .0))]
    SidecarNotFound(String),

    #[error("{}", with_prefix("内核进程执行失败", "Sidecar execution failed", .0))]
    SidecarExecution(String),

    #[error("{}", with_prefix("外部控制器错误", "External controller error", .0))]
    ExternalController(String),

    #[error("{}", port_occupied_message(.0))]
    PortOccupied(u16),

    #[error("{}", with_prefix("配置无效", "Invalid configuration", .0))]
    InvalidConfig(String),

    #[error("{}", duplicate_node_binding_message(.node_name, .port))]
    DuplicateNodeBinding { node_name: String, port: u16 },

    #[error("{}", .0)]
    ProfileNotFound(String),

    #[error("{}", .0)]
    PortMappingNotFound(String),

    #[error("{}", with_prefix("进程监督错误", "Process supervisor error", .0))]
    Supervisor(String),

    #[error("{}", with_prefix("内部错误", "Internal error", .0))]
    Internal(String),
}

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
