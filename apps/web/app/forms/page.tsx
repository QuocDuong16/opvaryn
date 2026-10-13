import { ModulePlaceholder } from '@/components/ui/module-placeholder';

export const metadata = { title: 'Forms' };

export default function FormsPage() {
  return (
    <ModulePlaceholder
      eyebrow="03 / Form builder"
      title="Forms"
      stage="mock"
      lead="Giao diện nhập liệu được sinh từ schema business object: field có kiểu, ràng buộc và điều kiện hiển thị do admin cấu hình, không cần sửa code."
      features={[
        'Field types: text, number, date, select, file và repeating rows',
        'Required, ràng buộc giá trị và điều kiện hiển thị theo dữ liệu đã nhập',
        'Preview form từ schema trước khi publish',
        'External lookup và field mapping khi tích hợp hệ thống ngoài',
      ]}
      note="Trong bản demo, màn hình form builder là mô phỏng. Engine validate tập trung và lưu dữ liệu thật thuộc phạm vi MVP V1."
    />
  );
}
