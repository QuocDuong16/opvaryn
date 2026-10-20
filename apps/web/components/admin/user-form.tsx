'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import type { AdminDepartment, AdminRole, AdminUser } from '@opvaryn/contracts';

import { createAdminUserAction, updateAdminUserAction } from '@/app/(workspace)/admin/actions';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { INITIAL_ADMIN_STATE } from '@/components/admin/admin-state';
import { INPUT_CLASS, LABEL_CLASS, SUBMIT_CLASS } from '@/components/admin/form-styles';
import { labelOrKey } from '@/lib/names';

interface UserFormProps {
  mode: 'create' | 'edit';
  departments: readonly AdminDepartment[];
  roles: readonly AdminRole[];
  user?: AdminUser;
  /** Editing the signed-in account: the API refuses to disable it, so the form does not offer it. */
  isSelf?: boolean;
}

/** One form for creating and editing a person; the API decides every rule. */
export function UserForm({ mode, departments, roles, user, isSelf = false }: UserFormProps) {
  const [state, formAction] = useActionState(
    mode === 'create' ? createAdminUserAction : updateAdminUserAction,
    INITIAL_ADMIN_STATE,
  );

  const orderedRoles = [...roles].sort((left, right) =>
    labelOrKey(left.label, left.key).localeCompare(labelOrKey(right.label, right.key), 'vi'),
  );

  return (
    <Card>
      <CardTitle>{mode === 'create' ? 'Tạo tài khoản' : 'Thông tin tài khoản'}</CardTitle>
      <CardDescription>
        {mode === 'create'
          ? 'Mật khẩu tạm do bạn đặt; người dùng nên đổi lại sau lần đăng nhập đầu tiên. Tài khoản phải thuộc một phòng ban và giữ ít nhất một vai trò.'
          : 'Thay đổi tên, phòng ban hoặc vai trò có hiệu lực ngay. Khoá tài khoản sẽ kết thúc mọi phiên đăng nhập của người đó.'}
      </CardDescription>

      <form action={formAction} className="mt-4 space-y-4">
        {user ? <input type="hidden" name="userId" value={user.id} /> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="admin-user-name" className={LABEL_CLASS}>
              Họ tên
            </label>
            <input
              id="admin-user-name"
              name="name"
              required
              maxLength={120}
              defaultValue={user?.name ?? ''}
              autoComplete="off"
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label htmlFor="admin-user-email" className={LABEL_CLASS}>
              Email đăng nhập
            </label>
            <input
              id="admin-user-email"
              name="email"
              type="email"
              required
              defaultValue={user?.email ?? ''}
              autoComplete="off"
              className={INPUT_CLASS}
            />
          </div>
        </div>

        {mode === 'create' ? (
          <div>
            <label htmlFor="admin-user-password" className={LABEL_CLASS}>
              Mật khẩu tạm
            </label>
            <input
              id="admin-user-password"
              name="password"
              type="password"
              required
              minLength={10}
              autoComplete="new-password"
              className={INPUT_CLASS}
            />
            <p className="mt-1 text-xs text-on-surface-muted">Ít nhất 10 ký tự.</p>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="admin-user-department" className={LABEL_CLASS}>
              Phòng ban
            </label>
            <select
              id="admin-user-department"
              name="department"
              required
              defaultValue={user?.department ?? ''}
              className={INPUT_CLASS}
            >
              <option value="" disabled>
                Chọn phòng ban
              </option>
              {departments.map((department) => (
                <option key={department.key} value={department.key}>
                  {department.name}
                </option>
              ))}
            </select>
          </div>

          {mode === 'edit' ? (
            <div>
              <span className={LABEL_CLASS}>Trạng thái</span>
              {isSelf ? (
                <>
                  <input type="hidden" name="status" value="active" />
                  <p className="mt-2 rounded-lg border border-border px-3 py-2 text-sm text-on-surface-muted">
                    Bạn đang dùng tài khoản này nên không thể tự khoá nó.
                  </p>
                </>
              ) : (
                <select
                  id="admin-user-status"
                  name="status"
                  defaultValue={user?.status ?? 'active'}
                  className={INPUT_CLASS}
                >
                  <option value="active">Đang hoạt động</option>
                  <option value="disabled">Đã khoá — không đăng nhập được</option>
                </select>
              )}
            </div>
          ) : null}
        </div>

        <fieldset>
          <legend className={LABEL_CLASS}>Vai trò</legend>
          <p className="mt-1 text-xs text-on-surface-muted">
            Vai trò quyết định người này nhận việc gì và được thiết kế hay quản trị hay không.
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {orderedRoles.map((role) => {
              const checked = user?.roles.includes(role.key) ?? false;
              return (
                <label
                  key={role.key}
                  className="flex items-start gap-2.5 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                >
                  <input
                    type="checkbox"
                    name="roles"
                    value={role.key}
                    defaultChecked={checked}
                    className="mt-0.5 size-4 rounded border-border"
                  />
                  <span className="min-w-0">
                    <span className="block font-medium">{labelOrKey(role.label, role.key)}</span>
                    {role.isSystem ? (
                      <span className="block text-xs text-on-surface-muted">Vai trò hệ thống</span>
                    ) : null}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <SubmitButton label={mode === 'create' ? 'Tạo tài khoản' : 'Lưu thay đổi'} />

        {state.status === 'error' && state.message ? (
          <p
            role="alert"
            className="rounded-lg border border-danger/40 px-3 py-2 text-sm text-danger"
          >
            {state.message}
          </p>
        ) : null}
        {state.status === 'success' && state.message ? (
          <div
            role="status"
            className="rounded-lg border border-success/40 px-3 py-2 text-sm text-success"
          >
            <p>{state.message}</p>
            {state.userId ? (
              <Link
                href={`/admin/users/${state.userId}`}
                className="mt-1 inline-block font-medium underline underline-offset-2"
              >
                Mở tài khoản vừa tạo →
              </Link>
            ) : null}
          </div>
        ) : null}
      </form>
    </Card>
  );
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={SUBMIT_CLASS}>
      {pending ? 'Đang lưu…' : label}
    </button>
  );
}
