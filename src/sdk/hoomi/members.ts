import { HoomiApiClient, requireHoomiClient } from "./client.js";
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
    return requireHoomiClient(this.client).delete<ApiEnvelope<unknown>>(
      `/v2/partners/entity/${entityId}/apps/${appId}/members/${memberId}`
    );
  }
}
