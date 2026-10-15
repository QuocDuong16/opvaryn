import { toggleAdvancedAction } from '@/app/actions/advanced';
import { getAdvancedMode } from '@/lib/advanced-server';

/**
 * The advanced switch, offered to administrators only. It reveals how the system is built and
 * operated (build stage, platform status, endpoint table); with it off, an administrator sees
 * the same product screens as everyone else.
 */
export async function AdvancedToggle() {
  const mode = await getAdvancedMode();
  const on = mode === 'on';

  return (
    <form action={toggleAdvancedAction}>
      <button
        type="submit"
        name="advanced"
        value="toggle"
        aria-pressed={on}
        title="Hiện thông tin kỹ thuật của hệ thống (chỉ quản trị viên)"
        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-on-surface-muted transition-colors hover:border-border-strong hover:text-on-surface"
      >
        <span
          aria-hidden
          className={`size-1.5 rounded-full ${on ? 'bg-accent-strong' : 'bg-border-strong'}`}
        />
        Nâng cao
      </button>
    </form>
  );
}
