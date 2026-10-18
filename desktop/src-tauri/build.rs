use std::path::PathBuf;

mod build_support;

fn decode_base64(input: &str) -> Result<Vec<u8>, String> {
    let mut table = [255u8; 256];
    for (index, byte) in b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".iter().enumerate() {
        table[*byte as usize] = index as u8;
    }

    let bytes = input.bytes().filter(|byte| !byte.is_ascii_whitespace()).collect::<Vec<_>>();
    if bytes.len() % 4 != 0 {
        return Err("invalid base64 length".into());
    }

    let mut output = Vec::with_capacity(bytes.len() / 4 * 3);
    for chunk in bytes.chunks(4) {
        let a = table[chunk[0] as usize];
        let b = table[chunk[1] as usize];
        if a == 255 || b == 255 {
            return Err("invalid base64 character".into());
        }

        let c = if chunk[2] == b'=' { 0 } else { table[chunk[2] as usize] };
        let d = if chunk[3] == b'=' { 0 } else { table[chunk[3] as usize] };
        if (chunk[2] != b'=' && c == 255) || (chunk[3] != b'=' && d == 255) {
            return Err("invalid base64 character".into());
        }

        output.push((a << 2) | (b >> 4));
        if chunk[2] != b'=' {
            output.push((b << 4) | (c >> 2));
        }
        if chunk[3] != b'=' {
            output.push((c << 6) | d);
        }
    }

    Ok(output)
}

fn main() {
    println!("cargo:rerun-if-env-changed=LABOS_NATIVE_API_BASE");
    println!("cargo:rerun-if-changed=icons/icon.ico.b64");

    let icon_source = include_str!("icons/icon.ico.b64");
    let icon_bytes = decode_base64(icon_source).expect("invalid embedded LabOS icon");
    let icon_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("icons").join("icon.ico");

    // The dev watcher watches this asset. Rewriting identical bytes changes its
    // timestamp and can trigger another native build indefinitely.
    build_support::write_if_changed(&icon_path, &icon_bytes)
        .expect("failed to materialize LabOS icon");

    assert!(PathBuf::from(&icon_path).exists(), "LabOS icon was not created");
    assert!(PathBuf::from(&icon_path).is_file(), "LabOS icon path is not a file");

    tauri_build::build();
}
