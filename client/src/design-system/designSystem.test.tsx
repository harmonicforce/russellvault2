// @vitest-environment jsdom
//
// Behavioral acceptance for the S1.6.1 house primitives.
//
// Every assertion here RENDERS the component and inspects the resulting DOM
// and accessibility tree. Nothing reads component source: a primitive whose
// implementation mentions `aria-label` but never puts one in the document must
// fail this file.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Alert, Button, Field, IconButton, RootErrorBoundary, StatusPill } from './index';

afterEach(cleanup);

describe('Button', () => {
  it('renders a native button element', () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.tagName).toBe('BUTTON');
  });

  // An unset type inside a form submits it. That has meant "cancel saved the
  // record" often enough to be worth pinning.
  it('always carries an explicit type, defaulting to button', () => {
    render(<Button>Cancel</Button>);
    expect(screen.getByRole('button', { name: 'Cancel' }).getAttribute('type')).toBe('button');
  });

  it('lets a caller opt into submit deliberately', () => {
    render(<Button type="submit">Search</Button>);
    expect(screen.getByRole('button', { name: 'Search' }).getAttribute('type')).toBe('submit');
  });

  it('fills the primary variant with the brand accent and its paired foreground', () => {
    render(<Button variant="primary">Record payment</Button>);
    const button = screen.getByRole('button', { name: 'Record payment' });
    expect(button.getAttribute('data-variant')).toBe('primary');
    expect(button.className).toContain('bg-accent');
    // The dark theme's brand fill is a bright gold; a white label on it is
    // ~1.9:1, so the paired token is what must be used, never text-white.
    expect(button.className).toContain('text-on-accent');
    expect(button.className).not.toContain('text-white');
  });

  // Gold is structure. It must never be the signal that something is about to
  // be destroyed.
  it('renders the destructive variant in critical semantics, never in brand gold', () => {
    render(<Button variant="destructive">Delete</Button>);
    const button = screen.getByRole('button', { name: 'Delete' });
    expect(button.getAttribute('data-variant')).toBe('destructive');
    expect(button.className).toContain('bg-critical');
    expect(button.className).not.toContain('accent');
  });

  it('exposes every variant distinctly', () => {
    render(
      <>
        <Button variant="primary">A</Button>
        <Button variant="secondary">B</Button>
        <Button variant="quiet">C</Button>
        <Button variant="destructive">D</Button>
      </>,
    );
    const tones = ['A', 'B', 'C', 'D'].map((n) => screen.getByRole('button', { name: n }).getAttribute('data-variant'));
    expect(tones).toEqual(['primary', 'secondary', 'quiet', 'destructive']);
  });

  it('does not invoke its action while disabled', () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Confirm
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  // A pending control stays disabled through the caller's own flag; the
  // primitive must not swallow or override that.
  it('supports a caller-driven pending-disabled state', () => {
    const onClick = vi.fn();
    render(
      <Button disabled aria-busy onClick={onClick}>
        Saving
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Saving' });
    expect(button.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  // Keyboard operators must be able to see where they are. The browser default
  // ring disappears against several of our surfaces, so the contract is that
  // the component supplies its own focus-visible treatment.
  it('carries a focus-visible treatment and is keyboard focusable', () => {
    render(<Button>Focusable</Button>);
    const button = screen.getByRole('button', { name: 'Focusable' });
    expect(button.className).toContain('focus-visible:outline');
    button.focus();
    expect(document.activeElement).toBe(button);
  });
});

describe('IconButton', () => {
  it('puts the accessible name in the document', () => {
    render(
      <IconButton label="Refresh acquisitions">
        <svg />
      </IconButton>,
    );
    expect(screen.getByRole('button', { name: 'Refresh acquisitions' })).toBeTruthy();
  });

  // The glyph must not be announced as content — the button's name is the name.
  it('hides the decorative glyph from assistive technology', () => {
    render(
      <IconButton label="Close">
        <svg data-testid="glyph" />
      </IconButton>,
    );
    const button = screen.getByRole('button', { name: 'Close' });
    expect(within(button).getByTestId('glyph').closest('[aria-hidden="true"]')).toBeTruthy();
  });

  it('keeps a usable target regardless of glyph size', () => {
    render(
      <IconButton label="Menu">
        <svg />
      </IconButton>,
    );
    const button = screen.getByRole('button', { name: 'Menu' });
    expect(button.className).toContain('min-h-11');
    expect(button.className).toContain('min-w-11');
  });

  // A tooltip does not exist for touch or for a screen reader, so it may only
  // ever supplement the name.
  it('treats a tooltip as a supplement, never as the accessible name', () => {
    render(
      <IconButton label="Discard retry" tooltip="Discards the unconfirmed request">
        <svg />
      </IconButton>,
    );
    const button = screen.getByRole('button', { name: 'Discard retry' });
    expect(button.getAttribute('title')).toBe('Discards the unconfirmed request');
    expect(button.getAttribute('aria-label')).toBe('Discard retry');
  });

  it('is explicitly typed like every other house button', () => {
    render(
      <IconButton label="Settings">
        <svg />
      </IconButton>,
    );
    expect(screen.getByRole('button', { name: 'Settings' }).getAttribute('type')).toBe('button');
  });
});

describe('Field', () => {
  const renderField = (props: Partial<Parameters<typeof Field>[0]> = {}) =>
    render(
      <Field label="Reason" {...props}>
        {(control) => <textarea {...control} />}
      </Field>,
    );

  it('associates the label with the control', () => {
    renderField();
    expect(screen.getByLabelText('Reason')).toBeTruthy();
  });

  it('references the description from the control', () => {
    renderField({ description: 'Explain why this line is excluded.' });
    const control = screen.getByLabelText('Reason');
    const described = control.getAttribute('aria-describedby');
    expect(described).toBeTruthy();
    expect(document.getElementById(described!.split(' ')[0])!.textContent).toBe('Explain why this line is excluded.');
  });

  it('references the error from the control and marks it invalid', () => {
    renderField({ error: 'A reason is required.' });
    const control = screen.getByLabelText('Reason');
    expect(control.getAttribute('aria-invalid')).toBe('true');
    const described = control.getAttribute('aria-describedby')!;
    expect(document.getElementById(described)!.textContent).toBe('A reason is required.');
  });

  // Guidance and failure must both be announced; one must not replace the other.
  it('references description and error together when both are present', () => {
    renderField({ description: 'Explain why.', error: 'A reason is required.' });
    const ids = screen.getByLabelText('Reason').getAttribute('aria-describedby')!.split(' ');
    expect(ids).toHaveLength(2);
    expect(ids.map((id) => document.getElementById(id)!.textContent)).toEqual(['Explain why.', 'A reason is required.']);
  });

  it('announces the error rather than leaving it silent below the control', () => {
    renderField({ error: 'A reason is required.' });
    expect(screen.getByRole('alert').textContent).toBe('A reason is required.');
  });

  it('is not invalid when there is no error', () => {
    renderField({ description: 'Explain why.' });
    expect(screen.getByLabelText('Reason').getAttribute('aria-invalid')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  // The asterisk is decorative; the requirement must reach assistive tech.
  it('exposes required through the control, not only through an asterisk', () => {
    renderField({ required: true });
    expect((screen.getByLabelText(/Reason/) as HTMLTextAreaElement).required).toBe(true);
  });
});

describe('StatusPill', () => {
  it('always renders its label in words', () => {
    render(<StatusPill tone="critical">Excluded</StatusPill>);
    expect(screen.getByText('Excluded')).toBeTruthy();
  });

  // Colour is never the sole carrier of meaning.
  it.each([
    ['warning', 'Needs review'],
    ['critical', 'Excluded'],
    ['serious', 'Stale'],
    ['success', 'Included'],
    ['information', 'Partial'],
    ['neutral', 'Unknown'],
  ])('carries %s meaning in text, not colour alone', (tone, label) => {
    render(<StatusPill tone={tone as never}>{label}</StatusPill>);
    const pill = screen.getByText(label);
    expect(pill.textContent).toContain(label);
    expect(pill.getAttribute('data-tone')).toBe(tone);
  });

  it('never renders status in brand gold', () => {
    render(
      <>
        <StatusPill tone="warning">Needs review</StatusPill>
        <StatusPill tone="critical">Excluded</StatusPill>
      </>,
    );
    for (const label of ['Needs review', 'Excluded']) {
      expect(screen.getByText(label).className).not.toContain('accent');
    }
  });

  it('hides a supplementary glyph from assistive technology', () => {
    render(
      <StatusPill tone="warning" icon={<svg data-testid="pill-glyph" />}>
        Needs review
      </StatusPill>,
    );
    expect(screen.getByTestId('pill-glyph').closest('[aria-hidden="true"]')).toBeTruthy();
  });
});

describe('Alert', () => {
  it('renders title and body', () => {
    render(
      <Alert tone="warning" title="Coverage is partial">
        Governed and legacy counts must not be added together.
      </Alert>,
    );
    expect(screen.getByText('Coverage is partial')).toBeTruthy();
    expect(screen.getByText('Governed and legacy counts must not be added together.')).toBeTruthy();
  });

  it('renders body alone without a title', () => {
    render(<Alert tone="information">Historical purchases have not been imported.</Alert>);
    expect(screen.getByRole('status').textContent).toContain('Historical purchases have not been imported.');
  });

  // Assertive interruption is reserved for what warrants cutting across the
  // operator's reading; everything else reports.
  it.each([
    ['critical', 'alert'],
    ['serious', 'alert'],
    ['warning', 'status'],
    ['success', 'status'],
    ['information', 'status'],
  ])('gives %s the %s role', (tone, role) => {
    render(<Alert tone={tone as never}>Message</Alert>);
    expect(screen.getByRole(role).getAttribute('data-tone')).toBe(tone);
  });

  it('renders a recovery action when one is supplied', () => {
    render(
      <Alert tone="critical" title="Dependency unavailable" action={<Button>Retry</Button>}>
        No empty result has been assumed.
      </Alert>,
    );
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  // Raising the stakes must not raise the ornament: a critical alert gets
  // critical colour and an assertive role, not brand decoration.
  it('adds no brand decoration in the critical state', () => {
    render(<Alert tone="critical">Records could not be loaded.</Alert>);
    const alert = screen.getByRole('alert');
    expect(alert.className).toContain('critical');
    expect(alert.className).not.toContain('accent');
  });
});

describe('RootErrorBoundary', () => {
  const Boom = (): never => {
    throw new Error('secret stack detail: parseGovernedTotal at line 42');
  };

  // React logs a caught render error; silence it so a passing run is readable.
  const quiet = () => vi.spyOn(console, 'error').mockImplementation(() => {});

  // The rendered fallback's own text, whitespace-normalised so an assertion
  // survives a reflowed JSX line. This reads the DOM, never module source.
  const fallbackText = () => (screen.getByRole('alert').textContent ?? '').replace(/\s+/g, ' ').trim();

  it('catches an actual thrown render exception instead of blanking the screen', () => {
    const spy = quiet();
    const onError = vi.fn();
    render(
      <RootErrorBoundary onError={onError} onReload={() => {}}>
        <Boom />
      </RootErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(onError).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('renders children untouched when nothing throws', () => {
    render(
      <RootErrorBoundary onReload={() => {}}>
        <p>Acquisitions</p>
      </RootErrorBoundary>,
    );
    expect(screen.getByText('Acquisitions')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('explains the failure in plain language without leaking the stack', () => {
    const spy = quiet();
    render(
      <RootErrorBoundary onError={() => {}} onReload={() => {}}>
        <Boom />
      </RootErrorBoundary>,
    );
    const text = screen.getByRole('alert').textContent ?? '';
    expect(text).toContain('could not display this screen');
    expect(text).not.toContain('secret stack detail');
    expect(text).not.toContain('parseGovernedTotal');
    expect(text).not.toMatch(/at line \d+/);
    spy.mockRestore();
  });

  // A render fault is not a data fault, and saying so is what stops operators
  // treating a drawing bug as a records problem.
  it('says the failure is in the interface rather than in the records', () => {
    const spy = quiet();
    render(
      <RootErrorBoundary onError={() => {}} onReload={() => {}}>
        <Boom />
      </RootErrorBoundary>,
    );
    const text = fallbackText();
    expect(text).toMatch(/interface failed while displaying this screen/i);
    expect(text).toMatch(/fault in drawing the page/i);
    spy.mockRestore();
  });

  // The correction this suite exists to lock down.
  //
  // A component can throw during the rerender or refetch that FOLLOWS a
  // governed mutation which already committed. A render boundary cannot tell
  // that apart from a crash on first paint, so any reassurance about what did
  // or did not happen to the records is a fabricated fact — exactly what the
  // truth doctrine forbids. The fallback must state the uncertainty instead.
  it('states that it cannot know whether a previously submitted action completed', () => {
    const spy = quiet();
    render(
      <RootErrorBoundary onError={() => {}} onReload={() => {}}>
        <Boom />
      </RootErrorBoundary>,
    );
    const text = fallbackText();
    expect(text).toMatch(/cannot tell us whether an action you submitted just before it completed/i);
    spy.mockRestore();
  });

  it('sends the operator to verify authoritative state before repeating a consequential action', () => {
    const spy = quiet();
    render(
      <RootErrorBoundary onError={() => {}} onReload={() => {}}>
        <Boom />
      </RootErrorBoundary>,
    );
    const text = fallbackText();
    expect(text).toMatch(/reload/i);
    expect(text).toMatch(/verify the current state of the record/i);
    expect(text).toMatch(/before repeating any consequential action/i);
    spy.mockRestore();
  });

  // Each of these is a claim the boundary is not in a position to make. They
  // are asserted against the rendered DOM text, not against module source, so
  // the wording can be improved without the guard silently going slack.
  it.each([
    ['claim nothing was saved', /nothing[^.]*\bsaved\b/i],
    ['claim nothing was altered', /nothing[^.]*\b(altered|changed)\b/i],
    ['claim the records are definitely unchanged', /records (are|were|have been) (definitely )?(unchanged|untouched)/i],
    ['claim no change reached the records', /not a change to your records/i],
    ['claim the preceding operation failed', /(was not|were not|has not been|did not) (saved|submitted|completed|applied|recorded)/i],
    ['claim the preceding operation succeeded', /(your|the) (action|submission|change) (was|has been) (saved|completed|applied|recorded)/i],
  ])('does not %s', (_label, forbidden) => {
    const spy = quiet();
    render(
      <RootErrorBoundary onError={() => {}} onReload={() => {}}>
        <Boom />
      </RootErrorBoundary>,
    );
    expect(fallbackText()).not.toMatch(forbidden);
    spy.mockRestore();
  });

  it('offers a recovery affordance that actually fires', () => {
    const spy = quiet();
    const onReload = vi.fn();
    render(
      <RootErrorBoundary onError={() => {}} onReload={onReload}>
        <Boom />
      </RootErrorBoundary>,
    );
    fireEvent.click(screen.getByRole('button', { name: /reload/i }));
    expect(onReload).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  // Ordinary data errors stay the domain component's job. If the boundary
  // swallowed them, every "dependency unavailable" would read as "the app
  // broke" and operators would learn to ignore both.
  it('leaves an ordinary rendered data error to the domain component', () => {
    render(
      <RootErrorBoundary onReload={() => {}}>
        <div role="alert">Acquisition dependency unavailable</div>
      </RootErrorBoundary>,
    );
    expect(screen.getByRole('alert').textContent).toBe('Acquisition dependency unavailable');
    expect(screen.queryByRole('button', { name: /reload/i })).toBeNull();
  });
});
