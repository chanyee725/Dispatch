// Role names and colours shared by the session screens (moved from run/overlayModel.ts).

export const ROLES = { lead: '관리자', impl: '구현자', review: '리뷰어', test: '테스터', design: '디자이너', docs: '문서화' } as const;
export type RoleId = keyof typeof ROLES;

/** Up to 3 lightness steps per role; later sessions of the same role reuse the last step (their name tells them apart). */
const SHADES = 3;

export const roleLabel = (role: string): string => (Object.hasOwn(ROLES, role) ? ROLES[role as RoleId] : role);

/** Colour of one role at a lightness step: step 0 is the token, later steps move toward the text colour (more contrast in both themes). */
export function roleColor(role: string, shade = 0): string {
  const base = Object.hasOwn(ROLES, role) ? `var(--role-${role})` : 'var(--idle)';
  const s = Math.min(Math.max(shade, 0), SHADES - 1);
  return s === 0 ? base : `color-mix(in oklch, ${base}, var(--foreground) ${s * 25}%)`;
}
