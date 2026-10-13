import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { navItemFor, NAV_ITEMS } from '@/app/nav';
import { StatusBadge } from '@/components/ui/status-badge';

describe('StatusBadge', () => {
  it.each([
    ['live', 'Live'],
    ['mock', 'Mock'],
    ['concept', 'Concept'],
  ] as const)('renders the %s label', (kind, label) => {
    render(<StatusBadge kind={kind} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});

describe('navigation', () => {
  it('covers every demo area with a unique path', () => {
    const hrefs = NAV_ITEMS.map((item) => item.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(hrefs).toContain('/objects');
    expect(hrefs).toContain('/workflows');
  });

  it('resolves a nav item for a known path', () => {
    expect(navItemFor('/analytics')?.label).toBe('Analytics');
    expect(navItemFor('/unknown')).toBeUndefined();
  });
});
