import { HoomiApiClient, requireHoomiClient } from "./client.js";
import type { ApiEnvelope, Profile, Workspace } from "./types.js";
import { unwrap } from "./types.js";

export class AccountSdk {
  constructor(private readonly client: HoomiApiClient | undefined) {}

  async getProfile(): Promise<Profile> {
    const response = await requireHoomiClient(this.client).get<ApiEnvelope<Profile>>("/v2/profile");
    return unwrap<Profile>(response);
  }

  async listWorkspaces(): Promise<Workspace[]> {
    const response = await requireHoomiClient(this.client).get<ApiEnvelope<Workspace[]>>(
      "/v2/partners/entity/me"
    );
    return unwrap<Workspace[]>(response) ?? [];
  }
}
