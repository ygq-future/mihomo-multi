use crate::core::profile_manager::atomic_write_file;
use crate::error::{AppError, AppResult};
use parking_lot::{Mutex, RwLock};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use tracing::warn;

const ICON_CACHE_SCHEMA_VERSION: u32 = 1;
const MAX_CACHED_ICONS: usize = 2048;
const MAX_MISSING_PATHS: usize = 4096;
const MAX_ICON_DATA_URI_BYTES: usize = 96 * 1024;
const MAX_ICON_CACHE_FILE_BYTES: u64 = 8 * 1024 * 1024;
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IconCacheFile {
    schema_version: u32,
    icons: BTreeMap<String, String>,
}

#[derive(Default)]
struct IconCacheState {
    icons: HashMap<String, String>,
    missing_paths: HashSet<String>,
    dirty: bool,
    change_counter: u64,
}

pub struct ExecutableIconCache {
    state: RwLock<IconCacheState>,
    storage_path: PathBuf,
    persist_lock: Mutex<()>,
}

fn normalize_icon_key(path: &str) -> String {
    let trimmed = path.trim();
    if cfg!(windows) {
        trimmed.replace('/', "\\").to_lowercase()
    } else {
        trimmed.to_string()
    }
}

impl ExecutableIconCache {
    pub fn new(app_dir: &Path) -> Self {
        let storage_path = app_dir.join("icon_cache.json");
        let icons = Self::load_from_disk(&storage_path);
        Self {
            state: RwLock::new(IconCacheState {
                icons,
                missing_paths: HashSet::new(),
                dirty: false,
                change_counter: 0,
            }),
            storage_path,
            persist_lock: Mutex::new(()),
        }
    }

    fn load_from_disk(path: &Path) -> HashMap<String, String> {
        let Ok(meta) = std::fs::metadata(path) else {
            return HashMap::new();
        };
        if meta.len() > MAX_ICON_CACHE_FILE_BYTES {
            warn!("Skipping oversized icon_cache.json ({} bytes)", meta.len());
            return HashMap::new();
        }
        let Ok(content) = std::fs::read_to_string(path) else {
            return HashMap::new();
        };
        let parsed = match serde_json::from_str::<IconCacheFile>(&content) {
            Ok(file) => file,
            Err(e) => {
                warn!("Failed to parse icon_cache.json: {}", e);
                return HashMap::new();
            }
        };

        let mut map = HashMap::new();
        for (raw_key, value) in parsed.icons {
            if map.len() >= MAX_CACHED_ICONS {
                break;
            }
            let key = normalize_icon_key(&raw_key);
            if key.is_empty() || value.len() > MAX_ICON_DATA_URI_BYTES || !value.starts_with("data:image/") {
                continue;
            }
            map.insert(key, value);
        }
        map
    }

    /// Read-only memory lookup for an already cached executable icon data URI.
    pub fn get_cached(&self, process_path: &str) -> Option<String> {
        let key = normalize_icon_key(process_path);
        if key.is_empty() {
            return None;
        }
        self.state.read().icons.get(&key).cloned()
    }

    /// Fast in-memory filter that returns only unique paths not yet cached or known missing.
    pub fn filter_uncached_paths(&self, paths: Vec<String>) -> Vec<String> {
        let guard = self.state.read();
        let mut seen = HashSet::new();
        let mut uncached = Vec::new();
        for raw in paths {
            let trimmed = raw.trim();
            if trimmed.is_empty() || trimmed.starts_with("data:image/") {
                continue;
            }
            let key = normalize_icon_key(trimmed);
            if !seen.insert(key.clone()) {
                continue;
            }
            if !guard.icons.contains_key(&key) && !guard.missing_paths.contains(&key) {
                uncached.push(trimmed.to_string());
            }
        }
        uncached
    }
    /// Resolves a process icon from memory cache or extracts and caches it on demand.
    pub fn resolve_or_extract(&self, process_path: &str) -> Option<String> {
        let trimmed = process_path.trim();
        if trimmed.is_empty() {
            return None;
        }
        if trimmed.starts_with("data:image/") {
            return Some(trimmed.to_string());
        }
        let key = normalize_icon_key(trimmed);
        {
            let guard = self.state.read();
            if let Some(hit) = guard.icons.get(&key) {
                return Some(hit.clone());
            }
            if guard.missing_paths.contains(&key) {
                return None;
            }
        }

        let extracted = extract_executable_icon_data_uri(trimmed);
        let mut guard = self.state.write();
        if let Some(existing) = guard.icons.get(&key) {
            return Some(existing.clone());
        }
        if let Some(uri) = extracted {
            if guard.icons.len() >= MAX_CACHED_ICONS {
                let evict_count = (MAX_CACHED_ICONS / 10).max(1);
                let keys_to_remove: Vec<String> = guard.icons.keys().take(evict_count).cloned().collect();
                for k in keys_to_remove {
                    guard.icons.remove(&k);
                }
            }
            guard.icons.insert(key, uri.clone());
            guard.dirty = true;
            guard.change_counter = guard.change_counter.saturating_add(1);
            Some(uri)
        } else {
            if guard.missing_paths.len() >= MAX_MISSING_PATHS {
                let evict_count = (MAX_MISSING_PATHS / 10).max(1);
                let keys_to_remove: Vec<String> = guard.missing_paths.iter().take(evict_count).cloned().collect();
                for k in keys_to_remove {
                    guard.missing_paths.remove(&k);
                }
            }
            guard.missing_paths.insert(key);
            None
        }
    }

