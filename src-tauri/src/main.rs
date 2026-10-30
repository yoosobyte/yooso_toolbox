// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// dev 模式没有 .app 本地化，系统对话框（访达）默认英文；
/// 进程启动时把 AppleLanguages 设为中文，让 NSOpenPanel 用中文。
#[cfg(target_os = "macos")]
fn apply_macos_language() {
    use objc2_foundation::{NSArray, NSString, NSUserDefaults};
    unsafe {
        let defaults = NSUserDefaults::standardUserDefaults();
        let languages = NSArray::from_retained_slice(&[NSString::from_str("zh-Hans")]);
        defaults.setObject_forKey(Some(&languages), &NSString::from_str("AppleLanguages"));
    }
}

#[cfg(not(target_os = "macos"))]
fn apply_macos_language() {}

fn main() {
    apply_macos_language();
    yooso_toolbox_lib::run()
}
