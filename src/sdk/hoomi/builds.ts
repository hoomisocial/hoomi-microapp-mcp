import { HoomiApiClient, requireHoomiClient } from "./client.js";
import type { ApiEnvelope, Build } from "./types.js";
import { unwrap } from "./types.js";

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
}
