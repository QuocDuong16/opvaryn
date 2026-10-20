import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ApiError,
  type AdminDepartment,
  type AdminRole,
  type AdminUser,
  type Me,
} from '@opvaryn/contracts';

import { AdminLoadError } from '@/components/admin/admin-load-error';
import { AdminNav } from '@/components/admin/admin-nav';
import { cooldownState } from '@/components/admin/cooldown';
import {
  PasswordResetForm,
  RevokeSessionsForm,
  UnlockSignInForm,
} from '@/components/admin/security-forms';
import { ResetTwoFactorForm, TwoFactorForm } from '@/components/admin/two-factor-form';
import { UserForm } from '@/components/admin/user-form';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { loadAdminAccess } from '@/lib/admin-server';
import { createServerApiClient, describeApiError } from '@/lib/api/server';
import { joinLabels } from '@/lib/names';

export const metadata = { title: 'Tài khoản' };

export default async function AdminUserPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ unlocked?: string }>;
}) {
  const access = await loadAdminAccess();
  if (access.kind === 'denied') {
    notFound();
  }
  if (access.kind === 'error') {
    return <AdminLoadError message={access.message} />;
  }

  const [{ id }, { unlocked }] = await Promise.all([params, searchParams]);

  let user: AdminUser | null = null;
  let departments: AdminDepartment[] = [];
  let roles: AdminRole[] = [];
  let me: Me | null = null;
  let twoFactorEnabled = false;
  let error: string | null = null;

  const api = createServerApiClient();
  try {
    const [loaded, departmentPage, rolePage, signedIn] = await Promise.all([
      api.getAdminUser(id),
      api.listAdminDepartments({ limit: 100 }),
      api.listAdminRoles({ limit: 100 }),
      api.getMe(),
    ]);
    user = loaded;
    departments = departmentPage.data;
    roles = rolePage.data;
    me = signedIn;
  } catch (cause) {
    if (cause instanceof ApiError && cause.code === 'not_found') {
      notFound();
    }
    error = describeApiError(cause);
  }

  if (error || !user || !me) {
    return <AdminLoadError message={error ?? 'Không đọc được tài khoản.'} />;
  }

  const roleNames = new Map<string, string>();
  for (const role of roles) {
    roleNames.set(role.key, role.label);
  }
  for (const [key, label] of Object.entries(user.roleLabels)) {
    roleNames.set(key, label);
  }
  const isSelf = user.id === me.id;
  // The second step: for the signed-in person it is their own, for somebody else the
  // administration area reads it through the admin endpoint.
  twoFactorEnabled = (
    await (isSelf ? api.getMyTwoFactor() : api.getAdminUserTwoFactor(user.id)).catch(() => ({
      enabled: false,
    }))
  ).enabled;
  // The unlock control only appears while the account is waiting: a control that cannot do
  // anything is not rendered (ADR 0021). A disabled account is not waiting for anything.
  const cooldown = cooldownState(user.lockedUntil);
  const wasUnlocked = unlocked === '1';

  return (
    <>
      <PageHeader
        eyebrow="08 / Quản trị · Người dùng"
        title={user.name}
        lead={`${user.email} · ${user.departmentName} · ${joinLabels(user.roles, roleNames)}`}
      />
      <AdminNav />

      <p className="mb-4 text-sm">
        <Link href="/admin/users" className="text-accent-strong hover:underline">
          ← Danh sách tài khoản
        </Link>
      </p>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(18rem,1fr)]">
        <UserForm mode="edit" departments={departments} roles={roles} user={user} isSelf={isSelf} />
        <div className="space-y-6">
          {isSelf ? <TwoFactorForm enabled={twoFactorEnabled} /> : null}
          {!isSelf && twoFactorEnabled ? (
            <Card>
              <CardTitle>Xác thực hai bước</CardTitle>
              <CardDescription>
                Người này bật xác thực hai bước. Gỡ nó khi họ mất thiết bị — mật khẩu của họ vẫn giữ
                nguyên.
              </CardDescription>
              <div className="mt-4">
                <ResetTwoFactorForm userId={user.id} label={user.name} />
              </div>
            </Card>
          ) : null}
          {wasUnlocked ? (
            <Card>
              <CardTitle>Đã mở khoá đăng nhập</CardTitle>
              <CardDescription>
                Người này đăng nhập lại được ngay. Mật khẩu không thay đổi và các phiên đang mở vẫn
                dùng được.
              </CardDescription>
            </Card>
          ) : null}
          {cooldown.locked && cooldown.clock && user.status === 'active' ? (
            <UnlockSignInForm userId={user.id} lockedUntilClock={cooldown.clock} />
          ) : null}
          <PasswordResetForm userId={user.id} />
          <RevokeSessionsForm userId={user.id} />
        </div>
      </div>
    </>
  );
}
