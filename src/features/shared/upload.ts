import { HoomiApiError } from "../../sdk/hoomi/client.js";
import type { HoomiFile } from "../../sdk/hoomi/index.js";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_BASE64_LENGTH = Math.ceil(MAX_UPLOAD_BYTES / 3) * 4 + 4;

export const uploadContentTypes = ["image/gif", "image/jpeg", "image/png", "image/webp"] as const;

export interface EncodedUpload {
  filename: string;
  content_type: (typeof uploadContentTypes)[number];
  data_base64: string;
}

export function decodeUpload(input: EncodedUpload): HoomiFile {
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(input.filename)) {
    throw new HoomiApiError("invalid_upload", "Upload filename contains unsupported characters");
  }

  if (input.data_base64.length === 0 || input.data_base64.length > MAX_BASE64_LENGTH) {
    throw new HoomiApiError("invalid_upload", "Upload exceeds the configured size limit");
  }

  const data = Buffer.from(input.data_base64, "base64");
  if (data.length === 0 || data.length > MAX_UPLOAD_BYTES || data.toString("base64") !== input.data_base64) {
    throw new HoomiApiError("invalid_upload", "Upload data must be valid base64 within the configured size limit");
  }

  return {
    data: new Uint8Array(data),
    filename: input.filename,
    contentType: input.content_type
  };
}
