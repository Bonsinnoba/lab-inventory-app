//! Positive authority comes only from this native exchange, never IPC claims.
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
pub struct AuthError { pub code: &'static str, pub message: String }
impl AuthError {
    pub fn invalid(message: &str) -> Self { Self { code: "AUTH_REJECTED", message: message.into() } }
    fn unavailable() -> Self { Self { code: "AUTH_UNAVAILABLE", message: "LabOS authentication is temporarily unavailable".into() } }
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ServerUser {
    pub id: String, pub username: String, pub role: String,
    pub display_name: Option<String>, pub email: Option<String>,
    pub is_active: Option<bool>, pub created_at: Option<String>,
}
impl ServerUser {
    fn validate(&self) -> Result<(), AuthError> {
        if uuid::Uuid::parse_str(&self.id).is_err() || self.username.trim().is_empty()
            || !["admin", "member", "researcher", "technician", "viewer"].contains(&self.role.as_str())
            || self.is_active == Some(false) {
            return Err(AuthError::invalid("Invalid server authorization identity"));
        }
        Ok(())
    }
}
#[derive(Deserialize)]
struct LoginResponse { user: ServerUser, token: String }
#[derive(Deserialize)]
struct Permission { permission: String, effective: bool }
#[derive(Deserialize)]
struct PermissionResponse { user: ServerUser, permissions: Vec<Permission> }

pub struct VerifiedLogin { pub user: ServerUser, pub token: String, pub permissions: Vec<String> }
pub struct VerifiedPermissions { pub user: ServerUser, pub permissions: Vec<String> }

pub fn trusted_base() -> Result<String, AuthError> {
    validate_base(option_env!("LABOS_NATIVE_API_BASE").unwrap_or("http://localhost:4000/api"))
}
fn validate_base(raw: &str) -> Result<String, AuthError> {
    let url = reqwest::Url::parse(raw).map_err(|_| AuthError::invalid("Invalid native API configuration"))?;
    let loopback = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if !(url.scheme() == "https" || (url.scheme() == "http" && loopback))
        || !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some() {
        return Err(AuthError::invalid("Native authentication requires HTTPS or loopback HTTP"));
    }
    Ok(raw.trim_end_matches('/').to_owned())
}
pub(crate) fn client() -> Result<reqwest::Client, AuthError> {
    reqwest::Client::builder().timeout(std::time::Duration::from_secs(5))
        .redirect(reqwest::redirect::Policy::none()).no_proxy().build()
        .map_err(|_| AuthError::invalid("Unable to initialize native authentication"))
}
pub(crate) async fn response_json<T: serde::de::DeserializeOwned>(mut response: reqwest::Response) -> Result<T, AuthError> {
    let status = response.status();
    if status.is_server_error() { return Err(AuthError::unavailable()); }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| AuthError::invalid("Incomplete server authorization response"))? {
        if bytes.len() + chunk.len() > 65536 { return Err(AuthError::invalid("Server authorization response is too large")); }
        bytes.extend_from_slice(&chunk);
    }
    if status.as_u16() == 401 {
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap_or_default();
        if matches!(body["error"]["code"].as_str(), Some("SESSION_REVOKED" | "ACCOUNT_DISABLED")) {
            return Err(AuthError {code: "AUTH_REVOKED", message: "Cached access was revoked. Sign in again online.".into()});
        }
    }
    if !status.is_success() { return Err(AuthError::invalid("Server rejected authentication. Check credentials and account access.")); }
    serde_json::from_slice(&bytes).map_err(|_| AuthError::invalid("Malformed server authorization response"))
}

async fn permissions_with(client: &reqwest::Client, base: &str, token: &str, expected: &str) -> Result<VerifiedPermissions, AuthError> {
    if token.is_empty() || token.starts_with("local:") { return Err(AuthError::invalid("Online authentication is required")); }
    let response = client.get(format!("{base}/auth/me/permissions")).bearer_auth(token).send().await
        .map_err(|_| AuthError::unavailable())?;
    let body: PermissionResponse = response_json(response).await?;
    body.user.validate()?;
    if body.user.id != expected { return Err(AuthError::invalid("Server authorization belongs to another account")); }
    if body.permissions.iter().any(|p| p.permission.is_empty() || p.permission.len() > 128) {
        return Err(AuthError::invalid("Invalid server permission list"));
    }
    let mut permissions: Vec<String> = body.permissions.into_iter().filter(|p| p.effective).map(|p| p.permission).collect();
    permissions.sort(); permissions.dedup();
    Ok(VerifiedPermissions { user: body.user, permissions })
}
pub async fn permissions(token: &str, expected: &str) -> Result<VerifiedPermissions, AuthError> {
    permissions_with(&client()?, &trusted_base()?, token, expected).await
}
pub async fn login(username: &str, password: &str) -> Result<VerifiedLogin, AuthError> {
    login_at(&trusted_base()?, username, password).await
}
async fn login_at(base: &str, username: &str, password: &str) -> Result<VerifiedLogin, AuthError> {
    let client = client()?;
    let response = client.post(format!("{base}/auth/login"))
        .json(&serde_json::json!({"username": username, "password": password})).send().await
        .map_err(|_| AuthError::unavailable())?;
    let mut body: LoginResponse = response_json(response).await?;
    body.user.validate()?;
    if body.user.username != username.trim() { return Err(AuthError::invalid("Server returned another username")); }
    // After password success, fail closed: a permission failure must not restore
    // potentially stale cached grants through the initial-login outage fallback.
    let verified = permissions_with(&client, base, &body.token, &body.user.id).await
        .map_err(|_| AuthError::invalid("Could not verify current server permissions. Try online sign-in again."))?;
    body.user.role = verified.user.role;
    Ok(VerifiedLogin { user: body.user, token: body.token, permissions: verified.permissions })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read,Write};

