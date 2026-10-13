import { ModulePlaceholder } from '@/components/ui/module-placeholder';

export const metadata = { title: 'Applications' };

export default function ApplicationsPage() {
  return (
    <ModulePlaceholder
      eyebrow="07 / Application builder"
      title="Applications"
      stage="concept"
      lead="Cho phép admin dựng mini-app nội bộ từ business object: các view danh sách, chi tiết, form và kanban, kèm action theo role và trạng thái."
      features={[
        'List, Detail, Form và Kanban views trên cùng một object',
        'Action theo role và trạng thái, liên kết đối tượng với nhau',
        'Gắn workflow và dashboard nhúng trong app',
        'Template library để tái sử dụng cấu hình',
      ]}
      note="Application Builder là định hướng V2 trong roadmap (OPVARYN Studio), không thuộc MVP V1. Demo chỉ trình diễn một vertical slice giả định ở tuần 7 — mọi màn hình ở đây là Concept."
    />
  );
}
