import type { MicroApp } from "../../sdk/hoomi/index.js";

export function sanitizeMicroApp(app: MicroApp | undefined): Record<string, unknown> {
  return {
    id: app?.id ?? null,
    partner_id: app?.partner_id ?? null,
    app_secret_expiry: app?.app_secret_expiry ?? null,
    app_type: app?.app_type ?? null,
    app_bundle: app?.app_bundle ?? null,
    app_default_language: app?.app_default_language ?? null,
    app_category_id: app?.app_category_id ?? null,
    app_category_name: app?.app_category_name ?? null,
    app_age_ratings_id: app?.app_age_ratings_id ?? null,
    app_privacy_url: app?.app_privacy_url ?? null,
    app_tnc_url: app?.app_tnc_url ?? null,
    marketing_url: app?.marketing_url ?? null,
    app_allowed_countries: app?.app_allowed_countries ?? [],
    cs_phone: app?.cs_phone ?? null,
    cs_email: app?.cs_email ?? null,
    app_name: app?.app_name ?? null,
    app_description: app?.app_description ?? null,
    app_tagline: app?.app_tagline ?? null,
    app_logo: app?.app_logo ?? null,
    status: app?.status ?? null,
    created_by_username: app?.created_by_username ?? null,
    created_at: app?.created_at ?? null,
    updated_at: app?.updated_at ?? null
  };
}
