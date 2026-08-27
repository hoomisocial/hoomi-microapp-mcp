import { HoomiApiClient, requireHoomiClient } from "./client.js";
import type { ApiEnvelope, MicroAppSummary } from "./types.js";
import { unwrap } from "./types.js";

export class MicroAppsSdk {
  constructor(private readonly client: HoomiApiClient | undefined) {}

  async listLanguages(): Promise<unknown> {
    return unwrap(await requireHoomiClient(this.client).get<unknown>("/v2/micro-apps/languages"));
  }

  async listCategories(): Promise<unknown> {
    return unwrap(await requireHoomiClient(this.client).get<unknown>("/v2/micro-apps/categories"));
  }

  async listCountries(): Promise<unknown> {
    return unwrap(await requireHoomiClient(this.client).get<unknown>("/v2/micro-apps/countries"));
  }

  async listPermissions(): Promise<unknown> {
    return unwrap(await requireHoomiClient(this.client).get<unknown>("/v2/micro-apps/permissions"));
  }

  async listPermissionStrings(): Promise<unknown> {
    return unwrap(await requireHoomiClient(this.client).get<unknown>("/v2/micro-apps/permissions/strings"));
  }

  async search(query: string | undefined, page: number): Promise<unknown> {
    const response = await requireHoomiClient(this.client).get<unknown>("/v2/micro-apps/search", {
      q: query || undefined,
      page
    });
    return unwrap(response);
  }

  async listWorkspaceApps(entityId: number): Promise<MicroAppSummary[]> {
    const response = await requireHoomiClient(this.client).get<ApiEnvelope<MicroAppSummary[]>>(
      `/v2/partners/entity/${entityId}/apps`
    );
    return unwrap<MicroAppSummary[]>(response) ?? [];
  }
}
