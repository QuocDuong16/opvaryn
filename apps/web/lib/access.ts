/**
 * Who sees what. The interface is written for the person doing the work; the screens that
 * describe how the system is built or operated are for the administrator, and even then only
 * behind the advanced switch (ADR 0015).
 */
export type Audience = 'everyone' | 'admin';

/** Roles that may see the build and operations screens. */
const ADMIN_ROLES: readonly string[] = ['admin'];

export function isAdmin(roles: readonly string[] | undefined): boolean {
  if (!roles) {
    return false;
  }
  return roles.some((role) => ADMIN_ROLES.includes(role));
}

/** The role that may create and change definitions, processes and metrics (ADR 0008). */
export const DESIGNER_ROLE = 'process_designer';

/**
 * canDesign answers whether the interface should *offer* the controls that change a
 * definition, a process or a metric. It is a display decision and nothing more: the API decides
 * on every write, and a caller who never sees the control is still refused by the service
 * (ADR 0021).
 */
export function canDesign(roles: readonly string[] | undefined): boolean {
  return isAdmin(roles) || (roles ?? []).includes(DESIGNER_ROLE);
}
