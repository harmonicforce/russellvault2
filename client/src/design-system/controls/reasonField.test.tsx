// @vitest-environment jsdom
//
// Behavioral acceptance for ReasonField.
//
// The control this replaces is `window.prompt()`, which cannot be labelled,
// described, required, validated, disabled, or reached usefully by assistive
// technology. Each of those is asserted here against the rendered DOM.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { ReasonField } from './ReasonField';

afterEach(cleanup);

function Harness(props: Partial<Parameters<typeof ReasonField>[0]> = {}) {
  const [value, setValue] = useState('');
  return <ReasonField value={value} onChange={setValue} {...props} />;
}

describe('ReasonField', () => {
  it('renders a labelled multiline control by default', () => {
    render(<Harness />);
    const control = screen.getByLabelText(/Reason/);
    expect(control.tagName).toBe('TEXTAREA');
  });

  it('supports a single-line reason where a paragraph would be noise', () => {
    render(<Harness multiline={false} />);
    const control = screen.getByLabelText(/Reason/);
    expect(control.tagName).toBe('INPUT');
  });

  it("takes the caller-supplied label and description", () => {
    render(<Harness label="Why is this line excluded?" description="Recorded in the immutable history." />);
    const control = screen.getByLabelText(/Why is this line excluded\?/);
    const describedBy = control.getAttribute('aria-describedby')!;
    expect(document.getElementById(describedBy.split(' ')[0])!.textContent).toBe(
      'Recorded in the immutable history.',
    );
  });

  it('exposes required through the control, not only through an asterisk', () => {
    render(<Harness required />);
    expect((screen.getByLabelText(/Reason/) as HTMLTextAreaElement).required).toBe(true);
  });

  it('links a caller-supplied error to the control and announces it', () => {
    render(<Harness error="A reason is required for this correction." />);
    const control = screen.getByLabelText(/Reason/);
    expect(control.getAttribute('aria-invalid')).toBe('true');
    const errorId = control.getAttribute('aria-describedby')!;
    expect(document.getElementById(errorId)!.textContent).toBe('A reason is required for this correction.');
    expect(screen.getByRole('alert').textContent).toBe('A reason is required for this correction.');
  });

  it('is not invalid when the caller reports no error', () => {
    render(<Harness />);
    expect(screen.getByLabelText(/Reason/).getAttribute('aria-invalid')).toBeNull();
  });

  it('accepts typing and reflects it back', () => {
    render(<Harness />);
    const control = screen.getByLabelText(/Reason/) as HTMLTextAreaElement;
    fireEvent.change(control, { target: { value: 'Duplicate of RV-LOT-0009.' } });
    expect(control.value).toBe('Duplicate of RV-LOT-0009.');
  });

  // The recorded reason and the displayed reason must be the same string, so
  // nothing here trims, collapses, or normalises what the operator typed.
  it('passes the caller exactly the value the operator entered', () => {
    const onChange = vi.fn();
    render(<ReasonField value="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: '  Miscounted during cycle count  ' } });
    expect(onChange).toHaveBeenCalledWith('  Miscounted during cycle count  ');
  });

  it('applies caller-supplied character constraints without inventing any', () => {
    render(<Harness maxLength={240} minLength={4} />);
    const control = screen.getByLabelText(/Reason/) as HTMLTextAreaElement;
    expect(control.maxLength).toBe(240);
    expect(control.minLength).toBe(4);

    cleanup();
    render(<Harness />);
    const unbounded = screen.getByLabelText(/Reason/) as HTMLTextAreaElement;
    // No bound the caller did not ask for.
    expect(unbounded.maxLength).toBe(-1);
  });

  it('reports remaining characters in a live region when a bound exists', () => {
    render(<Harness maxLength={100} />);
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Miscounted' } });
    expect(screen.getByRole('status').textContent).toBe('10 of 100 characters');
  });

  it('shows no character count when the caller sets no bound', () => {
    render(<Harness />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('is disabled while the caller reports a pending mutation', () => {
    render(<Harness disabled />);
    expect((screen.getByLabelText(/Reason/) as HTMLTextAreaElement).disabled).toBe(true);
  });

  // The whole point of the component.
  it('depends on no browser prompt', () => {
    const prompt = vi.spyOn(window, 'prompt');
    render(<Harness />);
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'A reason.' } });
    expect(prompt).not.toHaveBeenCalled();
    prompt.mockRestore();
  });

  it('validates nothing itself — an empty required field is not self-marked invalid', () => {
    // Whether empty is invalid, and when, is the workflow's rule. The field
    // renders the caller's verdict and forms none of its own.
    render(<Harness required />);
    expect(screen.getByLabelText(/Reason/).getAttribute('aria-invalid')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
