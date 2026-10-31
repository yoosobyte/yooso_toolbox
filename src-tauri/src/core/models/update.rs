use serde::Serialize;

/// 升级检查结果
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current: String,
    pub latest: String,
    /// 当前平台安装包直链（来自 update.json 的 mac / win 字段）
    pub url: String,
    pub has_update: bool,
    /// 更新说明（update.json 里的 desc 字段，换行已统一成 \n）
    pub notes: String,
}
