//! Virtual OS mode for development instances.
//!
//! Dev builds (`tauri dev` / the `com.mihomo.multi.dev` identifier) run against the same
//! machine as a production install. Without isolation, toggling system proxy, terminal
//! environment variables, TUN, UWP loopback exemptions or autostart in dev would mutate
//! the user's real OS state and could hijack the production instance's configuration.
//!
//! When virtual mode is enabled every OS mutation reports success while only updating
//! in-memory state, so the dev UI keeps full functional fidelity without side effects.

use std::sync::atomic::{AtomicBool, Ordering};

static ENABLED: AtomicBool = AtomicBool::new(cfg!(any(test, debug_assertions)));

pub fn set_enabled(enabled: bool) {
    ENABLED.store(enabled, Ordering::SeqCst);
}

pub fn is_enabled() -> bool {
    ENABLED.load(Ordering::SeqCst)
}