    /// Resolves all uncached executable paths and flushes to disk if new icons were extracted.
    pub fn warm_paths<I, S>(&self, paths: I) -> usize
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let mut extracted_count = 0usize;
        let mut seen = HashSet::new();
        for raw in paths {
            let trimmed = raw.as_ref().trim();
            if trimmed.is_empty() {
                continue;
            }
            let key = normalize_icon_key(trimmed);
            if !seen.insert(key.clone()) {
                continue;
            }
            let already_known = {
                let guard = self.state.read();
                guard.icons.contains_key(&key) || guard.missing_paths.contains(&key)
            };
            if already_known {
                continue;
            }
            if self.resolve_or_extract(trimmed).is_some() {
                extracted_count = extracted_count.saturating_add(1);
            }
        }
        extracted_count
    }

    pub fn save_if_dirty(&self) -> AppResult<bool> {
        let _persist_guard = self.persist_lock.lock();
        let (snapshot, counter) = {
            let guard = self.state.read();
            if !guard.dirty || guard.icons.is_empty() {
                return Ok(false);
            }
            let ordered: BTreeMap<String, String> = guard.icons.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
            (ordered, guard.change_counter)
        };

        let payload = IconCacheFile {
            schema_version: ICON_CACHE_SCHEMA_VERSION,
            icons: snapshot,
        };
        let json = serde_json::to_string(&payload).map_err(|e| {
            AppError::Internal(crate::tr!(
                format!("序列化应用图标缓存失败: {e}"),
                format!("Failed to serialize icon cache: {e}"),
            ))
        })?;
        atomic_write_file(&self.storage_path, json.as_bytes())?;

        let mut guard = self.state.write();
        if guard.change_counter == counter {
            guard.dirty = false;
        }
        Ok(true)
    }
}

