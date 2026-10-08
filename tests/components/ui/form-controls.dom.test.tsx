import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { renderUi } from '../render';

describe('Field', () => {
  it('labels the control and marks it required', () => {
    renderUi(
      <Field label="Email" required>
        <Input />
      </Field>,
    );
    const input = screen.getByRole('textbox', { name: /Email/ });
    expect(input).toBeRequired();
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('wires the hint and the error into aria-describedby and flags the control invalid', () => {
    renderUi(
      <Field label="Password" hint="At least 8 characters" error="Too short">
        <Input type="text" />
      </Field>,
    );
    const input = screen.getByRole('textbox', { name: 'Password' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('At least 8 characters Too short');
    // The error is announced when it appears.
    expect(screen.getByRole('alert')).toHaveTextContent('Too short');
  });

  it('works for Textarea, Select, Checkbox and Switch too', () => {
    renderUi(
      <>
        <Field label="Prompt" error="Required">
          <Textarea />
        </Field>
        <Field label="Model" hint="Pick one">
          <Select>
            <option>A</option>
          </Select>
        </Field>
        <Field label="Terms" error="Accept first">
          <Checkbox />
        </Field>
        <Field label="Public" hint="Visible to all">
          <Switch />
        </Field>
      </>,
    );
    expect(screen.getByRole('textbox', { name: 'Prompt' })).toBeInvalid();
    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveAccessibleDescription('Pick one');
    expect(screen.getByRole('checkbox', { name: 'Terms' })).toBeInvalid();
    expect(screen.getByRole('switch', { name: 'Public' })).toHaveAccessibleDescription(
      'Visible to all',
    );
  });

  it('hides the label visually but keeps it for assistive technology', () => {
    renderUi(
      <Field label="Search" hideLabel>
        <Input />
      </Field>,
    );
    expect(screen.getByText('Search')).toHaveClass('sr-only');
    expect(screen.getByRole('textbox', { name: 'Search' })).toBeInTheDocument();
  });

  it('localizes the optional marker', () => {
    renderUi(
      <Field label="الاسم" optional>
        <Input />
      </Field>,
      { locale: 'ar' },
    );
    expect(screen.getByText('(اختياري)')).toBeInTheDocument();
  });
});

describe('Input', () => {
  it('renders adornments inside the box, in DOM order, and forwards props to the input', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderUi(
      <Input
        aria-label="Query"
        placeholder="Search"
        startAdornment={<Search data-testid="icon" />}
        endAdornment={<kbd>/</kbd>}
        onChange={onChange}
      />,
    );
    const input = screen.getByRole('textbox', { name: 'Query' });
    await user.type(input, 'ab');
    expect(onChange).toHaveBeenCalledTimes(2);
    const box = input.parentElement as HTMLElement;
    expect(box.firstElementChild).toContainElement(screen.getByTestId('icon'));
    expect(box.lastElementChild).toHaveTextContent('/');
  });

  it('can be marked invalid without a Field', () => {
    renderUi(<Input aria-label="Name" invalid />);
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeInvalid();
  });
});

describe('Textarea', () => {
  it('counts characters, localizes the digits and gives screen readers a sentence', async () => {
    const user = userEvent.setup();
    renderUi(<Textarea aria-label="Prompt" maxLength={20} showCount />, { locale: 'ar' });
    await user.type(screen.getByRole('textbox', { name: 'Prompt' }), 'abc');
    expect(screen.getByText('٣ / ٢٠')).toBeInTheDocument();
    expect(screen.getByText('٣ من ٢٠ حرفًا')).toHaveClass('sr-only');
    expect(screen.getByRole('textbox', { name: 'Prompt' })).toHaveAccessibleDescription(
      expect.stringContaining('٣ من ٢٠ حرفًا'),
    );
  });

  it('turns the counter warning and then danger as the limit nears', async () => {
    renderUi(<Textarea aria-label="P" maxLength={20} showCount defaultValue={'x'.repeat(19)} />);
    expect(screen.getByText('19 / 20').closest('p')).toHaveClass('text-warning');
    renderUi(<Textarea aria-label="Q" maxLength={5} showCount defaultValue="12345" />);
    expect(screen.getByText('5 / 5').closest('p')).toHaveClass('text-danger');
  });

  it('grows with its content up to a cap when autoGrow is set', () => {
    renderUi(<Textarea aria-label="Grow" autoGrow maxRows={4} />);
    const textarea = screen.getByRole('textbox', { name: 'Grow' });
    Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 120 });
    fireEvent.change(textarea, { target: { value: 'a\nb\nc' } });
    expect(textarea.style.height).toBe('120px');
    // 4 rows of 1.5em plus the vertical padding.
    expect(textarea.style.maxHeight).toBe('calc(6em + 1.25rem)');
    expect(textarea).toHaveClass('resize-none');
  });

  it('works controlled and uncontrolled', async () => {
    const user = userEvent.setup();
    function Controlled() {
      const [value, setValue] = useState('');
      return (
        <Textarea
          aria-label="C"
          value={value}
          maxLength={10}
          showCount
          onChange={(event) => setValue(event.target.value.toUpperCase())}
        />
      );
    }
    renderUi(<Controlled />);
    await user.type(screen.getByRole('textbox', { name: 'C' }), 'hey');
    expect(screen.getByRole('textbox', { name: 'C' })).toHaveValue('HEY');
    expect(screen.getByText('3 / 10')).toBeInTheDocument();
  });
});

describe('Select', () => {
  it('is a native select that can be changed with the keyboard', async () => {
    const user = userEvent.setup();
    renderUi(
      <Select aria-label="Model" defaultValue="a">
        <option value="a">Alpha</option>
        <option value="b">Beta</option>
      </Select>,
    );
    const select = screen.getByRole('combobox', { name: 'Model' });
    await user.selectOptions(select, 'b');
    expect(select).toHaveValue('b');
  });
});

describe('Checkbox', () => {
  it('is toggled by clicking its label or pressing Space', async () => {
    const user = userEvent.setup();
    renderUi(<Checkbox label="Remember me" description="On this device" />);
    const box = screen.getByRole('checkbox', { name: 'Remember me' });
    expect(box).toHaveAccessibleDescription('On this device');
    await user.click(screen.getByText('Remember me'));
    expect(box).toBeChecked();
    box.focus();
    await user.keyboard(' ');
    expect(box).not.toBeChecked();
  });

  it('exposes the mixed state', () => {
    renderUi(<Checkbox label="Some" indeterminate readOnly />);
    const box = screen.getByRole('checkbox', { name: 'Some' }) as HTMLInputElement;
    expect(box.indeterminate).toBe(true);
    expect(box).toHaveAttribute('aria-checked', 'mixed');
  });
});

describe('Switch', () => {
  it('is a switch that Space and Enter toggle, reporting aria-checked', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    renderUi(<Switch label="Make public" onCheckedChange={onCheckedChange} />);
    const toggle = screen.getByRole('switch', { name: 'Make public' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    toggle.focus();
    await user.keyboard(' ');
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(onCheckedChange.mock.calls).toEqual([[true], [false]]);
  });

  it('is toggled by its label and can be controlled', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    renderUi(<Switch label="Controlled" checked={false} onCheckedChange={onCheckedChange} />);
    await user.click(screen.getByText('Controlled'));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
    // The parent did not accept the change, so it stays off.
    expect(screen.getByRole('switch', { name: 'Controlled' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('submits its name with a form while on', async () => {
    const user = userEvent.setup();
    renderUi(
      <form data-testid="form">
        <Switch aria-label="Public" name="public" defaultChecked />
      </form>,
    );
    expect(new FormData(screen.getByTestId('form') as HTMLFormElement).get('public')).toBe('on');
    await user.click(screen.getByRole('switch', { name: 'Public' }));
    expect(new FormData(screen.getByTestId('form') as HTMLFormElement).get('public')).toBeNull();
  });

  it('does nothing when disabled', async () => {
    const user = userEvent.setup();
    renderUi(<Switch aria-label="Off" disabled />);
    await user.click(screen.getByRole('switch', { name: 'Off' }));
    expect(screen.getByRole('switch', { name: 'Off' })).toHaveAttribute('aria-checked', 'false');
  });
});
