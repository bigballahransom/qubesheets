// lib/featureFlags.ts
//
// Org-allowlisted rollout flags. The new-capture experience (local-first
// MediaRecorder engine + recorder reliability hardening) rolls out
// org-by-org: allowlisted orgs get the new behavior, everyone else keeps
// the pre-existing LiveKit recording flow untouched.
//
// To expand the rollout, add org IDs here (or migrate this to an
// OrganizationSettings field once more than a handful of orgs are on it).

const NEW_CAPTURE_EXPERIENCE_ORG_ALLOWLIST = new Set<string>([
  'org_3Gv6wZaRETFHgGiLD2QWOJuT5D3',
]);

export function isNewCaptureExperienceEnabled(organizationId?: string | null): boolean {
  return !!organizationId && NEW_CAPTURE_EXPERIENCE_ORG_ALLOWLIST.has(organizationId);
}