    fn server(responses:Vec<(u16,serde_json::Value)>)->(String,std::thread::JoinHandle<()>) {
        let listener=std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base=format!("http://{}/api",listener.local_addr().unwrap());
        let handle=std::thread::spawn(move||{
            for (status,body) in responses {
                let (mut stream,_)=listener.accept().unwrap();
                stream.set_read_timeout(Some(std::time::Duration::from_secs(5))).unwrap();
                let mut request=Vec::new();let mut buf=[0u8;1024];
                loop {let n=stream.read(&mut buf).unwrap();if n==0{break}request.extend_from_slice(&buf[..n]);if request.windows(4).any(|w|w==b"\r\n\r\n"){break}}
                let body=body.to_string();
                write!(stream,"HTTP/1.1 {status} Fixture\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).unwrap();
            }
        });
        (base,handle)
    }
    fn user()->serde_json::Value {serde_json::json!({"id":"ef326109-578b-4e04-b6e5-350c27cd73cb","username":"fixture","role":"member","is_active":true})}

    #[test]
    fn native_exchange_uses_only_server_identity_and_effective_permissions(){
        let (base,server)=server(vec![(200,serde_json::json!({"user":user(),"token":"server-token"})),
            (200,serde_json::json!({"user":user(),"permissions":[{"permission":"notes.view","effective":true},{"permission":"users.edit","effective":false}]}))]);
        let result=tauri::async_runtime::block_on(login_at(&base,"fixture","fixture-password")).unwrap();server.join().unwrap();
        assert_eq!(result.user.role,"member");assert_eq!(result.permissions,vec!["notes.view"]);
    }
    #[test]
    fn rejection_malformed_and_post_login_failure_never_allow_offline_fallback(){
        for (status,body) in [(401,serde_json::json!({"error":"denied"})),(302,serde_json::json!({})),(200,serde_json::json!({"token":"missing-user"}))] {
            let (base,server)=server(vec![(status,body)]);
            let result=tauri::async_runtime::block_on(login_at(&base,"fixture","fixture-password"));server.join().unwrap();
            assert_eq!(result.err().unwrap().code,"AUTH_REJECTED");
        }
        let (base,server)=server(vec![(200,serde_json::json!({"user":user(),"token":"jwt"})),(503,serde_json::json!({}))]);
        assert_eq!(tauri::async_runtime::block_on(login_at(&base,"fixture","fixture-password")).err().unwrap().code,"AUTH_REJECTED");server.join().unwrap();
    }
    #[test]
    fn unavailable_login_is_distinct_from_foreign_permission_identity(){
        let (base,server)=server(vec![(503,serde_json::json!({}))]);
        assert_eq!(tauri::async_runtime::block_on(login_at(&base,"fixture","fixture-password")).err().unwrap().code,"AUTH_UNAVAILABLE");server.join().unwrap();
        let mut foreign=user();foreign["id"]=serde_json::json!(uuid::Uuid::new_v4().to_string());
        let (base,server)=self::server(vec![(200,serde_json::json!({"user":user(),"token":"jwt"})),(200,serde_json::json!({"user":foreign,"permissions":[]}))]);
        assert_eq!(tauri::async_runtime::block_on(login_at(&base,"fixture","fixture-password")).err().unwrap().code,"AUTH_REJECTED");server.join().unwrap();
    }
    #[test]
    fn native_origin_cannot_be_renderer_selected_or_insecure_remote() {
        for value in ["http://example.com/api", "file:///tmp/auth", "https://user:pass@example.com/api", "https://example.com/api?token=x", "https://example.com/api#x"] {
            assert!(validate_base(value).is_err());
        }
        assert_eq!(validate_base("http://localhost:4000/api/").unwrap(), "http://localhost:4000/api");
        assert!(validate_base("https://lab.example/api").is_ok());
    }
}
