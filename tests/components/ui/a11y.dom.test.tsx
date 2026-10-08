import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UserMenu } from '@/components/layout/user-menu';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SegmentedControl } from '@/components/ui/radio-group';
import { Sheet } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Toaster, toast } from '@/components/ui/toast';
import { UserProvider } from '@/lib/user-context';
import { axeViolations } from '../axe';
import { renderUi } from '../render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, replace: () => {}, push: () => {} }),
  usePathname: () => '/',
}));

afterEach(() => {
  act(() => toast.dismissAll());
});

// axe-core finds what a hand-written assertion would not think to look for (invalid roles, list
// structure, names). Real layout is not available here: the same checks run in Chromium for the
// header in layout/user-menu.layout.test.tsx.
describe('axe-core finds no violations', () => {
  it.each(['en', 'ar'] as const)(
    'in the toast regions with every kind of toast (%s)',
    async (locale) => {
      renderUi(<Toaster />, { locale });
      act(() => {
        toast.info('Started', { duration: Infinity });
        toast.success('Saved', { description: 'All changes are in', duration: Infinity });
        toast.warning('Low credits', {
          duration: Infinity,
          action: { label: 'Top up', onClick() {} },
        });
        toast.error('Failed', { description: 'Try again', duration: Infinity });
      });
      expect(await axeViolations(document.body)).toEqual([]);
    },
  );

  it('in an open dialog, an alert dialog and a sheet', async () => {
    renderUi(
      <>
        <Dialog open onOpenChange={() => {}} title="Share" description="Anyone with the link">
          <Input aria-label="Link" />
        </Dialog>
        <Dialog
          open
          onOpenChange={() => {}}
          role="alertdialog"
          dismissible={false}
          title="Delete it?"
          footer={<Button>Delete</Button>}
        />
        <Sheet open onOpenChange={() => {}} title="Menu" side="end" hideTitle />
      </>,
    );
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it('in an open menu with items, links, radios and separators', async () => {
    const user = userEvent.setup();
    renderUi(
      <DropdownMenu label="Actions" trigger={<button>Menu</button>}>
        <DropdownMenuLabel>Creation</DropdownMenuLabel>
        <DropdownMenuItem href="/studio" data-testid="studio">
          Studio
        </DropdownMenuItem>
        <DropdownMenuItem destructive>Delete</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup label="Theme" value="dark" onValueChange={() => {}}>
          <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenu>,
    );
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it('in the account menu, closed and open, for a signed-in user', async () => {
    const user = userEvent.setup();
    renderUi(
      <UserProvider
        initialUser={{
          id: 'usr_1',
          email: 'layla@example.com',
          name: 'Layla Hassan',
          role: 'user',
          locale: 'en',
          creditBalance: 50,
        }}
      >
        <UserMenu />
      </UserProvider>,
    );
    expect(await axeViolations(document.body)).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it('in form controls wired to a Field, a segmented control and tabs', async () => {
    renderUi(
      <form>
        <Field label="Name" hint="As on your card">
          <Input />
        </Field>
        <Field label="Email" error="Enter a valid email">
          <Input type="email" />
        </Field>
        <Checkbox label="Remember me" description="On this device" />
        <Switch label="Public" />
        <SegmentedControl
          aria-label="Kind"
          defaultValue="image"
          options={[
            { value: 'image', label: 'Image' },
            { value: 'video', label: 'Video' },
          ]}
        />
        <Tabs defaultValue="one" appearance="pills">
          <TabsList aria-label="Sections">
            <TabsTrigger value="one">One</TabsTrigger>
            <TabsTrigger value="two">Two</TabsTrigger>
          </TabsList>
          <TabsContent value="one">Panel one</TabsContent>
        </Tabs>
      </form>,
    );
    expect(await axeViolations(document.body)).toEqual([]);
  });
});
