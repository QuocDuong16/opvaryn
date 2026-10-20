import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { navItemFor, navItemsFor, NAV_ITEMS } from '@/app/nav';
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
  it('covers every workspace area with a unique path', () => {
    const hrefs = NAV_ITEMS.map((item) => item.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(hrefs).toContain('/objects');
    expect(hrefs).toContain('/workflows');
    expect(hrefs).toContain('/roadmap');
  });

  it('leaves the public front page and the sign-in screen out of the workspace nav', () => {
    const hrefs = NAV_ITEMS.map((item) => item.href);
    expect(hrefs).not.toContain('/');
    expect(hrefs).not.toContain('/login');
    expect(hrefs).toContain('/overview');
  });

  it('numbers the areas without gaps or repeats', () => {
    const indices = NAV_ITEMS.map((item) => item.index);
    expect(new Set(indices).size).toBe(indices.length);
    expect(indices).toEqual(NAV_ITEMS.map((_, position) => String(position + 1).padStart(2, '0')));
  });

  it('states what each area does, for the sidebar tooltip and the tour', () => {
    for (const item of NAV_ITEMS) {
      expect(item.description.length).toBeGreaterThan(10);
    }
  });

  it('resolves a nav item for a known path', () => {
    expect(navItemFor('/analytics')?.label).toBe('Báo cáo');
    expect(navItemFor('/unknown')).toBeUndefined();
  });

  it('shows the product screens to everyone and the administrator screens by role', () => {
    const everyday = navItemsFor(false, false).map((item) => item.href);
    expect(everyday).toContain('/tasks');
    expect(everyday).not.toContain('/admin');
    expect(everyday).not.toContain('/settings');
    expect(everyday).not.toContain('/roadmap');

    const administrator = navItemsFor(true, false).map((item) => item.href);
    expect(administrator).toContain('/admin');
    expect(administrator).not.toContain('/settings');
    expect(administrator).not.toContain('/roadmap');

    const advanced = navItemsFor(true, true).map((item) => item.href);
    expect(advanced).toContain('/admin');
    expect(advanced).toContain('/settings');
    expect(advanced).toContain('/roadmap');
  });

  it('resolves nested routes to their area', () => {
    expect(navItemFor('/objects/asset')?.label).toBe('Dữ liệu');
    expect(navItemFor('/objects/asset')?.href).toBe('/objects');
    expect(navItemFor('/admin/users')?.label).toBe('Quản trị');
    expect(navItemFor('/admin/users')?.href).toBe('/admin');
  });
});
