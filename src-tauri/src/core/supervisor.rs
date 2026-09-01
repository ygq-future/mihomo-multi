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
    #[cfg(windows)]
    job_object: Option<JobObjectGuard>,
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
            #[cfg(windows)]
            job_object,
        };

        Self {
            inner: Arc::new(Mutex::new(inner)),
            work_dir,
        }
    }

    pub fn locate_sidecar(&self, app_handle: &tauri::AppHandle) -> AppResult<PathBuf> {
        let host_target = if cfg!(target_os = "windows") {
            "x86_64-pc-windows-msvc.exe"
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
        };

        let binary_name = format!("mihomo-{}", host_target);

        // 1. Check relative to current working directory (dev mode)
        let local_candidates = [
            PathBuf::from("src-tauri/binaries").join(&binary_name),
            PathBuf::from("binaries").join(&binary_name),
            PathBuf::from("../src-tauri/binaries").join(&binary_name),
        ];

        for candidate in &local_candidates {
            if candidate.exists() {
                if let Ok(canonical) = candidate.canonicalize() {
                    return Ok(canonical);
                }
                return Ok(candidate.clone());
            }
        }

        // 2. Check app resource/binary directory (bundle mode)
        if let Ok(resource_dir) = app_handle.path().resource_dir() {
            let resource_candidate = resource_dir.join("binaries").join(&binary_name);
            if resource_candidate.exists() {
                return Ok(resource_candidate);
            }
        }

        if let Ok(app_dir) = app_handle.path().app_local_data_dir() {
            let app_candidate = app_dir.join("binaries").join(&binary_name);
            if app_candidate.exists() {
                return Ok(app_candidate);
            }
        }

        // 3. Fallback: check if 'mihomo' or 'mihomo.exe' is directly in current dir or PATH
        let plain_binary = if cfg!(windows) { "mihomo.exe" } else { "mihomo" };
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
        let output = Command::new(binary_path).arg("-v").output().ok()?;
        if output.status.success() {
            let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let first_line = text.lines().next().unwrap_or(&text).to_string();
            Some(first_line)
        } else {
            None
        }
    }

    pub fn start(&self, app_handle: &tauri::AppHandle, config: &AppConfig) -> AppResult<CoreStatus> {
        let mut inner = self.inner.lock();

        // If already running, check if process is still alive
        if let Some(ref mut child) = inner.child {
            match child.try_wait() {
                Ok(None) => {
                    info!("Mihomo core is already running with PID: {:?}", inner.pid);
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

        let sidecar_path = self.locate_sidecar(app_handle)?;
        let version = self.query_version(&sidecar_path);

        // Ensure working directory and runtime configuration exist
        std::fs::create_dir_all(&self.work_dir).map_err(AppError::Io)?;
        let runtime_yaml_path = self.work_dir.join("runtime.yaml");

        if !runtime_yaml_path.exists() {
            let minimal_config =
                MinimalRuntimeConfig::new(config.controller_port, &config.controller_secret, &config.log_level);
            minimal_config.write_to_file(&runtime_yaml_path)?;
        }

        info!(
            "Spawning Mihomo sidecar from '{}' with work dir '{}'",
            sidecar_path.display(),
            self.work_dir.display()
        );

        let mut cmd = Command::new(&sidecar_path);
        cmd.arg("-d")
            .arg(&self.work_dir)
            .arg("-f")
            .arg(&runtime_yaml_path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            // CREATE_NO_WINDOW = 0x08000000
            cmd.creation_flags(0x08000000);
        }

        let child = cmd
            .spawn()
            .map_err(|err| AppError::SidecarExecution(format!("Failed to spawn Mihomo sidecar: {}", err)))?;

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

        Ok(self.status_from_inner(&inner))
    }

    pub fn stop(&self) -> AppResult<()> {
        let mut inner = self.inner.lock();
        if let Some(mut child) = inner.child.take() {
            info!("Stopping Mihomo sidecar process (PID: {:?})", inner.pid);
            let _ = child.kill();
            let _ = child.wait();
            info!("Mihomo sidecar stopped");
        }
        inner.start_time = None;
        inner.pid = None;
        Ok(())
    }

    pub fn restart(&self, app_handle: &tauri::AppHandle, config: &AppConfig) -> AppResult<CoreStatus> {
        self.stop()?;
        std::thread::sleep(std::time::Duration::from_millis(150));
        self.start(app_handle, config)
    }

    pub fn get_status(&self) -> CoreStatus {
        let mut inner = self.inner.lock();
        let running = if let Some(ref mut child) = inner.child {
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
        }
    }

    fn status_from_inner(&self, inner: &SupervisorInner) -> CoreStatus {
        let uptime = inner.start_time.map(|t| t.elapsed().as_secs()).unwrap_or(0);
        CoreStatus {
            running: inner.child.is_some(),
            pid: inner.pid,
            controller_port: inner.controller_port,
            secret: inner.secret.clone(),
            version: inner.version.clone(),
            uptime_seconds: uptime,
            sidecar_path: inner.sidecar_path.to_string_lossy().to_string(),
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
