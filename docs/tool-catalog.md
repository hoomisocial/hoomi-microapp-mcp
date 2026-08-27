# MCP Tool Catalog

All tools run behind the authenticated `POST /mcp` endpoint. The request's Hoomi session JWT is verified before a tool is dispatched. Tool handlers use a server-owned Hoomi API client; models never supply URLs, authorization headers, cookies, or credentials.

## Read Tools

- `hoomi_get_profile` — basic authenticated profile projection
- `hoomi_list_workspaces` — the user's partner workspaces
- `hoomi_list_workspace_apps` — apps in a member workspace
- `hoomi_list_partner_apps` — apps explicitly granted in a workspace
- `hoomi_search_micro_apps` — published and distributed app search
- `hoomi_list_installed_micro_apps` — the user's installed apps
- `hoomi_check_installed_micro_app_permissions` — one installed app's permissions
- `hoomi_list_pinned_micro_apps` — pinned installed apps
- `hoomi_list_micro_app_reviews` — app reviews without reviewer email or user ID
- `hoomi_list_micro_app_languages` — language master data
- `hoomi_list_micro_app_categories` — category master data
- `hoomi_list_micro_app_countries` — country master data
- `hoomi_list_micro_app_permissions` — permission master data
- `hoomi_list_micro_app_permission_strings` — localized permission strings

## Confirmed Write Tools

The following tools require a literal `confirm: true` input and are annotated as non-read-only, non-idempotent actions. MCP host approval remains an independent required control.

- `hoomi_install_micro_app` — install an app for the authenticated user
- `hoomi_submit_micro_app_review` — create or reactivate the user's review
- `hoomi_add_micro_app_member` — grant an existing workspace member app access
- `hoomi_submit_build_for_review` — advance a build to review
- `hoomi_mark_build_ready_to_release` — advance a build to ready-to-release

## Deliberately Not Exposed Yet

- Create/update micro-app tools: the API requires multipart uploads and returns `app_secret`; a model-visible tool result is not an acceptable secret-delivery channel.
- Refresh app secret: requires a dedicated secret manager and one-time delivery path.
- Issue install token: returns a scoped credential intended for a host WebView, not an LLM tool result.
- Microapp Gateway payment: requires app signature plus scoped install token, not a Hoomi user session.
- Partner API-key issuance: protected by `X-Internal-Secret` and must remain an operator-only action.
- Arbitrary HTTP proxying, raw file uploads, and any model-controlled authorization header.

These operations can be added only with typed schemas, explicit policy, and a safe credential/file delivery design. “All GET/POST” means endpoint coverage will grow through this allowlisted catalog, not through an unrestricted URL proxy.
