export interface HoomiApiClientOptions {
  baseUrl: string;
  sessionToken?: string;
  timeoutMs: number;
  maxResponseBytes: number;
  fetchImpl?: typeof fetch;
}

export class HoomiApiError extends Error {
  readonly status: number | null;
  readonly code: string;

  constructor(code: string, message: string, status: number | null = null) {
    super(message);
    this.name = "HoomiApiError";
    this.status = status;
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorMessage(value: unknown): string | null {
  if (!isRecord(value) || typeof value.message !== "string") {
    return null;
  }

  return value.message.slice(0, 300);
}

async function readBody(response: Response, maxBytes: number): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new HoomiApiError("upstream_response_too_large", "Hoomi API response exceeded the configured size limit");
  }

  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        throw new HoomiApiError("upstream_response_too_large", "Hoomi API response exceeded the configured size limit");
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(body);
}

function parseBody(text: string): unknown {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text.slice(0, 300);
  }
}

export class HoomiApiClient {
  private readonly baseUrl: URL;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: HoomiApiClientOptions) {
    this.baseUrl = new URL(options.baseUrl);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async get<T>(path: string, query: Record<string, string | number | undefined> = {}): Promise<T> {
    const url = this.buildUrl(path, query);
    return this.request<T>(url, "GET");
  }

  async postJson<T>(path: string, body: unknown): Promise<T> {
    const url = this.buildUrl(path, {});
    return this.request<T>(url, "POST", JSON.stringify(body));
  }

  private buildUrl(path: string, query: Record<string, string | number | undefined>): URL {
    if (!path.startsWith("/v2/")) {
      throw new HoomiApiError("route_not_allowed", "Only Hoomi v2 API routes are allowed");
    }

    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    return url;
  }

  private async request<T>(url: URL, method: "GET" | "POST", requestBody?: string): Promise<T> {
    if (!this.options.sessionToken) {
      throw new HoomiApiError("session_required", "A validated Hoomi session is required for this tool");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);

    try {
      const headers: Record<string, string> = {
        Accept: "application/json",
        Authorization: `Bearer ${this.options.sessionToken}`
      };
      if (requestBody !== undefined) {
        headers["Content-Type"] = "application/json";
      }

      const response = await this.fetchImpl(url, {
        method,
        redirect: "error",
        headers,
        body: requestBody,
        signal: controller.signal
      });
      const text = await readBody(response, this.options.maxResponseBytes);
      const responseBody = parseBody(text);

      if (!response.ok) {
        if (response.status === 401) {
          throw new HoomiApiError("upstream_unauthorized", "Hoomi API rejected the current session", response.status);
        }

        throw new HoomiApiError(
          "upstream_request_failed",
          errorMessage(responseBody) ?? `Hoomi API returned HTTP ${response.status}`,
          response.status
        );
      }

      return responseBody as T;
    } catch (error) {
      if (error instanceof HoomiApiError) {
        throw error;
      }

      if (error instanceof DOMException && error.name === "AbortError") {
        throw new HoomiApiError("upstream_timeout", "Hoomi API request timed out");
      }

      throw new HoomiApiError("upstream_unavailable", "Hoomi API could not be reached");
    } finally {
      clearTimeout(timeout);
    }
  }
}
