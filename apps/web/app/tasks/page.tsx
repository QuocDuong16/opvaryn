import { ModulePlaceholder } from '@/components/ui/module-placeholder';

export const metadata = { title: 'Tasks' };

export default function TasksPage() {
  return (
    <ModulePlaceholder
      eyebrow="05 / Task inbox"
      title="Tasks"
      stage="mock"
      lead="Một nơi để nhận việc, duyệt, từ chối, yêu cầu chỉnh sửa và theo dõi ai đang giữ việc — kèm timeline sự kiện của từng instance."
      features={[
        'Inbox theo người, nhóm hoặc role',
        'Duyệt, từ chối, trả về kèm lý do',
        'Timeline sự kiện và trạng thái của process instance',
        'Thông báo trong ứng dụng khi có việc mới',
      ]}
      note="Inbox và thao tác duyệt phụ thuộc workflow runtime. Demo thể hiện luồng tương tác với dữ liệu mô phỏng; hành vi thật thuộc MVP V1."
    />
  );
}
