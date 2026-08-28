const sensitiveAssignment =
  /\b((?:[a-z0-9]+[_-])*(?:secret|password|token|api[_-]?key|authorization|cookie))\b\s*[:=]\s*[^\s,;]+/gi;

export function redactSensitiveText(value: string, maxLength = 300): string {
  return value
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(sensitiveAssignment, "$1=[redacted]")
    .slice(0, maxLength);
}
