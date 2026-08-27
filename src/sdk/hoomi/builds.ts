import { HoomiApiClient, requireHoomiClient } from "./client.js";
import { appendFile, appendRepeated, appendText } from "./form-data.js";
import type { HoomiFormField } from "./client.js";
import type { ApiEnvelope, Build, HoomiFile } from "./types.js";
import { unwrap } from "./types.js";

export interface CreateBuildInput {
  appLang: string;
  appVersion: string;
  appUrl: string;
  appCallbackUrl?: string;
  appPermissions?: number[];
  appDomains?: string[];
  appIpWhitelist?: string[];
  appDemoEmail?: string;
  appDemoPassword?: string;
  appPreviews?: HoomiFile[];
}

export type UpdateBuildInput = CreateBuildInput;

function buildFormFields(input: CreateBuildInput): HoomiFormField[] {
  const fields: HoomiFormField[] = [];
  appendText(fields, "app_lang", input.appLang);
  appendText(fields, "app_version", input.appVersion);
  appendText(fields, "app_url", input.appUrl);
  appendText(fields, "app_callback_url", input.appCallbackUrl);
  appendRepeated(fields, "app_permissions", (input.appPermissions ?? []).map(String));
  appendText(fields, "app_domains", input.appDomains?.join(", "));
  appendText(fields, "app_ip_whitelist", input.appIpWhitelist?.join(", "));
  appendText(fields, "app_demo_email", input.appDemoEmail);
  appendText(fields, "app_demo_password", input.appDemoPassword);
  for (const preview of input.appPreviews ?? []) {
    appendFile(fields, "app_previews", preview);
  }

  return fields;
}

export class BuildsSdk {
  constructor(private readonly client: HoomiApiClient | undefined) {}

  async submitForReview(entityId: number, appId: number, buildId: number): Promise<Build> {
    const response = await requireHoomiClient(this.client).post<ApiEnvelope<Build>>(
      `/v2/partners/entity/${entityId}/apps/${appId}/builds/${buildId}/submit-for-review`
    );
    return unwrap<Build>(response);
  }

  async markReadyToRelease(entityId: number, appId: number, buildId: number): Promise<Build> {
    const response = await requireHoomiClient(this.client).post<ApiEnvelope<Build>>(
      `/v2/partners/entity/${entityId}/apps/${appId}/builds/${buildId}/ready-to-release`
    );
    return unwrap<Build>(response);
  }

  async create(entityId: number, appId: number, input: CreateBuildInput): Promise<Build> {
    const response = await requireHoomiClient(this.client).postForm<ApiEnvelope<Build>>(
      `/v2/partners/entity/${entityId}/apps/${appId}/builds`,
      buildFormFields(input)
    );
    return unwrap<Build>(response);
  }

  async get(entityId: number, appId: number, buildId: number): Promise<Build> {
    const response = await requireHoomiClient(this.client).get<ApiEnvelope<Build>>(
      `/v2/partners/entity/${entityId}/apps/${appId}/builds/${buildId}`
    );
    return unwrap<Build>(response);
  }

  async update(entityId: number, appId: number, buildId: number, input: UpdateBuildInput): Promise<Build> {
    const response = await requireHoomiClient(this.client).putForm<ApiEnvelope<Build>>(
      `/v2/partners/entity/${entityId}/apps/${appId}/builds/${buildId}`,
      buildFormFields(input)
    );
    return unwrap<Build>(response);
  }

  async delete(entityId: number, appId: number, buildId: number): Promise<ApiEnvelope<unknown>> {
    return requireHoomiClient(this.client).delete<ApiEnvelope<unknown>>(
      `/v2/partners/entity/${entityId}/apps/${appId}/builds/${buildId}`
    );
  }
}
