pub mod browser;
pub mod favicon;
pub mod http;
pub mod page;

#[tauri::command]
pub async fn http_request(spec: http::HttpRequestSpec) -> Result<http::HttpResponseData, String> {
    http::execute(spec).await
}

#[tauri::command]
pub async fn fetch_page_title(url: String) -> Result<Option<String>, String> {
    page::fetch_page_title(url).await
}
