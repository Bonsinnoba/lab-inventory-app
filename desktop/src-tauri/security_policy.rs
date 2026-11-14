use serde_json::{json, Value};
/// The same trusted-origin restriction used by native authorization. Never
/// interpolate a renderer setting or URL path into a CSP directive.
pub fn api_base(raw: &str) -> Result<String, String> {
    let url = url::Url::parse(raw).map_err(|_| "Invalid native API URL")?;
    let loopback = matches!(
        url.host_str(),
        Some("localhost" | "127.0.0.1" | "[::1]" | "::1")
    );
    if !matches!(url.scheme(), "http" | "https")
        || (url.scheme() == "http" && !loopback)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !url.path().trim_end_matches('/').ends_with("/api")
    {
        return Err(
            "CSP requires the same HTTPS or loopback-only /api URL as native authorization".into(),
        );
    }
    Ok(url.as_str().trim_end_matches('/').to_owned())
}
pub fn api_origin(raw: &str) -> Result<String, String> {
    let base = api_base(raw)?;
    Ok(url::Url::parse(&base)
        .map_err(|_| "Invalid native API URL")?
        .origin()
        .ascii_serialization())
}
pub fn csp(raw: &str) -> Result<String, String> {
    let origin = api_origin(raw)?;
    Ok(format!(
 "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' ipc: http://ipc.localhost https://ipc.localhost labos-file: http://labos-file.localhost https://labos-file.localhost asset: http://asset.localhost https://asset.localhost {origin}; img-src 'self' data: blob: labos-file: http://labos-file.localhost https://labos-file.localhost asset: http://asset.localhost https://asset.localhost {origin} https://img.youtube.com https://i.ytimg.com; media-src 'self' blob: data: labos-file: http://labos-file.localhost https://labos-file.localhost asset: http://asset.localhost https://asset.localhost {origin}; font-src 'self' data:; worker-src 'self' blob:; frame-src 'self' blob: https://www.youtube.com https://www.youtube-nocookie.com; object-src 'none'; base-uri 'none'; form-action 'none'"))
}
pub fn merged_config(existing: Option<&str>, raw: &str) -> Result<String, String> {
    let mut value: Value = match existing {
        Some(raw) => serde_json::from_str(raw).map_err(|_| "Invalid TAURI_CONFIG")?,
        None => json!({}),
    };
    if !value.is_object() {
        return Err("TAURI_CONFIG must be an object".into());
    }
    if value.get("tauri").is_some_and(|v| !v.is_object()) {
        return Err("Invalid Tauri configuration".into());
    }
    if value.get("tauri").is_none() {
        value["tauri"] = json!({});
    }
    if value["tauri"]
        .get("security")
        .is_some_and(|v| !v.is_object())
    {
        return Err("Invalid security configuration".into());
    }
    if value["tauri"].get("security").is_none() {
        value["tauri"]["security"] = json!({});
    }
    value["tauri"]["security"]["csp"] = json!(csp(raw)?);
    serde_json::to_string(&value).map_err(|e| e.to_string())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn build_identity_preserves_alias_port_and_api_prefix() {
        assert_eq!(api_base("https://LAB.EXAMPLE:443/team/api/").unwrap(), "https://lab.example/team/api");
        let approved = api_base("http://127.0.0.1:4000/api").unwrap();
        for other in ["http://localhost:4000/api", "http://127.0.0.1:4010/api", "http://127.0.0.1:4000/team/api"] {
            assert_ne!(approved, api_base(other).unwrap());
        }
    }
    #[test]
    fn policy_preserves_profile_and_pins_only_the_trusted_api_origin() {
        let config=merged_config(Some(r#"{"package":{"productName":"LabOS Preview"},"tauri":{"bundle":{"identifier":"preview"}}}"#),"https://lab.example:8443/api").unwrap();
        let v: Value = serde_json::from_str(&config).unwrap();
        assert_eq!(v["package"]["productName"], "LabOS Preview");
        assert_eq!(v["tauri"]["bundle"]["identifier"], "preview");
        let policy = v["tauri"]["security"]["csp"].as_str().unwrap();
        assert!(policy.contains("https://lab.example:8443;"));
        assert!(!policy.contains("'unsafe-eval'"));
        assert!(!policy.contains("script-src 'unsafe-inline'"));
        assert!(policy.contains("http://labos-file.localhost"));
        for directive in ["connect-src", "img-src", "media-src"] {
            let value=policy.split(';').find(|part|part.trim_start().starts_with(directive)).unwrap();
            assert!(value.contains("https://labos-file.localhost"), "Windows convertFileSrc origin missing from {directive}");
        }
        assert!(policy.contains("object-src 'none'"));
    }
    #[test]
    fn invalid_origins_cannot_broaden_the_policy() {
        for url in [
            "http://lab.example/api",
            "https://u:secret@lab.example/api",
            "https://lab.example/api?secret=yes",
            "https://lab.example/api#anything",
            "file:///api",
            "https://lab.example/root",
        ] {
            assert!(api_origin(url).is_err());
        }
        assert_eq!(
            api_origin("http://localhost:4010/api").unwrap(),
            "http://localhost:4010"
        );
        assert_eq!(
            api_origin("http://127.0.0.1:4000/api/").unwrap(),
            "http://127.0.0.1:4000"
        );
    }
}
