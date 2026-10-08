use crate::error::{AppError, AppResult};

#[cfg(windows)]
pub fn is_elevated() -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::Security::{GetTokenInformation, TOKEN_ELEVATION, TOKEN_QUERY, TokenElevation};
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    let mut token: HANDLE = std::ptr::null_mut();
    // SAFETY: 仅查询当前进程令牌，句柄在函数内关闭
    unsafe {
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return false;
        }
        let mut elevation = TOKEN_ELEVATION { TokenIsElevated: 0 };
        let mut returned: u32 = 0;
        let ok = GetTokenInformation(
            token,
            TokenElevation,
            &mut elevation as *mut _ as *mut core::ffi::c_void,
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut returned,
        );
        CloseHandle(token);
        ok != 0 && elevation.TokenIsElevated != 0
    }
}

#[cfg(not(windows))]
pub fn is_elevated() -> bool {
    false
}

#[cfg(windows)]
pub fn relaunch_as_admin(extra_args: &[String]) -> AppResult<()> {
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    let exe = std::env::current_exe().map_err(AppError::Io)?;
    let operation = wide("runas");
    let file = wide(&exe.display().to_string());
    let params = if extra_args.is_empty() {
        wide("")
    } else {
        wide(&format!(" {}", extra_args.join(" ")))
    };

    // SAFETY: 传入的都是以 NUL 结尾的 UTF-16 缓冲区，返回值 > 32 表示启动成功
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            operation.as_ptr(),
            file.as_ptr(),
            params.as_ptr(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    };
    if (result as isize) <= 32 {
        return Err(AppError::Internal(format!(
            "以管理员身份重启失败（ShellExecuteW 返回 {}），请手动右键以管理员身份运行",
            result as isize
        )));
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn relaunch_as_admin(_extra_args: &[String]) -> AppResult<()> {
    Err(AppError::Internal("当前平台不支持管理员重启".to_string()))
}

#[cfg(windows)]
pub fn wait_for_process_exit(pid: u32, timeout_ms: u32) -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
    use windows_sys::Win32::System::Threading::{OpenProcess, WaitForSingleObject};

    const SYNCHRONIZE_ACCESS: u32 = 0x0010_0000;
    // SAFETY: 句柄在函数内关闭；提权进程可以打开普通权限进程的 SYNCHRONIZE 句柄
    unsafe {
        let handle = OpenProcess(SYNCHRONIZE_ACCESS, 0, pid);
        if handle.is_null() {
            return true;
        }
        let waited = WaitForSingleObject(handle, timeout_ms);
        CloseHandle(handle);
        waited == WAIT_OBJECT_0
    }
}

#[cfg(not(windows))]
pub fn wait_for_process_exit(_pid: u32, _timeout_ms: u32) -> bool {
    true
}
