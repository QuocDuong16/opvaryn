import { Card, CardDescription, CardTitle } from '@/components/ui/card';

/**
 * DesignerNotice stands where a control would be that the person cannot use (ADR 0021).
 *
 * The interface does not offer an action the API will refuse: a form that only fails on submit
 * is a form that wasted the person's time. It says what the action needs and who can grant it
 * instead. The API stays the authority — this only stops inviting work that cannot succeed.
 */
export function DesignerNotice({
  roleName,
  what,
}: {
  /** The role's own name, as the catalogue has it. */
  roleName: string;
  /** What the missing control would do, in the person's words: "tạo và sửa định nghĩa dữ liệu". */
  what: string;
}) {
  return (
    <Card className="border-dashed">
      <CardTitle>{`Bạn chưa có quyền ${what}`}</CardTitle>
      <CardDescription>
        {`Việc này cần ${roleName} hoặc quyền quản trị hệ thống. Người quản trị hệ thống gán được vai trò đó cho bạn; mọi thứ đang có thì bạn vẫn xem được.`}
      </CardDescription>
    </Card>
  );
}
