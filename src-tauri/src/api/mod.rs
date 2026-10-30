pub mod http;

#[tauri::command]
pub async fn http_request(spec: http::HttpRequestSpec) -> Result<http::HttpResponseData, String> {
    http::execute(spec).await
}
