import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { renderUi } from '../render';

function Demo({
  onValueChange,
  activation,
}: {
  onValueChange?: (v: string) => void;
  activation?: 'automatic' | 'manual';
}) {
  return (
    <Tabs defaultValue="one" onValueChange={onValueChange} activation={activation}>
      <TabsList aria-label="Sections">
        <TabsTrigger value="one">One</TabsTrigger>
        <TabsTrigger value="two">Two</TabsTrigger>
        <TabsTrigger value="off" disabled>
          Off
        </TabsTrigger>
        <TabsTrigger value="three">Three</TabsTrigger>
      </TabsList>
      <TabsContent value="one">Panel one</TabsContent>
      <TabsContent value="two">Panel two</TabsContent>
      <TabsContent value="three">Panel three</TabsContent>
    </Tabs>
  );
}

const tab = (name: string) => screen.getByRole('tab', { name });

describe('Tabs', () => {
  it('wires tab, tablist and tabpanel together', () => {
    renderUi(<Demo />);
    expect(screen.getByRole('tablist', { name: 'Sections' })).toBeInTheDocument();
    expect(tab('One')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Two')).toHaveAttribute('aria-selected', 'false');
    const panel = screen.getByRole('tabpanel', { name: 'One' });
    expect(panel).toHaveTextContent('Panel one');
    expect(tab('One')).toHaveAttribute('aria-controls', panel.id);
    expect(screen.queryByText('Panel two')).not.toBeInTheDocument();
  });

  it('only the selected tab is in the Tab order', () => {
    renderUi(<Demo />);
    expect(tab('One')).toHaveAttribute('tabindex', '0');
    expect(tab('Two')).toHaveAttribute('tabindex', '-1');
  });

  it('clicking selects and notifies', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    renderUi(<Demo onValueChange={onValueChange} />);
    await user.click(tab('Two'));
    expect(onValueChange).toHaveBeenCalledWith('two');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Panel two');
  });

  it('ArrowRight/ArrowLeft move and select, skipping disabled tabs and wrapping (LTR)', async () => {
    const user = userEvent.setup();
    renderUi(<Demo />);
    tab('One').focus();
    await user.keyboard('{ArrowRight}');
    expect(tab('Two')).toHaveFocus();
    expect(tab('Two')).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowRight}');
    expect(tab('Three')).toHaveFocus(); // "Off" is disabled
    await user.keyboard('{ArrowRight}');
    expect(tab('One')).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(tab('Three')).toHaveFocus();
    await user.keyboard('{Home}');
    expect(tab('One')).toHaveFocus();
    await user.keyboard('{End}');
    expect(tab('Three')).toHaveFocus();
  });

  it('arrow keys are mirrored in RTL: ArrowLeft goes to the next tab', async () => {
    const user = userEvent.setup();
    renderUi(<Demo />, { locale: 'ar' });
    tab('One').focus();
    await user.keyboard('{ArrowLeft}');
    expect(tab('Two')).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(tab('One')).toHaveFocus();
  });

  it('manual activation moves focus on arrows and selects on Enter or Space', async () => {
    const user = userEvent.setup();
    renderUi(<Demo activation="manual" />);
    tab('One').focus();
    await user.keyboard('{ArrowRight}');
    expect(tab('Two')).toHaveFocus();
    expect(tab('Two')).toHaveAttribute('aria-selected', 'false');
    await user.keyboard('{Enter}');
    expect(tab('Two')).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps inactive panels mounted but hidden when asked', () => {
    renderUi(
      <Tabs defaultValue="a">
        <TabsList aria-label="T">
          <TabsTrigger value="a">A</TabsTrigger>
          <TabsTrigger value="b">B</TabsTrigger>
        </TabsList>
        <TabsContent value="a">A body</TabsContent>
        <TabsContent value="b" keepMounted>
          B body
        </TabsContent>
      </Tabs>,
    );
    expect(screen.getByText('B body')).not.toBeVisible();
  });

  it('is controllable', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    renderUi(
      <Tabs value="a" onValueChange={onValueChange}>
        <TabsList aria-label="T">
          <TabsTrigger value="a">A</TabsTrigger>
          <TabsTrigger value="b">B</TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    await user.click(tab('B'));
    expect(onValueChange).toHaveBeenCalledWith('b');
    expect(tab('A')).toHaveAttribute('aria-selected', 'true');
  });
});
