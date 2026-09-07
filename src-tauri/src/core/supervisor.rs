use crate::core::config_generator::MinimalRuntimeConfig;
use crate::error::{AppError, AppResult};
use crate::models::{AppConfig, CoreStatus};
use parking_lot::Mutex;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::time::Instant;
use tauri::Manager;
use tracing::{info, warn};

#[cfg(windows)]
use std::os::windows::io::AsRawHandle;
#[cfg(windows)]
use windows_sys::Win32::Foundation::HANDLE;
#[cfg(windows)]
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation, SetInformationJobObject,
};

#[cfg(windows)]
struct JobObjectGuard {
    handle: HANDLE,
}

#[cfg(windows)]
unsafe impl Send for JobObjectGuard {}
#[cfg(windows)]
unsafe impl Sync for JobObjectGuard {}

#[cfg(windows)]
impl JobObjectGuard {
    fn new() -> Option<Self> {
        unsafe {
            let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if handle.is_null() {
                warn!("Failed to create Windows JobObject");
                return None;
            }

            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

            let res = SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const _,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );

            if res == 0 {
                warn!("Failed to set JobObjectExtendedLimitInformation");
                windows_sys::Win32::Foundation::CloseHandle(handle);
                return None;
            }

            Some(Self { handle })
        }
    }

    fn assign_process(&self, child: &Child) -> bool {
        let process_handle = child.as_raw_handle() as HANDLE;
        let res = unsafe { AssignProcessToJobObject(self.handle, process_handle) };
        if res == 0 {
            warn!("Failed to assign process to Windows JobObject");
            false
        } else {
            info!("Successfully assigned Mihomo sidecar to Windows JobObject");
            true
        }
    }
}

#[cfg(windows)]
impl Drop for JobObjectGuard {
    fn drop(&mut self) {
        if !self.handle.is_null() {
            unsafe {
                windows_sys::Win32::Foundation::CloseHandle(self.handle);
            }
        }
    }
}

struct SupervisorInner {
    child: Option<Child>,
    start_time: Option<Instant>,
    pid: Option<u32>,
    version: Option<String>,
    sidecar_path: PathBuf,
    controller_port: u16,
    secret: String,
    last_error: Option<String>,
    #[cfg(windows)]
    job_object: Option<JobObjectGuard>,
    simulated: bool,
}

#[derive(Clone)]
pub struct CoreSupervisor {
    inner: Arc<Mutex<SupervisorInner>>,
    work_dir: PathBuf,
}

impl CoreSupervisor {
    pub fn new(work_dir: PathBuf) -> Self {
        #[cfg(windows)]
        let job_object = JobObjectGuard::new();

        let inner = SupervisorInner {
            child: None,
            start_time: None,
            pid: None,
            version: None,
            sidecar_path: PathBuf::new(),
            controller_port: 9999,
            secret: String::new(),
            last_error: None,
            #[cfg(windows)]
            job_object,
            simulated: false,
        };

        Self {
            inner: Arc::new(Mutex::new(inner)),
            work_dir,
        }
    }

    pub fn new_simulated(work_dir: PathBuf) -> Self {
        let inner = SupervisorInner {
            child: None,
            start_time: None,
            pid: None,
            version: None,
            sidecar_path: PathBuf::new(),
            controller_port: 9999,
            secret: String::new(),
            last_error: None,
            #[cfg(windows)]
            job_object: None,
            simulated: true,
        };

        Self {
            inner: Arc::new(Mutex::new(inner)),
            work_dir,
        }
    }

