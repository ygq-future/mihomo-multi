use crate::core::drift_guard::DriftGuard;
use crate::models::{AutoUpdateEventPayload, AutoUpdaterStatus, DriftStatus, ProfileType};
use crate::state::AppState;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tracing::{error, info, warn};

fn current_unix_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::from_secs(0))
        .as_secs()
}

pub struct AutoUpdater {
    running: Arc<AtomicBool>,
    last_check_timestamp: Arc<AtomicU64>,
}

impl AutoUpdater {
    pub fn new() -> Self {
        Self {
            running: Arc::new(AtomicBool::new(false)),
            last_check_timestamp: Arc::new(AtomicU64::new(0)),
        }
    }

    /// Spawns the background auto-updater worker loop.
    pub fn start(&self, app_handle: AppHandle, app_state: AppState) {
        if self.running.swap(true, Ordering::SeqCst) {
            warn!("AutoUpdater background task is already running");
            return;
        }

        let running_flag = self.running.clone();
        let last_check = self.last_check_timestamp.clone();

        info!("Starting background profile auto-updater service...");

        tauri::async_runtime::spawn(async move {
            let mut ticker = tokio::time::interval(Duration::from_secs(60));
            // First tick fires immediately, we consume it
            ticker.tick().await;

            while running_flag.load(Ordering::Relaxed) {
                ticker.tick().await;

                if !running_flag.load(Ordering::Relaxed) {
                    break;
                }

                let now = current_unix_timestamp();
                last_check.store(now, Ordering::Relaxed);
                let _ = Self::check_and_update_eligible_profiles(&app_handle, &app_state).await;
            }

            info!("Background profile auto-updater service stopped");
        });
    }

    /// Stops the background auto-updater loop.
    pub fn stop(&self) {
        self.running.store(false, Ordering::SeqCst);
    }

    /// Returns current runtime status of the auto-updater.
    pub fn get_status(&self, app_state: &AppState) -> AutoUpdaterStatus {
        let profiles = app_state.profile_manager.get_profiles();
        let total_managed_profiles = profiles.len();
        let eligible_profiles_count = profiles
            .iter()
            .filter(|p| p.profile_type == ProfileType::Remote && p.auto_update_interval_mins > 0)
            .count();

        AutoUpdaterStatus {
            running: self.running.load(Ordering::Relaxed),
            auto_update_enabled: true,
            check_interval_secs: 60,
            last_check_timestamp: self.last_check_timestamp.load(Ordering::Relaxed),
            total_managed_profiles,
            eligible_profiles_count,
        }
    }

    /// Checks all eligible remote subscriptions and updates any that have reached their update interval.
    pub async fn check_and_update_eligible_profiles(
        app_handle: &AppHandle,
        app_state: &AppState,
    ) -> Vec<AutoUpdateEventPayload> {
        let profiles = app_state.profile_manager.get_profiles();
        let now = current_unix_timestamp();
        let mut results = Vec::new();

        for profile in profiles {
            // Only remote profiles with interval > 0 are eligible
            if profile.profile_type != ProfileType::Remote || profile.auto_update_interval_mins == 0 {
                continue;
            }

            let elapsed_secs = now.saturating_sub(profile.last_updated_at);
            let threshold_secs = (profile.auto_update_interval_mins as u64) * 60;

            if elapsed_secs >= threshold_secs {
                info!(
                    "Profile '{}' (ID: {}) is due for auto-update (elapsed: {}s, threshold: {}s)",
                    profile.name, profile.id, elapsed_secs, threshold_secs
                );

                let prev_count = profile.node_count;
                match app_state.profile_manager.update_profile(&profile.id).await {
                    Ok(updated_profile) => {
                        let new_count = updated_profile.node_count;

                        // Perform node drift safety guard inspection
                        let mappings = app_state.port_router.get_port_mappings();
                        let drift_reports = DriftGuard::check_all(&mappings, &app_state.profile_manager);

                        let drifted_count = drift_reports
                            .iter()
                            .filter(|r| r.profile_id == profile.id && r.status != DriftStatus::Healthy)
                            .count();

                        if drifted_count > 0 {
                            warn!(
                                "[Node Drift Guard] Detected {} drifted port mappings after auto-updating profile '{}'",
                                drifted_count, profile.name
                            );
                        }

                        // Hot-reload runtime config
                        if let Err(err) = app_state.sync_runtime_config().await {
                            error!("Failed to sync runtime config after auto-update: {}", err);
                        }

                        let payload = AutoUpdateEventPayload {
                            profile_id: profile.id.clone(),
                            profile_name: profile.name.clone(),
                            success: true,
                            previous_node_count: prev_count,
                            new_node_count: new_count,
                            drifted_ports_count: drifted_count,
                            timestamp: now,
                            error: None,
                        };

                        let _ = app_handle.emit("profile-auto-updated", &payload);

                        if drifted_count > 0 {
                            let _ = app_handle.emit("node-drift-detected", &drift_reports);
                        }

                        info!(
                            "Auto-updated profile '{}' successfully. Nodes: {} -> {}",
                            profile.name, prev_count, new_count
                        );

                        results.push(payload);
                    }
                    Err(err) => {
                        warn!(
                            "Failed to auto-update profile '{}' (ID: {}): {}",
                            profile.name, profile.id, err
                        );

                        let payload = AutoUpdateEventPayload {
                            profile_id: profile.id.clone(),
                            profile_name: profile.name.clone(),
                            success: false,
                            previous_node_count: prev_count,
                            new_node_count: prev_count,
                            drifted_ports_count: 0,
                            timestamp: now,
                            error: Some(err.to_string()),
                        };

                        let _ = app_handle.emit("profile-update-failed", &payload);
                        results.push(payload);
                    }
                }
            }
        }

        results
    }
}

impl Default for AutoUpdater {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn test_auto_updater_lifecycle() {
        let updater = AutoUpdater::new();
        assert!(!updater.running.load(Ordering::Relaxed));
        assert_eq!(updater.last_check_timestamp.load(Ordering::Relaxed), 0);

        updater.stop();
        assert!(!updater.running.load(Ordering::Relaxed));
    }

    #[test]
    fn test_auto_updater_status_calculation() {
        let temp_dir = std::env::temp_dir().join(format!("mihomo_test_autoupdater_{}", Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).expect("Create temp dir");

        let app_state = AppState::new(temp_dir.clone());
        let updater = AutoUpdater::new();

        let status = updater.get_status(&app_state);
        assert!(!status.running);
        assert!(status.auto_update_enabled);
        assert_eq!(status.check_interval_secs, 60);
        assert_eq!(status.total_managed_profiles, 0);
        assert_eq!(status.eligible_profiles_count, 0);

        // Add a local profile (not eligible for remote auto update)
        let yaml = "proxies:\n  - name: 'Test'\n    type: ss\n    server: 1.1.1.1\n    port: 8388\n";
        let source_file = temp_dir.join("local.yaml");
        std::fs::write(&source_file, yaml).expect("Write source yaml");

        let _ = app_state
            .profile_manager
            .add_local_profile("Local".to_string(), source_file.to_string_lossy().to_string());

        let status2 = updater.get_status(&app_state);
        assert_eq!(status2.total_managed_profiles, 1);
        assert_eq!(status2.eligible_profiles_count, 0); // Local is not eligible

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
