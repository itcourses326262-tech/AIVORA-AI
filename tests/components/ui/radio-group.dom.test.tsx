import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RadioGroup, SegmentedControl, type RadioOption } from '@/components/ui/radio-group';
import { renderUi } from '../render';

const OPTIONS: RadioOption[] = [
  { value: 'a', label: 'Alpha', description: 'First' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma', disabled: true },
  { value: 'd', label: 'Delta' },
];

const radio = (name: string) => screen.getByRole('radio', { name });

describe('RadioGroup', () => {
  it('is a radiogroup of radios with the selected one checked and described', () => {
    renderUi(<RadioGroup aria-label="Letters" options={OPTIONS} defaultValue="b" />);
    expect(screen.getByRole('radiogroup', { name: 'Letters' })).toBeInTheDocument();
    expect(radio('Beta')).toHaveAttribute('aria-checked', 'true');
    expect(radio('Alpha')).toHaveAttribute('aria-checked', 'false');
    expect(radio('Alpha')).toHaveAccessibleDescription('First');
  });

  it('keeps only the selected radio in the Tab order (roving tabindex)', () => {
    renderUi(<RadioGroup aria-label="L" options={OPTIONS} defaultValue="b" />);
    expect(radio('Beta')).toHaveAttribute('tabindex', '0');
    expect(radio('Alpha')).toHaveAttribute('tabindex', '-1');
    expect(radio('Delta')).toHaveAttribute('tabindex', '-1');
  });

  it('makes the first enabled radio the tab stop when nothing is selected', () => {
    renderUi(<RadioGroup aria-label="L" options={OPTIONS} />);
    expect(radio('Alpha')).toHaveAttribute('tabindex', '0');
    expect(radio('Beta')).toHaveAttribute('tabindex', '-1');
  });

  it('arrow keys move focus and select, skip disabled options and wrap', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    renderUi(
      <RadioGroup
        aria-label="L"
        options={OPTIONS}
        defaultValue="a"
        onValueChange={onValueChange}
      />,
    );
    radio('Alpha').focus();
    await user.keyboard('{ArrowDown}');
    expect(radio('Beta')).toHaveFocus();
    expect(radio('Beta')).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{ArrowDown}');
    expect(radio('Delta')).toHaveFocus(); // Gamma is disabled
    await user.keyboard('{ArrowDown}');
    expect(radio('Alpha')).toHaveFocus(); // wrapped
    await user.keyboard('{ArrowUp}');
    expect(radio('Delta')).toHaveFocus();
    await user.keyboard('{Home}');
    expect(radio('Alpha')).toHaveFocus();
    await user.keyboard('{End}');
    expect(radio('Delta')).toHaveFocus();
    expect(onValueChange.mock.calls.map(([value]) => value)).toEqual([
      'b',
      'd',
      'a',
      'd',
      'a',
      'd',
    ]);
  });

  it('horizontal arrows follow the reading direction: ArrowRight goes forward in LTR', async () => {
    const user = userEvent.setup();
    renderUi(
      <RadioGroup aria-label="L" options={OPTIONS} defaultValue="a" orientation="horizontal" />,
    );
    radio('Alpha').focus();
    await user.keyboard('{ArrowRight}');
    expect(radio('Beta')).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(radio('Alpha')).toHaveFocus();
  });

  it('horizontal arrows are mirrored in RTL: ArrowLeft goes forward', async () => {
    const user = userEvent.setup();
    renderUi(
      <RadioGroup aria-label="L" options={OPTIONS} defaultValue="a" orientation="horizontal" />,
      {
        locale: 'ar',
      },
    );
    radio('Alpha').focus();
    await user.keyboard('{ArrowLeft}');
    expect(radio('Beta')).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(radio('Alpha')).toHaveFocus();
  });

  it('does not select a disabled option by click, and a disabled group ignores keys', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    renderUi(
      <>
        <RadioGroup aria-label="One" options={OPTIONS} onValueChange={onValueChange} />
        <RadioGroup aria-label="Two" options={OPTIONS} disabled onValueChange={onValueChange} />
      </>,
    );
    const [first, second] = screen.getAllByRole('radiogroup');
    await user.click(first!.querySelectorAll<HTMLElement>('[role="radio"]')[2]!);
    expect(onValueChange).not.toHaveBeenCalled();
    await user.click(second!.querySelectorAll<HTMLElement>('[role="radio"]')[0]!);
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('submits the chosen value with a form', async () => {
    const user = userEvent.setup();
    renderUi(
      <form data-testid="form">
        <RadioGroup aria-label="L" name="letter" options={OPTIONS} />
      </form>,
    );
    await user.click(radio('Delta'));
    expect(new FormData(screen.getByTestId('form') as HTMLFormElement).get('letter')).toBe('d');
  });
});

describe('SegmentedControl', () => {
  it('has radio semantics with a label per segment', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    renderUi(
      <SegmentedControl
        aria-label="Kind"
        options={[
          { value: 'image', label: 'Image' },
          { value: 'video', label: 'Video' },
        ]}
        value="image"
        onValueChange={onValueChange}
      />,
    );
    expect(screen.getByRole('radiogroup', { name: 'Kind' })).toBeInTheDocument();
    expect(radio('Image')).toHaveAttribute('aria-checked', 'true');
    await user.click(radio('Video'));
    expect(onValueChange).toHaveBeenCalledWith('video');
  });

  it('moves with arrows, mirrored in RTL', async () => {
    const user = userEvent.setup();
    renderUi(
      <SegmentedControl
        aria-label="Kind"
        defaultValue="image"
        options={[
          { value: 'image', label: 'صورة' },
          { value: 'video', label: 'فيديو' },
        ]}
      />,
      { locale: 'ar' },
    );
    radio('صورة').focus();
    await user.keyboard('{ArrowLeft}');
    expect(radio('فيديو')).toHaveFocus();
    expect(radio('فيديو')).toHaveAttribute('aria-checked', 'true');
  });
});
