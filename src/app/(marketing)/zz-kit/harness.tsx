'use client';

import { useState } from 'react';
import { UserMenu } from '@/components/layout/user-menu';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog } from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';
import { SegmentedControl } from '@/components/ui/radio-group';
import { Sheet } from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';
import { UserProvider } from '@/lib/user-context';

export function Harness({ initiallyOpen }: { initiallyOpen: boolean }) {
  const [sheet, setSheet] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [initial, setInitial] = useState(initiallyOpen);
  const [kind, setKind] = useState('image');
  return (
    <div className="grid gap-8">
      <section className="grid gap-3 rounded-2xl border border-border bg-surface p-5">
        <h2 className="text-lg font-semibold">Controls</h2>
        <Checkbox label="Unchecked" />
        <Checkbox label="Checked" defaultChecked />
        <Checkbox label="Mixed" indeterminate readOnly />
        <p>
          <Kbd>Ctrl</Kbd> + <Kbd>Enter</Kbd>
        </p>
        <SegmentedControl
          aria-label="Kind"
          value={kind}
          onValueChange={setKind}
          options={[
            { value: 'image', label: 'Image' },
            { value: 'video', label: 'Video' },
            { value: 'audio', label: 'Audio' },
          ]}
        />
        <Tabs defaultValue="all" appearance="pills">
          <TabsList aria-label="Filter">
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="mine">Mine</TabsTrigger>
            <TabsTrigger value="fav">Favorites</TabsTrigger>
          </TabsList>
        </Tabs>
      </section>

      <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-surface p-5">
        <UserProvider
          initialUser={{
            id: 'usr_1',
            email: 'preview@aivore.local',
            name: 'Preview User',
            role: 'user',
            locale: 'en',
            creditBalance: 50,
          }}
        >
          <UserMenu />
        </UserProvider>
        <Button
          id="progress"
          onClick={() => {
            toast({ id: 'gen', title: 'Generating…', duration: Infinity });
            setTimeout(
              () => toast({ id: 'gen', title: 'Done', variant: 'success', duration: 4000 }),
              800,
            );
          }}
        >
          Progress toast
        </Button>
        <Button variant="secondary" onClick={() => setSheet(true)}>
          Open sheet
        </Button>
      </section>

      <Sheet open={sheet} onOpenChange={setSheet} title="Details" side="end">
        <Button variant="danger" onClick={() => setConfirm(true)}>
          Delete
        </Button>
      </Sheet>
      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        role="alertdialog"
        dismissible={false}
        title="Delete it?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(false)}>
              Keep
            </Button>
            <Button variant="secondary" className="hidden" onClick={() => setConfirm(false)}>
              Hidden
            </Button>
          </>
        }
      >
        Really delete this?
      </Dialog>
      <Dialog open={initial} onOpenChange={setInitial} title="Open at load">
        <Button>Top up</Button>
      </Dialog>
    </div>
  );
}
