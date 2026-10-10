// Absent means a signed pre-migration token, never an unversioned bypass.
export function tokenCredentialVersion(claims) {
  const version = claims.credentialVersion === undefined ? 0 : claims.credentialVersion;
  return Number.isSafeInteger(version) && version >= 0 ? version : null;
}

export function credentialVersionMatches(claims, user) {
  const version = tokenCredentialVersion(claims);
  return version !== null && Number.isSafeInteger(user.credential_version)
    && version === user.credential_version;
}
