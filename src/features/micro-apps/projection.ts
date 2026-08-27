import type { Build, BuildSubmission, MicroApp, MicroAppDetail, Review, SubmissionLog } from "../../sdk/hoomi/index.js";

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

function sanitizeSubmission(submission: BuildSubmission): Record<string, unknown> {
  return {
    id: submission.id ?? null,
    username: submission.username ?? null,
    app_review: submission.app_review ?? null,
    review_files: submission.review_files ?? null,
    created_at: submission.created_at ?? null
  };
}

function sanitizeSubmissionLog(log: SubmissionLog): Record<string, unknown> {
  return {
    id: log.id ?? null,
    activity: log.activity ?? null,
    username: log.username ?? null,
    created_at: log.created_at ?? null
  };
}

export function sanitizeBuild(value: Build): Record<string, unknown> {
  return {
    id: value.id ?? null,
    app_lang: value.app_lang ?? null,
    app_version: value.app_version ?? null,
    app_url: value.app_url ?? null,
    app_previews: value.app_previews ?? [],
    app_callback_url: value.app_callback_url ?? null,
    app_permissions: value.app_permissions ?? [],
    app_domains: value.app_domains ?? [],
    app_ip_whitelist: value.app_ip_whitelist ?? [],
    app_status: value.app_status ?? null,
    submitted_date: value.submitted_date ?? null,
    canceled_date: value.canceled_date ?? null,
    distributed_date: value.distributed_date ?? null,
    created_at: value.created_at ?? null,
    submissions: (value.submissions ?? []).map(sanitizeSubmission),
    submission_logs: (value.submission_logs ?? []).map(sanitizeSubmissionLog)
  };
}

function sanitizeReview(review: Review): Record<string, unknown> {
  return {
    id: review.id ?? null,
    username: review.username ?? null,
    app_lang: review.app_lang ?? null,
    app_version: review.app_version ?? null,
    ratings: review.ratings ?? null,
    reviews: review.reviews ?? null,
    created_at: review.created_at ?? null
  };
}

export function sanitizeMicroAppDetail(detail: MicroAppDetail): Record<string, unknown> {
  const app = detail.micro_apps;
  const sanitizedApp = sanitizeMicroApp(app);
  if (app) {
    sanitizedApp.lang_strings = (app.lang_strings ?? []).map((language) => ({
      id: language.id ?? null,
      app_lang: language.app_lang ?? null,
      app_name: language.app_name ?? null,
      app_description: language.app_description ?? null,
      app_tagline: language.app_tagline ?? null,
      app_logo: language.app_logo ?? null
    }));
    sanitizedApp.granted_members = (app.granted_member_ids ?? []).map((member) => ({
      member_id: member.member_id ?? null,
      username: member.username ?? null,
      role_id: member.role_id ?? null,
      role_name: member.role_name ?? null,
      status: member.status ?? null
    }));
  }

  return {
    micro_app: sanitizedApp,
    builds: (detail.builds ?? []).map(sanitizeBuild),
    reviews: (detail.reviews ?? []).map(sanitizeReview)
  };
}
