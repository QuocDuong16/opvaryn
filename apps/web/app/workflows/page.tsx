import { ModulePlaceholder } from '@/components/ui/module-placeholder';

export const metadata = { title: 'Workflows' };

export default function WorkflowsPage() {
  return (
    <ModulePlaceholder
      eyebrow="04 / Workflow designer"
      title="Workflows"
      stage="mock"
      lead="Visual editor dạng directed graph để định nghĩa node, đường chuyển và quy tắc định tuyến theo role, phòng ban, ngưỡng giá trị hoặc dữ liệu."
      features={[
        'Node cơ bản: Start, Approval, Condition, Notification, End',
        'Định tuyến theo role / department / attribute / dữ liệu',
        'Reject, return, resubmit và versioning của definition',
        'Publish version mới mà không phá các instance đang xử lý',
      ]}
      note="Runtime xử lý quy trình (state machine, concurrency, retry) chưa được viết vì Process Execution Contract còn là quyết định mở D05/D08 trong playbook. Màn hình này chỉ minh họa trải nghiệm thiết kế."
    />
  );
}