    pub fn get_host_target() -> &'static str {
        if cfg!(target_os = "windows") {
            if cfg!(target_arch = "aarch64") {
                "aarch64-pc-windows-msvc.exe"
            } else if cfg!(target_arch = "x86") {
                "i686-pc-windows-msvc.exe"
            } else {
                "x86_64-pc-windows-msvc.exe"
            }
        } else if cfg!(target_os = "macos") {
            if cfg!(target_arch = "aarch64") {
                "aarch64-apple-darwin"
            } else {
                "x86_64-apple-darwin"
            }
        } else if cfg!(target_arch = "aarch64") {
            "aarch64-unknown-linux-gnu"
        } else {
            "x86_64-unknown-linux-gnu"
        }
    }

    pub fn locate_sidecar(&self, app_handle: Option<&tauri::AppHandle>) -> AppResult<PathBuf> {
        let host_target = Self::get_host_target();
        let binary_name = format!("mihomo-{}", host_target);

        // 1. Check portable mode first: if .portable exists next to the current exe,
        // prioritize the binary in exe_dir/binaries/
        if let Ok(current_exe) = std::env::current_exe()
            && let Some(exe_dir) = current_exe.parent()
            && (exe_dir.join(".portable").exists() || exe_dir.join("PORTABLE").exists())
        {
            let portable_candidate = exe_dir.join("binaries").join(&binary_name);
            if portable_candidate.exists() {
                return Ok(portable_candidate);
            }
            #[cfg(target_os = "macos")]
            {
                let universal_portable = exe_dir.join("binaries").join("mihomo-universal-apple-darwin");
                if universal_portable.exists() {
                    return Ok(universal_portable);
                }
            }
        }

        // 2. Check dynamic update directory in app_local_data_dir (for installed versions where updates land)
        if let Some(app) = app_handle {
            if let Ok(app_dir) = app.path().app_local_data_dir() {
                let app_candidate = app_dir.join("binaries").join(&binary_name);
                if app_candidate.exists() {
                    return Ok(app_candidate);
                }
            }

            // 3. Check app resource/binary directory (bundled out-of-the-box sidecar)
            if let Ok(resource_dir) = app.path().resource_dir() {
                let resource_candidate = resource_dir.join("binaries").join(&binary_name);
                if resource_candidate.exists() {
                    return Ok(resource_candidate);
                }
                #[cfg(target_os = "macos")]
                {
                    let universal_resource = resource_dir.join("binaries").join("mihomo-universal-apple-darwin");
                    if universal_resource.exists() {
                        return Ok(universal_resource);
                    }
                }
            }
        }

        // 4. Check relative to current working directory (dev mode)
        let local_candidates = [
            PathBuf::from("src-tauri/binaries").join(&binary_name),
            PathBuf::from("binaries").join(&binary_name),
            PathBuf::from("../src-tauri/binaries").join(&binary_name),
            #[cfg(target_os = "macos")]
            PathBuf::from("src-tauri/binaries/mihomo-universal-apple-darwin"),
            #[cfg(target_os = "macos")]
            PathBuf::from("binaries/mihomo-universal-apple-darwin"),
        ];
        for candidate in &local_candidates {
            if candidate.exists() {
                if let Ok(canonical) = candidate.canonicalize() {
                    return Ok(canonical);
                }
                return Ok(candidate.clone());
            }
        }

        // 5. Fallback: check if 'mihomo' or 'mihomo.exe' is directly next to exe or in current dir
        let plain_binary = if cfg!(windows) { "mihomo.exe" } else { "mihomo" };
        if let Ok(current_exe) = std::env::current_exe()
            && let Some(exe_dir) = current_exe.parent()
        {
            let exe_plain = exe_dir.join(plain_binary);
            if exe_plain.exists() {
                return Ok(exe_plain);
            }
        }
        let plain_candidate = PathBuf::from(plain_binary);
        if plain_candidate.exists() {
            return Ok(plain_candidate);
        }
        Err(AppError::SidecarNotFound(format!(
            "Could not locate Mihomo sidecar binary '{}'. Please run 'pnpm dev:sidecar' first.",
            binary_name
        )))
    }

    pub fn query_version(&self, binary_path: &Path) -> Option<String> {
        let mut cmd = Command::new(binary_path);
        cmd.arg("-v");
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
        }
        let output = cmd.output().ok()?;
        if output.status.success() {
            let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let first_line = text.lines().next().unwrap_or(&text).to_string();
            Some(first_line)
        } else {
            None
        }
    }

    pub fn start(&self, app_handle: Option<&tauri::AppHandle>, config: &AppConfig) -> AppResult<CoreStatus> {
        let mut inner = self.inner.lock();

        // If already running, check if process is still alive
        if inner.simulated {
            if inner.pid.is_some() {
                info!("Simulated Mihomo core is already running with PID: {:?}", inner.pid);
                inner.last_error = None;
                return Ok(self.status_from_inner(&inner));
            }
        } else if let Some(ref mut child) = inner.child {
            match child.try_wait() {
                Ok(None) => {
                    info!("Mihomo core is already running with PID: {:?}", inner.pid);
                    inner.last_error = None;
                    return Ok(self.status_from_inner(&inner));
                }
                Ok(Some(status)) => {
                    warn!("Previous Mihomo process exited with status: {}", status);
                    inner.child = None;
                }
                Err(err) => {
                    warn!("Failed to check previous process status: {}", err);
                    inner.child = None;
                }
            }
        }

        // 1. Check if controller port is available before spawning
        if !crate::core::port_probe::is_port_available(config.controller_port) {
            let err_msg = format!(
                "外部控制器端口 {} 已被本地其他应用程序占用，无法启动 Mihomo 内核。请在「设置」中修改控制器端口（例如 9090），或关闭占用该端口的程序。",
                config.controller_port
            );
            inner.last_error = Some(err_msg.clone());
            return Err(AppError::SidecarExecution(err_msg));
        }

        // Ensure working directory and runtime configuration exist
        if let Err(e) = std::fs::create_dir_all(&self.work_dir).map_err(AppError::Io) {
            inner.last_error = Some(e.to_string());
            return Err(e);
        }

        let runtime_yaml_path = self.work_dir.join("runtime.yaml");
        if !runtime_yaml_path.exists() {
            let minimal_config =
                MinimalRuntimeConfig::new(config.controller_port, &config.controller_secret, &config.log_level);
            if let Err(e) = minimal_config.write_to_file(&runtime_yaml_path) {
                inner.last_error = Some(e.to_string());
                return Err(e);
            }
        }

        if inner.simulated {
            inner.pid = Some(99999);
            inner.start_time = Some(Instant::now());
            inner.version = Some("Mihomo (simulated) v1.19.0".to_string());
            inner.sidecar_path = self.work_dir.join("simulated-mihomo");
            inner.controller_port = config.controller_port;
            inner.secret = config.controller_secret.clone();
            inner.last_error = None;
            return Ok(self.status_from_inner(&inner));
        }

        let sidecar_path = match self.locate_sidecar(app_handle) {
            Ok(p) => p,
            Err(e) => {
                inner.last_error = Some(e.to_string());
                return Err(e);
            }
        };
        let version = self.query_version(&sidecar_path);

        let geo_work_dir = self.work_dir.clone();
        tauri::async_runtime::spawn(async move {
            let _ = crate::core::geo_manager::ensure_geo_databases(&geo_work_dir).await;
        });

        // Setup log file redirection
        let log_dir = self.work_dir.join("logs");
        std::fs::create_dir_all(&log_dir).ok();
        let log_path = log_dir.join("mihomo.log");
        let log_file = match std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
            .map_err(AppError::Io)
        {
            Ok(f) => f,
            Err(e) => {
                inner.last_error = Some(e.to_string());
                return Err(e);
            }
        };
        let log_file_err = match log_file.try_clone().map_err(AppError::Io) {
            Ok(f) => f,
            Err(e) => {
                inner.last_error = Some(e.to_string());
                return Err(e);
            }
        };

        info!(
            "Spawning Mihomo sidecar from '{}' with work dir '{}', logging to '{}'",
            sidecar_path.display(),
            self.work_dir.display(),
            log_path.display()
        );

        let mut cmd = Command::new(&sidecar_path);
        cmd.arg("-d")
            .arg(&self.work_dir)
            .arg("-f")
            .arg(&runtime_yaml_path)
            .stdout(Stdio::from(log_file))
            .stderr(Stdio::from(log_file_err));

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            // CREATE_NO_WINDOW = 0x08000000
            cmd.creation_flags(0x08000000);
        }

        let mut child = match cmd
            .spawn()
            .map_err(|err| AppError::SidecarExecution(format!("Failed to spawn Mihomo sidecar: {}", err)))
        {
            Ok(c) => c,
            Err(e) => {
                inner.last_error = Some(e.to_string());
                return Err(e);
            }
        };

        // Brief delay to detect immediate crashes
        std::thread::sleep(std::time::Duration::from_millis(150));
        match child.try_wait() {
            Ok(Some(status)) => {
                let err_msg = format!(
                    "Mihomo 内核启动失败并异常退出 (退出码: {})。详情请查看日志文件: {}",
                    status,
                    log_path.display()
                );
                inner.last_error = Some(err_msg.clone());
                return Err(AppError::SidecarExecution(err_msg));
            }
            Err(err) => {
                warn!("Failed to check child status immediately after spawn: {}", err);
            }
            Ok(None) => {}
        }

        let pid = child.id();
        info!("Mihomo sidecar process spawned successfully, PID: {}", pid);

        #[cfg(windows)]
        {
            if let Some(ref job) = inner.job_object {
                job.assign_process(&child);
            }
        }

        inner.child = Some(child);
        inner.start_time = Some(Instant::now());
        inner.pid = Some(pid);
        inner.version = version;
        inner.sidecar_path = sidecar_path;
        inner.controller_port = config.controller_port;
        inner.secret = config.controller_secret.clone();
        inner.last_error = None;

        Ok(self.status_from_inner(&inner))
    }

    pub fn stop(&self) -> AppResult<()> {
        let mut inner = self.inner.lock();
        if inner.simulated {
            inner.pid = None;
            inner.start_time = None;
            inner.last_error = None;
            return Ok(());
        }
        if let Some(mut child) = inner.child.take() {
            info!("Stopping Mihomo sidecar process (PID: {:?})", inner.pid);
            let _ = child.kill();
            let _ = child.wait();
            info!("Mihomo sidecar stopped");
        }
        inner.start_time = None;
        inner.pid = None;
        inner.last_error = None;
        Ok(())
    }

    pub fn restart(&self, app_handle: Option<&tauri::AppHandle>, config: &AppConfig) -> AppResult<CoreStatus> {
        self.stop()?;
        std::thread::sleep(std::time::Duration::from_millis(150));
        self.start(app_handle, config)
    }

    pub fn get_status(&self) -> CoreStatus {
        let mut inner = self.inner.lock();
        let running = if inner.simulated {
            inner.pid.is_some()
        } else if let Some(ref mut child) = inner.child {
            match child.try_wait() {
                Ok(None) => true,
                _ => {
                    inner.child = None;
                    inner.start_time = None;
                    inner.pid = None;
                    false
                }
            }
        } else {
            false
        };

        let uptime = if running {
            inner.start_time.map(|t| t.elapsed().as_secs()).unwrap_or(0)
        } else {
            0
        };

        CoreStatus {
            running,
            pid: if running { inner.pid } else { None },
            controller_port: inner.controller_port,
            secret: inner.secret.clone(),
            version: inner.version.clone(),
            uptime_seconds: uptime,
            sidecar_path: inner.sidecar_path.to_string_lossy().to_string(),
            last_error: inner.last_error.clone(),
        }
    }

    fn status_from_inner(&self, inner: &SupervisorInner) -> CoreStatus {
        let uptime = inner.start_time.map(|t| t.elapsed().as_secs()).unwrap_or(0);
        let running = if inner.simulated {
            inner.pid.is_some()
        } else {
            inner.child.is_some()
        };
        CoreStatus {
            running,
            pid: inner.pid,
            controller_port: inner.controller_port,
            secret: inner.secret.clone(),
            version: inner.version.clone(),
            uptime_seconds: uptime,
            sidecar_path: inner.sidecar_path.to_string_lossy().to_string(),
            last_error: inner.last_error.clone(),
        }
    }
}

impl Drop for CoreSupervisor {
    fn drop(&mut self) {
        if Arc::strong_count(&self.inner) == 1 {
            let _ = self.stop();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_core_supervisor_initial_state() {
        let temp_dir = std::env::temp_dir().join("mihomo_multi_test_work_dir");
        let supervisor = CoreSupervisor::new(temp_dir);

        let status = supervisor.get_status();
        assert!(!status.running);
        assert!(status.pid.is_none());
        assert_eq!(status.uptime_seconds, 0);
        assert_eq!(status.controller_port, 9999);
    }
}
