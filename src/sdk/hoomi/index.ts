import type { HoomiApiClient } from "./client.js";
import { AccountSdk } from "./account.js";
import { BuildsSdk } from "./builds.js";
import { MembersSdk } from "./members.js";
import { MicroAppsSdk } from "./micro-apps.js";

export class HoomiSdk {
  readonly account: AccountSdk;
  readonly microApps: MicroAppsSdk;
  readonly members: MembersSdk;
  readonly builds: BuildsSdk;

  constructor(client: HoomiApiClient | undefined) {
    this.account = new AccountSdk(client);
    this.microApps = new MicroAppsSdk(client);
    this.members = new MembersSdk(client);
    this.builds = new BuildsSdk(client);
  }
}

export type { HoomiApiClient, HoomiApiError, HoomiFormField } from "./client.js";
export type {
  ApiEnvelope,
  AppSecretRotation,
  AppMember,
  Build,
  BuildSubmissions,
  BuildSubmission,
  HoomiFile,
  MicroApp,
  MicroAppDetail,
  MicroAppLanguage,
  MicroAppSummary,
  Profile,
  Review,
  SubmissionLog,
  Workspace
} from "./types.js";
