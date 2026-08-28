import { HoomiApiClient, requireHoomiClient, requireSuccessEnvelope } from "./client.js";
import type { ApiEnvelope, AppMember } from "./types.js";
import { unwrap } from "./types.js";

export interface AddAppMemberInput {
  email: string;
  roleId: number;
}

export class MembersSdk {
  constructor(private readonly client: HoomiApiClient | undefined) {}

  async addAppMember(entityId: number, appId: number, input: AddAppMemberInput): Promise<AppMember> {
    const response = await requireHoomiClient(this.client).postJson<ApiEnvelope<AppMember>>(
      `/v2/partners/entity/${entityId}/apps/${appId}/members`,
      { email: input.email, role_id: input.roleId }
    );
    return unwrap<AppMember>(response);
  }

  async removeAppMember(entityId: number, appId: number, memberId: number): Promise<ApiEnvelope<unknown>> {
    const response = await requireHoomiClient(this.client).delete<ApiEnvelope<unknown>>(
      `/v2/partners/entity/${entityId}/apps/${appId}/members/${memberId}`
    );
    return requireSuccessEnvelope(response);
  }

  async updateAppMemberRole(
    entityId: number,
    appId: number,
    memberId: number,
    input: { roleId: number }
  ): Promise<AppMember> {
    const response = await requireHoomiClient(this.client).putJson<ApiEnvelope<AppMember>>(
      `/v2/partners/entity/${entityId}/apps/${appId}/members/${memberId}`,
      { role_id: input.roleId }
    );
    return unwrap<AppMember>(response);
  }
}
