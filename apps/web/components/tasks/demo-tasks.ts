/**
 * Demo inbox fixtures. They describe tasks as the Task Inbox would show them once
 * the workflow runtime exists; in the demo the state lives in the browser only.
 */

export type TaskStatus = 'pending' | 'approved' | 'rejected' | 'returned';

export interface TaskTimelineEvent {
  at: string;
  actor: string;
  action: string;
  note?: string;
}

export interface DemoTask {
  id: string;
  title: string;
  processName: string;
  businessObject: string;
  submittedBy: string;
  holder: string;
  priority: 'normal' | 'high';
  amountLabel: string;
  waitingHours: number;
  slaHours: number;
  status: TaskStatus;
  timeline: readonly TaskTimelineEvent[];
}

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pending: 'Đang chờ bạn',
  approved: 'Đã duyệt',
  rejected: 'Đã từ chối',
  returned: 'Đã trả về',
};

export const DEMO_TASKS: readonly DemoTask[] = [
  {
    id: 'PR-2026-014',
    title: 'MacBook Pro 14 inch cho nhân viên mới',
    processName: 'Duyệt đề nghị mua hàng',
    businessObject: 'purchase_request',
    submittedBy: 'Trần Minh Anh',
    holder: 'Bạn — trưởng bộ phận Kỹ thuật (theo role)',
    priority: 'high',
    amountLabel: '52.900.000 ₫',
    waitingHours: 6,
    slaHours: 24,
    status: 'pending',
    timeline: [
      { at: '13/10 · 08:40', actor: 'Trần Minh Anh', action: 'Gửi đề nghị mua hàng' },
      {
        at: '13/10 · 08:41',
        actor: 'Hệ thống (demo)',
        action: 'Gán việc theo role trưởng bộ phận Kỹ thuật',
      },
    ],
  },
  {
    id: 'PR-2026-011',
    title: 'Gói dịch vụ thiết kế landing page',
    processName: 'Duyệt đề nghị mua hàng',
    businessObject: 'purchase_request',
    submittedBy: 'Nguyễn Quốc Bảo',
    holder: 'Bạn — trưởng bộ phận Marketing (theo role)',
    priority: 'normal',
    amountLabel: '24.500.000 ₫',
    waitingHours: 27,
    slaHours: 24,
    status: 'pending',
    timeline: [
      { at: '12/10 · 10:05', actor: 'Nguyễn Quốc Bảo', action: 'Gửi đề nghị mua hàng' },
      { at: '12/10 · 10:06', actor: 'Hệ thống (demo)', action: 'Gán việc theo role' },
    ],
  },
  {
    id: 'PR-2026-009',
    title: 'Ghế công thái học cho phòng họp',
    processName: 'Duyệt đề nghị mua hàng',
    businessObject: 'purchase_request',
    submittedBy: 'Đỗ Thanh Mai',
    holder: 'Bạn — trưởng bộ phận Kinh doanh (theo role)',
    priority: 'normal',
    amountLabel: '15.000.000 ₫',
    waitingHours: 3,
    slaHours: 24,
    status: 'pending',
    timeline: [{ at: '13/10 · 11:20', actor: 'Đỗ Thanh Mai', action: 'Gửi đề nghị mua hàng' }],
  },
  {
    id: 'INC-2026-032',
    title: 'Đồng bộ tồn kho ERP lệch so với thực tế',
    processName: 'Xử lý sự cố IT',
    businessObject: 'it_incident',
    submittedBy: 'Bùi Anh Tuấn',
    holder: 'Bạn — trưởng nhóm IT (theo role)',
    priority: 'high',
    amountLabel: 'Mức độ: Nghiêm trọng',
    waitingHours: 1,
    slaHours: 4,
    status: 'pending',
    timeline: [
      { at: '13/10 · 13:02', actor: 'Bùi Anh Tuấn', action: 'Báo sự cố' },
      {
        at: '13/10 · 13:03',
        actor: 'Hệ thống (demo)',
        action: 'Phân loại nghiêm trọng, cần trưởng IT xác nhận',
      },
    ],
  },
  {
    id: 'PR-2026-007',
    title: 'Bàn phím cơ và chuột ergonomic',
    processName: 'Duyệt đề nghị mua hàng',
    businessObject: 'purchase_request',
    submittedBy: 'Phạm Thu Hà',
    holder: 'Phạm Thu Hà — chờ bổ sung chứng từ',
    priority: 'normal',
    amountLabel: '3.200.000 ₫',
    waitingHours: 30,
    slaHours: 24,
    status: 'returned',
    timeline: [
      { at: '12/10 · 09:30', actor: 'Phạm Thu Hà', action: 'Gửi đề nghị mua hàng' },
      {
        at: '12/10 · 15:10',
        actor: 'Bạn (phiên trước)',
        action: 'Trả về người đề nghị',
        note: 'Bổ sung báo giá của hai nhà cung cấp.',
      },
    ],
  },
];

/** cloneTasks copies fixtures into the mutable state the inbox reduces over. */
export function cloneTasks(tasks: readonly DemoTask[]): DemoTask[] {
  return tasks.map((task) => ({ ...task, timeline: [...task.timeline] }));
}

export function countByStatus(tasks: readonly DemoTask[]): Record<TaskStatus, number> {
  const counts: Record<TaskStatus, number> = { pending: 0, approved: 0, rejected: 0, returned: 0 };
  for (const task of tasks) {
    counts[task.status] += 1;
  }
  return counts;
}