#[cfg(windows)]
fn encode_base64(data: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b0 = u32::from(chunk[0]);
        let b1 = u32::from(chunk.get(1).copied().unwrap_or(0));
        let b2 = u32::from(chunk.get(2).copied().unwrap_or(0));
        let triple = (b0 << 16) | (b1 << 8) | b2;

        out.push(ALPHABET[((triple >> 18) & 0x3F) as usize] as char);
        out.push(ALPHABET[((triple >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            out.push(ALPHABET[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(ALPHABET[(triple & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

#[cfg(windows)]
fn extract_executable_icon_data_uri(utf8_path: &str) -> Option<String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Graphics::Gdi::{
        BI_BITFIELDS, BITMAPFILEHEADER, BITMAPINFO, BITMAPV5HEADER, CreateCompatibleDC, CreateDIBSection,
        DIB_RGB_COLORS, DeleteDC, DeleteObject, GdiFlush, GetDC, ReleaseDC, SelectObject,
    };
    use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_NORMAL;
    use windows_sys::Win32::UI::Shell::{SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON, SHGetFileInfoW};
    use windows_sys::Win32::UI::WindowsAndMessaging::{DI_NORMAL, DestroyIcon, DrawIconEx};

    const ICON_SIZE: usize = 24;
    const ICON_SIZE_I32: i32 = 24;
    if !Path::new(utf8_path).is_file() {
        return None;
    }

    let wide: Vec<u16> = OsStr::new(utf8_path).encode_wide().chain(std::iter::once(0)).collect();

    unsafe {
        let mut sfi: SHFILEINFOW = std::mem::zeroed();
        let ok = SHGetFileInfoW(
            wide.as_ptr(),
            FILE_ATTRIBUTE_NORMAL,
            &raw mut sfi,
            u32::try_from(std::mem::size_of::<SHFILEINFOW>()).ok()?,
            SHGFI_ICON | SHGFI_LARGEICON,
        );
        if ok == 0 || sfi.hIcon.is_null() {
            return None;
        }

        let mut bi: BITMAPV5HEADER = std::mem::zeroed();
        bi.bV5Size = u32::try_from(std::mem::size_of::<BITMAPV5HEADER>()).ok()?;
        bi.bV5Width = ICON_SIZE_I32;
        bi.bV5Height = ICON_SIZE_I32; // bottom-up DIB
        bi.bV5Planes = 1;
        bi.bV5BitCount = 32;
        bi.bV5Compression = BI_BITFIELDS;
        bi.bV5RedMask = 0x00FF_0000;
        bi.bV5GreenMask = 0x0000_FF00;
        bi.bV5BlueMask = 0x0000_00FF;
        bi.bV5AlphaMask = 0xFF00_0000;

        let screen_dc = GetDC(std::ptr::null_mut());
        let mem_dc = CreateCompatibleDC(screen_dc);
        let mut bits: *mut std::ffi::c_void = std::ptr::null_mut();
        let dib = CreateDIBSection(
            mem_dc,
            (&raw const bi).cast::<BITMAPINFO>(),
            DIB_RGB_COLORS,
            &raw mut bits,
            std::ptr::null_mut(),
            0,
        );

        let mut result: Option<String> = None;
        if !dib.is_null() && !bits.is_null() {
            let old_bmp = SelectObject(mem_dc, dib);
            let pixel_bytes = ICON_SIZE * ICON_SIZE * 4;
            let px = std::slice::from_raw_parts_mut(bits.cast::<u8>(), pixel_bytes);
            px.fill(0);

            DrawIconEx(
                mem_dc,
                0,
                0,
                sfi.hIcon,
                ICON_SIZE_I32,
                ICON_SIZE_I32,
                0,
                std::ptr::null_mut(),
                DI_NORMAL,
            );
            GdiFlush();

            let any_alpha = px.iter().skip(3).step_by(4).any(|&a| a != 0);
            if !any_alpha {
                for chunk in px.chunks_exact_mut(4) {
                    if chunk[0] != 0 || chunk[1] != 0 || chunk[2] != 0 {
                        chunk[3] = 255;
                    }
                }
            }

            let bfh_size = std::mem::size_of::<BITMAPFILEHEADER>();
            let bi_size = std::mem::size_of::<BITMAPV5HEADER>();
            let off_bits = bfh_size + bi_size;
            let total_size = off_bits + pixel_bytes;

            let bfh = BITMAPFILEHEADER {
                bfType: 0x4D42, // 'BM'
                bfSize: u32::try_from(total_size).ok()?,
                bfReserved1: 0,
                bfReserved2: 0,
                bfOffBits: u32::try_from(off_bits).ok()?,
            };

            let mut bmp_buf = Vec::with_capacity(total_size);
            bmp_buf.extend_from_slice(std::slice::from_raw_parts((&raw const bfh).cast::<u8>(), bfh_size));
            bmp_buf.extend_from_slice(std::slice::from_raw_parts((&raw const bi).cast::<u8>(), bi_size));
            bmp_buf.extend_from_slice(px);

            let uri = format!("data:image/bmp;base64,{}", encode_base64(&bmp_buf));
            if uri.len() <= MAX_ICON_DATA_URI_BYTES {
                result = Some(uri);
            }
            SelectObject(mem_dc, old_bmp);
        }

        if !dib.is_null() {
            DeleteObject(dib);
        }
        if !mem_dc.is_null() {
            DeleteDC(mem_dc);
        }
        if !screen_dc.is_null() {
            ReleaseDC(std::ptr::null_mut(), screen_dc);
        }
        DestroyIcon(sfi.hIcon);

        result
    }
}

#[cfg(not(windows))]
fn extract_executable_icon_data_uri(_utf8_path: &str) -> Option<String> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_and_persists_executable_icon_cache() {
        let temp_dir = std::env::temp_dir().join(format!("mhm_icon_cache_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).expect("create temp dir");

        let cache = ExecutableIconCache::new(&temp_dir);

        #[cfg(windows)]
        {
            let exe = std::env::current_exe().expect("current exe");
            let exe_str = exe.to_string_lossy().to_string();
            let uri = cache.resolve_or_extract(&exe_str).expect("extract current exe icon");
            assert!(uri.starts_with("data:image/bmp;base64,"));

            // Case-insensitive and slash-normalized lookup hits cache
            let alt_key = exe_str.replace('\\', "/").to_uppercase();
            assert_eq!(cache.get_cached(&alt_key).as_deref(), Some(uri.as_str()));

            assert!(cache.save_if_dirty().expect("save icon cache"));
            assert!(!cache.save_if_dirty().expect("clean after save"));

            let reloaded = ExecutableIconCache::new(&temp_dir);
            assert_eq!(reloaded.get_cached(&exe_str).as_deref(), Some(uri.as_str()));
        }

        assert!(
            cache
                .resolve_or_extract(r"C:\NonExistent\definitely_missing_app_12345.exe")
                .is_none()
        );

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
