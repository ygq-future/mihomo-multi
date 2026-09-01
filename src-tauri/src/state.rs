use crate::core::profile_manager::ProfileManager;
use crate::core::supervisor::CoreSupervisor;
use crate::models::AppConfig;
use parking_lot::RwLock;
use std::path::PathBuf;
use std::sync::Arc;

pub struct AppState {
    pub supervisor: CoreSupervisor,
    pub profile_manager: Arc<ProfileManager>,
    pub config: Arc<RwLock<AppConfig>>,
    pub app_dir: PathBuf,
}

impl AppState {
    pub fn new(app_dir: PathBuf) -> Self {
        let work_dir = app_dir.join("core");
        let supervisor = CoreSupervisor::new(work_dir);
        let profile_manager = Arc::new(ProfileManager::new(app_dir.clone()));
        let config = Arc::new(RwLock::new(AppConfig::default()));

        Self {
            supervisor,
            profile_manager,
            config,
            app_dir,
        }
    }
}
