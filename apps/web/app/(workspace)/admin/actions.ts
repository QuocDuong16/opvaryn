'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import type { AdminActionState } from '@/components/admin/admin-state';
import type { WorkPolicyState } from '@/components/admin/work-policy-state';
import type { LookupState } from '@/components/admin/lookup-state';
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

// ------------------------------------------------------- lookups ----

export async function saveLookupSourceAction(
  _previous: LookupState,
  formData: FormData,
): Promise<LookupState> {
  const objectKey = field(formData, 'objectKey');
  try {
    // The form carries one address per field, named `url-<field key>`, and the field keys
    // in `field-objectKey`.
    const fieldKeys = formData.getAll('field-objectKey').map((value) => String(value));
    for (const fieldKey of fieldKeys) {
      const url = field(formData, `url-${fieldKey}`);
      await createServerApiClient().saveLookupSource(objectKey, fieldKey, url);
    }
    revalidatePath('/admin/lookups');
    return { status: 'success', message: 'Đã lưu nguồn tra cứu.' };
  } catch (cause) {
    return failure(cause);
  }
}

// ------------------------------------------------------- work policies ----

export async function saveWorkPolicyAction(
  _previous: WorkPolicyState,
  formData: FormData,
): Promise<WorkPolicyState> {
  const objectKey = field(formData, 'objectKey');
  const dueHours = Number(field(formData, 'defaultDueHours'));
  try {
    await createServerApiClient().saveWorkPolicy(objectKey, {
      defaultDueHours: Number.isFinite(dueHours) ? dueHours : 0,
      defaultPriority: field(formData, 'defaultPriority'),
      escalationRole: field(formData, 'escalationRole'),
    });
    revalidatePath('/admin/policies');
    return { status: 'success', message: 'Đã lưu chính sách của loại việc này.' };
  } catch (cause) {
    return failure(cause);
  }
}

// ------------------------------------------------------- working hours ----

export async function replaceWorkingHoursAction(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  let hours: { weekday: number; start: number; end: number }[] = [];
  try {
    const raw = String(formData.get('data') ?? '[]');
    const parsed = JSON.parse(raw);
    hours = Array.isArray(parsed) ? parsed : [];
  } catch {
    return { status: 'error', message: 'Lịch giờ làm việc không đọc được.' };
  }
  try {
    await createServerApiClient().replaceWorkingHours(hours);
    revalidatePath('/admin/working-hours');
    return { status: 'success', message: 'Đã lưu lịch giờ làm việc.' };
  } catch (cause) {
    return failure(cause);
  }
}

// ---------------------------------------------------------- two factor ----

/**
 * Two-step verification (ADR 0030). The secret is handed out once, here, and the recovery
 * codes once, when the second step is switched on.
 */
export async function setupMyTwoFactorAction(): Promise<AdminActionState> {
  try {
    const setup = await createServerApiClient().setupMyTwoFactor();
    revalidatePath(`/admin/users`);
    return {
      status: 'success',
      message: 'Nhập khoá bí mật dưới đây vào ứng dụng xác thực, rồi nhập mã để bật.',
      twoFactorSecret: setup.secret,
      twoFactorUri: setup.uri,
    };
  } catch (cause) {
    return failure(cause);
  }
}

export async function enableMyTwoFactorAction(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const code = field(formData, 'code');
  try {
    const enabled = await createServerApiClient().enableMyTwoFactor(code);
    revalidatePath(`/admin/users`);
    return {
      status: 'success',
      message: 'Đã bật xác thực hai bước. Lưu các mã cứu hộ dưới đây, chúng chỉ hiện một lần.',
      recoveryCodes: enabled.recoveryCodes,
    };
  } catch (cause) {
    return failure(cause);
  }
}

export async function disableMyTwoFactorAction(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const code = field(formData, 'code');
  try {
    await createServerApiClient().disableMyTwoFactor(code);
    revalidatePath(`/admin/users`);
    return { status: 'success', message: 'Đã tắt xác thực hai bước cho tài khoản này.' };
  } catch (cause) {
    return failure(cause);
  }
}

export async function resetAdminUserTwoFactorAction(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const userId = field(formData, 'userId');
  try {
    await createServerApiClient().resetAdminUserTwoFactor(userId);
    revalidatePath(`/admin/users/${userId}`);
    return {
      status: 'success',
      message: 'Đã gỡ xác thực hai bước của người này. Họ có thể bật lại bất cứ lúc nào.',
    };
  } catch (cause) {
    return failure(cause);
  }
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
