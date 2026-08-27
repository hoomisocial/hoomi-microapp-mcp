import { HoomiApiClient, requireHoomiClient } from "./client.js";
import { appendFile, appendRepeated, appendText } from "./form-data.js";
import type { HoomiFormField } from "./client.js";
import type { ApiEnvelope, HoomiFile, MicroApp, MicroAppSummary } from "./types.js";
import { unwrap } from "./types.js";

export interface CreateMicroAppInput {
  appType: string;
  appName: string;
  appBundle: string;
  appDefaultLanguage: string;
  appCategoryId: number;
  appAgeRatingsId: number;
  appDescription?: string;
  appTagline?: string;
  appPrivacyUrl?: string;
  appTncUrl?: string;
  marketingUrl?: string;
  appAllowedCountries?: string[];
  csPhone?: string;
  csEmail?: string;
  appLogo?: HoomiFile;
}

export interface UpdateMicroAppInput {
  appType: string;
  appBundle: string;
  appDefaultLanguage: string;
  appCategoryId: number;
  appAgeRatingsId: number;
  appPrivacyUrl?: string;
  appTncUrl?: string;
  marketingUrl?: string;
  appAllowedCountries?: string[];
  csPhone?: string;
  csEmail?: string;
  status?: "published" | "unpublished";
  appLanguages: string[];
  appNames: string[];
  appDescriptions: string[];
  appTaglines: string[];
  localizedLogos?: Array<{ language: string; file: HoomiFile }>;
}

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

  async create(entityId: number, input: CreateMicroAppInput): Promise<MicroApp> {
    const fields: HoomiFormField[] = [];
    appendText(fields, "app_type", input.appType);
    appendText(fields, "app_name", input.appName);
    appendText(fields, "app_bundle", input.appBundle);
    appendText(fields, "app_default_language", input.appDefaultLanguage);
    appendText(fields, "app_category_id", String(input.appCategoryId));
    appendText(fields, "app_age_ratings_id", String(input.appAgeRatingsId));
    appendText(fields, "app_description", input.appDescription);
    appendText(fields, "app_tagline", input.appTagline);
    appendText(fields, "app_privacy_url", input.appPrivacyUrl);
    appendText(fields, "app_tnc_url", input.appTncUrl);
    appendText(fields, "marketing_url", input.marketingUrl);
    appendRepeated(fields, "app_allowed_countries", input.appAllowedCountries);
    appendText(fields, "cs_phone", input.csPhone);
    appendText(fields, "cs_email", input.csEmail);
    appendFile(fields, "app_logo", input.appLogo);

    const response = await requireHoomiClient(this.client).postForm<ApiEnvelope<MicroApp>>(
      `/v2/partners/entity/${entityId}/apps`,
      fields
    );
    return unwrap<MicroApp>(response);
  }

  async update(entityId: number, appId: number, input: UpdateMicroAppInput): Promise<MicroApp> {
    const fields: HoomiFormField[] = [];
    appendText(fields, "app_type", input.appType);
    appendText(fields, "app_bundle", input.appBundle);
    appendText(fields, "app_default_language", input.appDefaultLanguage);
    appendText(fields, "app_category_id", String(input.appCategoryId));
    appendText(fields, "app_age_ratings_id", String(input.appAgeRatingsId));
    appendText(fields, "app_privacy_url", input.appPrivacyUrl);
    appendText(fields, "app_tnc_url", input.appTncUrl);
    appendText(fields, "marketing_url", input.marketingUrl);
    appendRepeated(fields, "app_allowed_countries", input.appAllowedCountries);
    appendText(fields, "cs_phone", input.csPhone);
    appendText(fields, "cs_email", input.csEmail);
    appendText(fields, "status", input.status);
    appendRepeated(fields, "app_lang", input.appLanguages);
    appendRepeated(fields, "app_name", input.appNames);
    appendRepeated(fields, "app_description", input.appDescriptions);
    appendRepeated(fields, "app_tagline", input.appTaglines);
    for (const logo of input.localizedLogos ?? []) {
      appendFile(fields, `app_logo_${logo.language}`, logo.file);
    }

    const response = await requireHoomiClient(this.client).putForm<ApiEnvelope<MicroApp>>(
      `/v2/partners/entity/${entityId}/apps/${appId}`,
      fields
    );
    return unwrap<MicroApp>(response);
  }
}
