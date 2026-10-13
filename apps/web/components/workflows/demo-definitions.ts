/**
 * Demo workflow definitions.
 *
 * These fixtures describe what a published process definition would contain:
 * nodes, edges, routing rules and version. They exist to make the Workflow
 * Designer experience concrete while the real runtime waits for the Process
 * Execution Contract decisions (playbook D05/D08). Nothing here executes.
 */

export type WorkflowNodeType = 'start' | 'approval' | 'condition' | 'notification' | 'end';

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  title: string;
  subtitle: string;
  x: number;
  y: number;
  /** Configuration rows that would live in the definition document. */
  config: readonly { label: string; value: string }[];
}

export interface WorkflowEdge {
  from: string;
  to: string;
  label?: string;
}

export interface WorkflowDefinitionDemo {
  id: string;
  name: string;
  businessObject: string;
  publishedVersion: string;
  draftVersion: string;
  summary: string;
  nodes: readonly WorkflowNode[];
  edges: readonly WorkflowEdge[];
}

export const NODE_TYPE_LABELS: Record<WorkflowNodeType, string> = {
  start: 'Start',
  approval: 'Human task',
  condition: 'Condition',
  notification: 'Notification',
  end: 'End',
};

export const DEMO_WORKFLOWS: readonly WorkflowDefinitionDemo[] = [
  {
    id: 'purchase-approval',
    name: 'Duyệt đề nghị mua hàng',
    businessObject: 'purchase_request',
    publishedVersion: 'v3',
    draftVersion: 'v4 — nháp, chưa publish',
    summary:
      'Nhân viên gửi đề nghị, trưởng bộ phận duyệt trước, sau đó rẽ nhánh theo ngưỡng giá trị: từ 20 triệu cần giám đốc duyệt thêm.',
    nodes: [
      {
        id: 'start',
        type: 'start',
        title: 'Nhận đề nghị',
        subtitle: 'Trigger: submit form',
        x: 30,
        y: 148,
        config: [
          { label: 'Trigger', value: 'Người dùng submit form purchase_request' },
          { label: 'Validate input', value: 'Theo field schema của business object' },
          { label: 'Dedupe', value: 'Chưa hỗ trợ — thuộc D05' },
        ],
      },
      {
        id: 'manager',
        type: 'approval',
        title: 'Trưởng bộ phận duyệt',
        subtitle: 'Human task',
        x: 215,
        y: 148,
        config: [
          { label: 'Assignee', value: 'Trưởng bộ phận của người đề nghị' },
          { label: 'SLA', value: '24 giờ làm việc' },
          { label: 'Hành động', value: 'Duyệt / Trả về chỉnh sửa / Từ chối' },
          { label: 'Return', value: 'Quay lại Start, giữ dữ liệu đã nhập' },
        ],
      },
      {
        id: 'threshold',
        type: 'condition',
        title: 'Giá trị ≥ 20 triệu?',
        subtitle: 'Condition',
        x: 400,
        y: 148,
        config: [
          { label: 'Biểu thức', value: 'values.estimated_amount >= 20000000' },
          { label: 'Nguồn dữ liệu', value: 'Context của instance tại thời điểm chạy' },
          { label: 'Rule DSL', value: 'Chưa chốt — quyết định D04' },
        ],
      },
      {
        id: 'director',
        type: 'approval',
        title: 'Giám đốc duyệt',
        subtitle: 'Human task · vượt ngưỡng',
        x: 600,
        y: 52,
        config: [
          { label: 'Assignee', value: 'Role: giám đốc' },
          { label: 'SLA', value: '48 giờ làm việc' },
          { label: 'Uỷ quyền', value: 'Delegation thuộc V1.x' },
        ],
      },
      {
        id: 'accounting',
        type: 'approval',
        title: 'Kế toán xác nhận',
        subtitle: 'Human task · dưới ngưỡng',
        x: 600,
        y: 244,
        config: [
          { label: 'Assignee', value: 'Role: kế toán' },
          { label: 'SLA', value: '48 giờ làm việc' },
          { label: 'Kiểm tra', value: 'Mã ngân sách, nhà cung cấp (concept)' },
        ],
      },
      {
        id: 'notify',
        type: 'notification',
        title: 'Thông báo kết quả',
        subtitle: 'Notification',
        x: 800,
        y: 148,
        config: [
          { label: 'Người nhận', value: 'Người đề nghị' },
          { label: 'Kênh', value: 'In-app (demo concept)' },
          { label: 'Ghi chú', value: 'Không đổi kết quả approval' },
        ],
      },
      {
        id: 'end',
        type: 'end',
        title: 'Kết thúc',
        subtitle: 'Terminal state',
        x: 985,
        y: 148,
        config: [
          { label: 'Kết quả', value: 'approved / rejected / cancelled' },
          { label: 'Audit', value: 'Actor, thời điểm, trạng thái cũ/mới' },
        ],
      },
    ],
    edges: [
      { from: 'start', to: 'manager' },
      { from: 'manager', to: 'threshold', label: 'Đã duyệt' },
      { from: 'threshold', to: 'director', label: 'Có — vượt ngưỡng' },
      { from: 'threshold', to: 'accounting', label: 'Không' },
      { from: 'director', to: 'notify' },
      { from: 'accounting', to: 'notify' },
      { from: 'notify', to: 'end' },
    ],
  },
  {
    id: 'incident-handling',
    name: 'Xử lý sự cố IT',
    businessObject: 'it_incident',
    publishedVersion: 'v1',
    draftVersion: 'v2 — đang soạn: thêm escalation',
    summary:
      'Phân loại theo mức độ: sự cố nghiêm trọng cần trưởng IT xác nhận trước khi đóng; các mức còn lại do IT xử lý trực tiếp.',
    nodes: [
      {
        id: 'start',
        type: 'start',
        title: 'Tiếp nhận sự cố',
        subtitle: 'Trigger: form hoặc API',
        x: 30,
        y: 148,
        config: [
          { label: 'Trigger', value: 'Người dùng submit form it_incident' },
          { label: 'Trigger khác', value: 'API / event từ hệ thống giám sát (concept)' },
        ],
      },
      {
        id: 'classify',
        type: 'condition',
        title: 'Mức độ nghiêm trọng?',
        subtitle: 'Condition: severity',
        x: 230,
        y: 148,
        config: [
          { label: 'Biểu thức', value: 'values.severity == "nghiem_trong"' },
          { label: 'Nhánh', value: 'Nghiêm trọng → cần trưởng IT xác nhận' },
        ],
      },
      {
        id: 'handle',
        type: 'approval',
        title: 'IT xử lý',
        subtitle: 'Human task',
        x: 440,
        y: 244,
        config: [
          { label: 'Assignee', value: 'Nhóm IT trực' },
          { label: 'SLA', value: 'Theo mức độ: 4h / 8h / 24h' },
          { label: 'Ghi chú xử lý', value: 'Bắt buộc trước khi hoàn tất' },
        ],
      },
      {
        id: 'escalate',
        type: 'approval',
        title: 'Trưởng IT xác nhận',
        subtitle: 'Nhánh nghiêm trọng',
        x: 440,
        y: 52,
        config: [
          { label: 'Assignee', value: 'Role: trưởng nhóm IT' },
          { label: 'Escalation', value: 'Chưa có trong demo — V1.x' },
        ],
      },
      {
        id: 'close',
        type: 'end',
        title: 'Đóng sự cố',
        subtitle: 'Terminal state',
        x: 680,
        y: 148,
        config: [
          { label: 'Kết quả', value: 'resolved / rejected (không phải sự cố)' },
          { label: 'Đo lường', value: 'Thời gian xử lý, SLA breach — cần read model' },
        ],
      },
    ],
    edges: [
      { from: 'start', to: 'classify' },
      { from: 'classify', to: 'escalate', label: 'Nghiêm trọng' },
      { from: 'classify', to: 'handle', label: 'Còn lại' },
      { from: 'escalate', to: 'close' },
      { from: 'handle', to: 'close' },
    ],
  },
];
