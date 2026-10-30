fn main() {
    tauri_build::build();

    // dev 模式运行的是裸二进制：把 Info.plist 嵌进 __TEXT,__info_plist，
    // 让 AppKit（访达对话框）也能识别本地化语言。
    #[cfg(target_os = "macos")]
    {
        let manifest = std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR");
        let plist = format!("{manifest}/embedded-Info.plist");
        println!("cargo:rustc-link-arg=-Wl,-sectcreate,__TEXT,__info_plist,{plist}");
        println!("cargo:rerun-if-changed={plist}");
    }
}
