use crate::core::supervisor::CoreSupervisor;
use crate::models::AppConfig;
use parking_lot::RwLock;
use std::path::PathBuf;
use std::sync::Arc;

pub struct AppState {
    pub supervisor: CoreSupervisor,
    pub config: Arc<RwLock<AppConfig>>,
    pub app_dir: PathBuf,
}

impl AppState {
    pub fn new(app_dir: PathBuf) -> Self {
        let work_dir = app_dir.join("core");
        let supervisor = CoreSupervisor::new(work_dir);
        let config = Arc::new(RwLock::new(AppConfig::default()));

        Self {
            supervisor,
            config,
            app_dir,
        }
    }
}
