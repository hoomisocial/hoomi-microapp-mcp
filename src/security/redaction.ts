const sensitiveName =
  "(?:[a-z0-9]+[_-])*(?:app_?secret|client_?secret|private_?key|access_?token|refresh_?token|secret|password|token|api[_-]?key|authorization|cookie|signature|sig|jwt)";
const sensitiveAssignment = new RegExp(
  `([\"']?)\\b${sensitiveName}\\1\\s*[:=]\\s*([\"']?)([^\"'\\s,;}]+)\\2`,
  "gi"
);
const sensitiveQueryParameter =
  /([?&](?:[a-z0-9_-]*(?:token|secret|password|api[_-]?key|signature|sig|credential|authorization|cookie|jwt|code)[a-z0-9_-]*)=)[^&#\s"'<>]*/gi;
const credentialedUrl = /(\bhttps?:\/\/)[^/\s:@]+:[^@\s/]+@/gi;
const bearerToken = /\bBearer\s+[^\s,;}"']+/gi;
const jwt = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;

export function redactSensitiveText(value: string, maxLength = 300): string {
  return value
    .replace(credentialedUrl, "$1[redacted]@")
    .replace(bearerToken, "Bearer [redacted]")
    .replace(sensitiveQueryParameter, "$1[redacted]")
    .replace(sensitiveAssignment, "$1$2[redacted]$2")
    .replace(jwt, "[jwt redacted]")
    .slice(0, maxLength);
}
