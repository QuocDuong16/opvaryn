'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import type { WorkingHour } from '@opvaryn/contracts';

import { replaceWorkingHoursAction } from '@/app/(workspace)/admin/actions';
import { INITIAL_ADMIN_STATE } from '@/components/admin/admin-state';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';

const WEEKDAYS = [
  'Chủ nhật',
  'Thứ hai',
  'Thứ ba',
  'Thứ tư',
  'Thứ năm',
  'Thứ sáu',
  'Thứ bảy',
] as const;

/** timeToMinutes reads "09:30" as minutes from midnight. */
function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map((part) => Number(part));
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return 0;
  }
  return hours * 60 + minutes;
}

/** minutesToTime reads minutes from midnight as "09:30". */
function minutesToTime(minute: number): string {
  const hours = Math.floor(minute / 60);
  const rest = minute % 60;
  return `${String(hours).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

interface Stretch {
  start: string;
  end: string;
}

/**
 * WorkingHoursForm edits the organisation's working calendar (ADR 0031). The calendar is
 * replaced as a whole: a half-written calendar would make deadlines mean something nobody
 * chose.
 */
export function WorkingHoursForm({ hours }: { hours: readonly WorkingHour[] }) {
  const [state, formAction] = useActionState(replaceWorkingHoursAction, INITIAL_ADMIN_STATE);
  const [stretches, setStretches] = useState<Stretch[][]>(() => {
    const byDay: Stretch[][] = Array.from({ length: 7 }, () => []);
    for (const hour of hours) {
      byDay[hour.weekday]?.push({
        start: minutesToTime(hour.start),
        end: minutesToTime(hour.end),
      });
    }
    return byDay;
  });

  function update(day: number, index: number, patch: Partial<Stretch>) {
    setStretches((current) =>
      current.map((day_, dayIndex) =>
        dayIndex === day
          ? day_.map((stretch, stretchIndex) =>
              stretchIndex === index ? { ...stretch, ...patch } : stretch,
            )
          : day_,
      ),
    );
  }

  function addStretch(day: number) {
    setStretches((current) =>
      current.map((day_, dayIndex) =>
        dayIndex === day ? [...day_, { start: '09:00', end: '17:00' }] : day_,
      ),
    );
  }

  function removeStretch(day: number, index: number) {
    setStretches((current) =>
      current.map((day_, dayIndex) =>
        dayIndex === day ? day_.filter((_, stretchIndex) => stretchIndex !== index) : day_,
      ),
    );
  }

  return (
    <Card>
      <CardTitle>Giờ làm việc trong tuần</CardTitle>
      <CardDescription>
        Mỗi khoảng là một phần của ngày được tính là giờ làm việc. Ngày không có khoảng nào thì
        không tính giờ làm việc.
      </CardDescription>

      <form action={formAction} className="mt-4 space-y-4">
        {WEEKDAYS.map((label, day) => (
          <div key={label} className="rounded-lg border border-border bg-surface-raised/40 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{label}</span>
              <button
                type="button"
                onClick={() => addStretch(day)}
                className="rounded-lg border border-border px-2 py-1 text-xs font-medium hover:bg-surface-overlay"
              >
                Thêm khoảng
              </button>
            </div>
            {stretches[day].length === 0 ? (
              <p className="mt-2 text-xs text-on-surface-muted">Không tính giờ làm việc.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {stretches[day].map((stretch, index) => (
                  <li key={`${day}-${index}`} className="flex flex-wrap items-center gap-2">
                    <input
                      type="time"
                      name={`start-${day}-${index}`}
                      value={stretch.start}
                      onChange={(event) => update(day, index, { start: event.target.value })}
                      className="rounded-lg border border-border bg-surface px-2 py-1 text-sm"
                    />
                    <span className="text-xs text-on-surface-muted">đến</span>
                    <input
                      type="time"
                      name={`end-${day}-${index}`}
                      value={stretch.end}
                      onChange={(event) => update(day, index, { end: event.target.value })}
                      className="rounded-lg border border-border bg-surface px-2 py-1 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => removeStretch(day, index)}
                      className="rounded-lg border border-border px-2 py-1 text-xs font-medium hover:bg-surface-overlay"
                    >
                      Bỏ
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}

        <input
          type="hidden"
          name="data"
          value={JSON.stringify(
            stretches.flatMap((day, dayIndex) =>
              day.map((stretch) => ({
                weekday: dayIndex,
                start: timeToMinutes(stretch.start),
                end: timeToMinutes(stretch.end),
              })),
            ),
          )}
        />

        <Submit />
        {state.message ? (
          <p
            role={state.status === 'error' ? 'alert' : 'status'}
            className={
              state.status === 'error'
                ? 'rounded-lg border border-danger/40 px-3 py-2 text-sm text-danger'
                : 'rounded-lg border border-success/40 px-3 py-2 text-sm text-success'
            }
          >
            {state.message}
          </p>
        ) : null}
      </form>
    </Card>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-opacity hover:opacity-90 disabled:opacity-60"
    >
      {pending ? 'Đang lưu…' : 'Lưu lịch giờ làm việc'}
    </button>
  );
}
