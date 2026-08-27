export interface ApiEnvelope<T> {
  data?: T;
  message?: string;
  success?: boolean;
}

export function unwrap<T>(value: unknown): T {
  if (typeof value === "object" && value !== null && "data" in value) {
    return (value as ApiEnvelope<T>).data as T;
  }

  return value as T;
}

export interface HoomiFile {
  data: Uint8Array;
  filename: string;
  contentType: string;
}

export interface Profile {
  id?: number;
  name?: string;
  username?: string;
  imgUrl?: string | null;
  emailVerified?: boolean;
  registration_date?: string;
}

export interface Workspace {
  id?: number;
  entity_type?: string;
  entity_name?: string;
  country?: string;
  entity_website?: string;
  entity_status?: string;
  my_role?: string;
  created_at?: string;
}

export interface MicroAppSummary {
  id?: number;
  app_id?: number;
  app_bundle?: string;
  app_name?: string;
  app_type?: string;
  app_category_id?: number;
  app_category_name?: string;
  status?: string;
  updated_at?: string;
}

export interface MicroAppLanguage {
  id?: number;
  app_lang?: string;
  app_name?: string;
  app_description?: string;
  app_tagline?: string;
  app_logo?: string | null;
}

export interface AppMember {
  member_id?: number;
  app_id?: number;
  user_id?: number;
  email?: string;
  username?: string;
  role_id?: number;
  role_name?: string;
  status?: string;
  created_at?: string;
}

export interface MicroApp {
  id?: number;
  partner_id?: number;
  app_secret?: string;
  app_secret_expiry?: string | null;
  app_type?: string;
  app_bundle?: string;
  app_default_language?: string;
  app_category_id?: number;
  app_category_name?: string;
  app_age_ratings_id?: number;
  app_privacy_url?: string;
  app_tnc_url?: string;
  marketing_url?: string;
  app_allowed_countries?: string[];
  cs_phone?: string;
  cs_email?: string;
  app_name?: string;
  app_description?: string;
  app_tagline?: string;
  app_logo?: string | null;
  status?: string;
  created_by_username?: string;
  created_at?: string;
  updated_at?: string;
  lang_strings?: MicroAppLanguage[];
  granted_member_ids?: AppMember[];
}

export interface MicroAppDetail {
  micro_apps?: MicroApp;
  builds?: Build[];
  reviews?: Review[];
}

export interface AppSecretRotation {
  app_id?: number;
  app_secret?: string;
  app_secret_expiry?: string | null;
}

export interface Build {
  id?: number;
  app_lang?: string;
  app_version?: string;
  app_url?: string;
  app_previews?: string[];
  app_callback_url?: string;
  app_permissions?: unknown[];
  app_domains?: string[];
  app_ip_whitelist?: string[];
  app_status?: string;
  submitted_date?: string | null;
  canceled_date?: string | null;
  distributed_date?: string | null;
  created_at?: string;
  submissions?: BuildSubmission[];
  submission_logs?: SubmissionLog[];
}

export interface BuildSubmission {
  id?: number;
  user_id?: number;
  username?: string;
  email?: string;
  app_review?: string;
  review_files?: string[] | null;
  created_at?: string;
}

export interface SubmissionLog {
  id?: number;
  activity?: string;
  user_id?: number;
  username?: string;
  email?: string;
  created_at?: string;
}

export interface Review {
  id?: number;
  user_id?: number;
  username?: string;
  email?: string;
  app_lang?: string;
  app_version?: string;
  ratings?: number;
  reviews?: string;
  created_at?: string;
}
