# MCP Tool Catalog

All tools run behind the authenticated `POST /mcp` endpoint. The request's Hoomi session JWT is verified before a tool is dispatched. Tool handlers use a server-owned Hoomi API client; models never supply URLs, authorization headers, cookies, or credentials.

## Read Tools

- `hoomi_get_profile` — basic authenticated profile projection
- `hoomi_list_workspaces` — the user's partner workspaces
- `hoomi_list_partner_apps` — apps in a partner workspace
- `hoomi_list_my_apps` — the authenticated user's app grants for a partner
- `hoomi_search_micro_apps` — published and distributed app search
- `hoomi_list_micro_app_languages` — language master data
- `hoomi_list_micro_app_categories` — category master data
- `hoomi_list_micro_app_countries` — country master data
- `hoomi_list_micro_app_permissions` — permission master data
- `hoomi_list_micro_app_permission_strings` — localized permission strings
- `hoomi_get_micro_app` — a micro-app detail projection without app secrets
- `hoomi_get_micro_app_build` — a build projection without demo credentials
- `hoomi_get_build_submissions` — review submissions and activity logs without reviewer identifiers

## Confirmed Write Tools

The following tools require a literal `confirm: true` input and are annotated as non-read-only, non-idempotent actions. MCP host approval remains an independent required control. Delete tools are also marked destructive.

- `hoomi_create_micro_app` — create a micro-app; the app secret is delivered only through a one-time handoff
- `hoomi_update_micro_app` — update localized micro-app metadata and logos
- `hoomi_delete_micro_app` — delete a micro-app
- `hoomi_refresh_app_secret` — rotate a micro-app secret through a one-time handoff
- `hoomi_add_app_member` — grant an existing workspace member app access
- `hoomi_remove_app_member` — remove an app member grant
- `hoomi_update_app_member_role` — update an app member role
- `hoomi_create_micro_app_build` — create a build with optional preview images
- `hoomi_update_micro_app_build` — update build metadata; existing previews are retained
- `hoomi_delete_micro_app_build` — delete a build
- `hoomi_create_build_submission` — create a review submission with optional review images
- `hoomi_submit_build_for_review` — advance a build to review
- `hoomi_mark_build_ready_to_release` — advance a build to ready-to-release

## Deliberately Not Exposed Yet

- Issue install token: returns a scoped credential intended for a host WebView, not an LLM tool result.
- Microapp Gateway payment: requires app signature plus scoped install token, not a Hoomi user session.
- Partner API-key issuance: protected by `X-Internal-Secret` and must remain an operator-only action.
- Arbitrary HTTP proxying, raw file uploads, and any model-controlled authorization header.

These operations can be added only with typed schemas, explicit policy, and a safe credential/file delivery design. “All GET/POST” means endpoint coverage will grow through this allowlisted catalog, not through an unrestricted URL proxy.
