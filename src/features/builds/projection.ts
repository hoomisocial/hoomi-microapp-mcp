import type { Build, BuildSubmission, SubmissionLog } from "../../sdk/hoomi/index.js";

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

export function sanitizeBuild(value: Build | undefined): Record<string, unknown> | null {
  if (!value) {
    return null;
  }

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

export function sanitizeBuildSubmissions(value: {
  submissions?: BuildSubmission[];
  submission_logs?: SubmissionLog[];
}): Record<string, unknown> {
  return {
    submissions: (value.submissions ?? []).map(sanitizeSubmission),
    submission_logs: (value.submission_logs ?? []).map(sanitizeSubmissionLog)
  };
}
