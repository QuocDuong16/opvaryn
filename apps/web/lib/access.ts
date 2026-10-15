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
