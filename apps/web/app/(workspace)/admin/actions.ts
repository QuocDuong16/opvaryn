'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import type { AdminActionState } from '@/components/admin/admin-state';
import { createServerApiClient, describeApiError } from '@/lib/api/server';

/**
 * Administration actions. They assemble the request and map the API error envelope to a
 * sentence; every rule (roles, departments, the last administrator) stays in the Go service,
 * and the API refuses a caller without the admin role even if the form is replayed by hand.
 */

function failure(cause: unknown): AdminActionState {
  return { status: 'error', message: describeApiError(cause) };
}

function rolesFrom(formData: FormData): string[] {
  return formData.getAll('roles').map((value) => String(value));
}

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? '').trim();
}

// ----------------------------------------------------------------- users ----

export async function createAdminUserAction(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    const created = await createServerApiClient().createAdminUser({
      email: field(formData, 'email'),
      name: field(formData, 'name'),
      password: String(formData.get('password') ?? ''),
      department: field(formData, 'department'),
      roles: rolesFrom(formData),
    });
    revalidatePath('/admin');
    revalidatePath('/admin/users');
    return {
      status: 'success',
      message: `Đã tạo tài khoản cho ${created.name}.`,
      userId: created.id,
    };
  } catch (cause) {
    return failure(cause);
  }
}

export async function updateAdminUserAction(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const userId = field(formData, 'userId');
  try {
    const updated = await createServerApiClient().updateAdminUser(userId, {
      email: field(formData, 'email'),
      name: field(formData, 'name'),
      department: field(formData, 'department'),
      roles: rolesFrom(formData),
      status: field(formData, 'status') as 'active' | 'disabled',
    });
    revalidatePath('/admin');
    revalidatePath('/admin/users');
    revalidatePath(`/admin/users/${userId}`);
    return { status: 'success', message: `Đã lưu thay đổi cho ${updated.name}.` };
  } catch (cause) {
    return failure(cause);
  }
}

export async function setAdminUserPasswordAction(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const userId = field(formData, 'userId');
  try {
    await createServerApiClient().setAdminUserPassword(userId, {
      password: String(formData.get('password') ?? ''),
    });
    revalidatePath(`/admin/users/${userId}`);
    return {
      status: 'success',
      message: 'Đã đặt mật khẩu mới. Mọi phiên đăng nhập cũ của người này đã kết thúc.',
    };
  } catch (cause) {
    return failure(cause);
  }
}

export async function revokeAdminUserSessionsAction(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const userId = field(formData, 'userId');
  try {
    await createServerApiClient().revokeAdminUserSessions(userId);
    revalidatePath(`/admin/users/${userId}`);
    return { status: 'success', message: 'Đã đăng xuất mọi phiên của người này.' };
  } catch (cause) {
    return failure(cause);
  }
}

export async function unlockAdminUserAction(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const userId = field(formData, 'unlockUserId');
  try {
    await createServerApiClient().unlockAdminUser(userId);
  } catch (cause) {
    return failure(cause);
  }
  // The account is no longer waiting, so the card that carried the button is gone. The
  // confirmation therefore travels in the address, where the next render can show it.
  revalidatePath('/admin/users');
  redirect(`/admin/users/${userId}?unlocked=1`);
}

// ----------------------------------------------------------- departments ----

export async function createAdminDepartmentAction(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    const created = await createServerApiClient().createAdminDepartment({
      key: field(formData, 'key'),
      name: field(formData, 'name'),
    });
    revalidatePath('/admin');
    revalidatePath('/admin/departments');
    return { status: 'success', message: `Đã tạo phòng ban ${created.name}.` };
  } catch (cause) {
    return failure(cause);
  }
}

export async function updateAdminDepartmentAction(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const key = field(formData, 'key');
  try {
    const updated = await createServerApiClient().updateAdminDepartment(key, {
      name: field(formData, 'name'),
    });
    revalidatePath('/admin/departments');
    return { status: 'success', message: `Đã đổi tên phòng ban thành ${updated.name}.` };
  } catch (cause) {
    return failure(cause);
  }
}

export async function deleteAdminDepartmentAction(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const key = field(formData, 'key');
  try {
    await createServerApiClient().deleteAdminDepartment(key);
    revalidatePath('/admin');
    revalidatePath('/admin/departments');
    return { status: 'success', message: 'Đã xoá phòng ban.' };
  } catch (cause) {
    return failure(cause);
  }
}

// ----------------------------------------------------------------- roles ----

export async function createAdminRoleAction(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    const created = await createServerApiClient().createAdminRole({
      key: field(formData, 'key'),
      label: field(formData, 'label'),
    });
    revalidatePath('/admin');
    revalidatePath('/admin/roles');
    return { status: 'success', message: `Đã tạo vai trò ${created.label}.` };
  } catch (cause) {
    return failure(cause);
  }
}

export async function updateAdminRoleAction(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const key = field(formData, 'key');
  try {
    const updated = await createServerApiClient().updateAdminRole(key, {
      label: field(formData, 'label'),
    });
    revalidatePath('/admin/roles');
    return { status: 'success', message: `Đã đổi tên vai trò thành ${updated.label}.` };
  } catch (cause) {
    return failure(cause);
  }
}

export async function deleteAdminRoleAction(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const key = field(formData, 'key');
  try {
    await createServerApiClient().deleteAdminRole(key);
    revalidatePath('/admin');
    revalidatePath('/admin/roles');
    return { status: 'success', message: 'Đã xoá vai trò.' };
  } catch (cause) {
    return failure(cause);
  }
}
