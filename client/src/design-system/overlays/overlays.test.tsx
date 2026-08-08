// @vitest-environment jsdom
//
// Behavioral acceptance for the governed overlays.
//
// SCOPE HONESTY
//
// jsdom implements neither `HTMLDialogElement.showModal()` nor the top layer,
// so these tests exercise the FALLBACK path: dialog semantics, accessible name,
// Escape, dismissal, focus entry, focus containment, focus restoration, and the
// pending guard. What they cannot prove is real-browser geometry, ::backdrop
// rendering, and platform-supplied inertness — that proof is S1.6.7's, and this
// file does not pretend otherwise.
//
// The suite asserts that gap explicitly rather than leaving it implied.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { Dialog } from './Dialog';
import { Drawer } from './Drawer';
import { MutationConfirmation } from './MutationConfirmation';
import { supportsModalDialog } from './useOverlayBehavior';

afterEach(cleanup);

describe('the test environment', () => {
  // If jsdom ever gains showModal, these suites are exercising a different code
  // path than they claim to, and this assertion is what says so out loud.
  it('has no native modal dialog support, so the fallback path is what is proved here', () => {
    expect(supportsModalDialog()).toBe(false);
  });
});

// --- Dialog -----------------------------------------------------------------

function DialogHarness({
  dismissible = true,
  onDismiss = () => {},
}: {
  dismissible?: boolean;
  onDismiss?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open dialog
      </button>
      <Dialog
        open={open}
        dismissible={dismissible}
        onDismiss={() => {
          onDismiss();
          if (dismissible) setOpen(false);
        }}
        title="Void this lot"
        description="Voiding removes the lot from active inventory."
        footer={<button type="button">Confirm void</button>}
      >
        <button type="button">First control</button>
        <button type="button">Second control</button>
      </Dialog>
    </>
  );
}

describe('Dialog', () => {
  it('renders dialog semantics with an accessible name', () => {
    render(
      <Dialog open onDismiss={() => {}} title="Void this lot">
        <p>Body</p>
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Void this lot' });
    expect(dialog.tagName).toBe('DIALOG');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('wires the description as the accessible description', () => {
    render(
      <Dialog open onDismiss={() => {}} title="Void this lot" description="This cannot be undone from here.">
        <p>Body</p>
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Void this lot' });
    const describedBy = dialog.getAttribute('aria-describedby')!;
    expect(document.getElementById(describedBy)!.textContent).toBe('This cannot be undone from here.');
  });

  it('renders nothing at all when closed', () => {
    render(
      <Dialog open={false} onDismiss={() => {}} title="Void this lot">
        <p>Body</p>
      </Dialog>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('moves focus inside on open', () => {
    render(<DialogHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open dialog' }));
    const dialog = screen.getByRole('dialog', { name: 'Void this lot' });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('restores focus to the trigger on close', () => {
    render(<DialogHarness />);
    const trigger = screen.getByRole('button', { name: 'Open dialog' });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on Escape', () => {
    const onDismiss = vi.fn();
    render(<DialogHarness onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open dialog' }));
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Void this lot' }), { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes from an explicit close control', () => {
    render(<DialogHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open dialog' }));
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes from the backdrop where the platform supplies none', () => {
    const onDismiss = vi.fn();
    render(<DialogHarness onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open dialog' }));
    const backdrop = document.querySelector('[data-overlay-backdrop]')!;
    // Hidden from assistive technology: a second control named "Close" in the
    // accessibility tree is indistinguishable from the real one.
    expect(backdrop.getAttribute('aria-hidden')).toBe('true');
    fireEvent.click(backdrop);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('contains focus inside the panel while modal', () => {
    render(<DialogHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open dialog' }));
    const dialog = screen.getByRole('dialog', { name: 'Void this lot' });
    const focusable = within(dialog).getAllByRole('button');
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    last.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('gives principal controls a comfortable touch target', () => {
    render(
      <Dialog open onDismiss={() => {}} title="Void this lot">
        <p>Body</p>
      </Dialog>,
    );
    const close = screen.getByRole('button', { name: 'Close' });
    expect(close.className).toContain('min-h-11');
    expect(close.className).toContain('min-w-11');
  });

  it('animates only where motion is welcome', () => {
    render(
      <Dialog open onDismiss={() => {}} title="Void this lot">
        <p>Body</p>
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Void this lot' });
    // Every transition is behind motion-safe, so an operator who asked the OS
    // for reduced motion gets the state change with no animation at all.
    const classes = dialog.className.split(/\s+/);
    const motion = classes.filter((c) => /transition|animate|duration/.test(c));
    expect(motion.length).toBeGreaterThan(0);
    expect(motion.every((c) => c.startsWith('motion-safe:'))).toBe(true);
  });
});

describe('Dialog — pending dismissal guard', () => {
  it('ignores Escape while the caller says a mutation is in flight', () => {
    const onDismiss = vi.fn();
    render(
      <Dialog open dismissible={false} onDismiss={onDismiss} title="Void this lot">
        <p>Body</p>
      </Dialog>,
    );
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Void this lot' }), { key: 'Escape' });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('ignores a backdrop tap while pending', () => {
    const onDismiss = vi.fn();
    render(
      <Dialog open dismissible={false} onDismiss={onDismiss} title="Void this lot">
        <p>Body</p>
      </Dialog>,
    );
    fireEvent.click(document.querySelector('[data-overlay-backdrop]')!);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  // Blocking accidental dismissal must not become trapping the operator: the
  // explicit control is still there, because it cannot be pressed by accident.
  it('keeps the explicit close control available while pending', () => {
    const onDismiss = vi.fn();
    render(
      <Dialog open dismissible={false} onDismiss={onDismiss} title="Void this lot">
        <p>Body</p>
      </Dialog>,
    );
    const close = screen.getByRole('button', { name: 'Close' });
    expect((close as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(close);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('lets a caller lock the close control deliberately', () => {
    render(
      <Dialog open dismissible={false} closeDisabled onDismiss={() => {}} title="Void this lot">
        <p>Body</p>
      </Dialog>,
    );
    expect((screen.getByRole('button', { name: 'Close' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

// --- Drawer -----------------------------------------------------------------

function DrawerHarness({ onDismiss = () => {} }: { onDismiss?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open drawer
      </button>
      <Drawer
        open={open}
        onDismiss={() => {
          onDismiss();
          setOpen(false);
        }}
        title="RV-LOT-0001"
      >
        <button type="button">First control</button>
        <button type="button">Second control</button>
      </Drawer>
    </>
  );
}

describe('Drawer', () => {
  it('renders dialog semantics with an accessible name', () => {
    render(
      <Drawer open onDismiss={() => {}} title="RV-LOT-0001">
        <p>Body</p>
      </Drawer>,
    );
    const drawer = screen.getByRole('dialog', { name: 'RV-LOT-0001' });
    expect(drawer.tagName).toBe('DIALOG');
    expect(drawer.getAttribute('aria-modal')).toBe('true');
  });

  it('takes its accessible name from titleText when the visible title is rich', () => {
    render(
      <Drawer
        open
        onDismiss={() => {}}
        title={
          <span>
            <span aria-hidden="true">#</span> RV-LOT-0001
          </span>
        }
        titleText="Lot RV-LOT-0001"
      >
        <p>Body</p>
      </Drawer>,
    );
    expect(screen.getByRole('dialog', { name: 'Lot RV-LOT-0001' })).toBeTruthy();
  });

  it('moves focus inside on open and restores it on close', () => {
    render(<DrawerHarness />);
    const trigger = screen.getByRole('button', { name: 'Open drawer' });
    trigger.focus();
    fireEvent.click(trigger);
    const drawer = screen.getByRole('dialog', { name: 'RV-LOT-0001' });
    expect(drawer.contains(document.activeElement)).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on Escape', () => {
    const onDismiss = vi.fn();
    render(<DrawerHarness onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open drawer' }));
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'RV-LOT-0001' }), { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('closes from the backdrop when dismissal is enabled', () => {
    const onDismiss = vi.fn();
    render(<DrawerHarness onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open drawer' }));
    fireEvent.click(document.querySelector('[data-overlay-backdrop]')!);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not dismiss from the backdrop when the caller forbids it', () => {
    const onDismiss = vi.fn();
    render(
      <Drawer open dismissible={false} onDismiss={onDismiss} title="RV-LOT-0001">
        <p>Body</p>
      </Drawer>,
    );
    fireEvent.click(document.querySelector('[data-overlay-backdrop]')!);
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'RV-LOT-0001' }), { key: 'Escape' });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('contains focus inside the panel', () => {
    render(<DrawerHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open drawer' }));
    const drawer = screen.getByRole('dialog', { name: 'RV-LOT-0001' });
    const buttons = within(drawer).getAllByRole('button');
    const first = buttons[0];
    const last = buttons[buttons.length - 1];

    last.focus();
    fireEvent.keyDown(drawer, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
  });

  it('scrolls its own content rather than the page behind it', () => {
    render(
      <Drawer open onDismiss={() => {}} title="RV-LOT-0001">
        <p>Body</p>
      </Drawer>,
    );
    const drawer = screen.getByRole('dialog', { name: 'RV-LOT-0001' });
    expect(drawer.querySelector('.overflow-y-auto')).toBeTruthy();
  });

  it('offers semantic sizes and a full-width fallback on small screens', () => {
    render(
      <Drawer open onDismiss={() => {}} title="RV-LOT-0001" size="compact">
        <p>Body</p>
      </Drawer>,
    );
    const drawer = screen.getByRole('dialog', { name: 'RV-LOT-0001' });
    // Full width by default, bounded only from `sm` upward: an edge panel
    // pinned to a desktop width on a phone is a panel with its content cut off.
    expect(drawer.className).toContain('w-full');
    expect(drawer.className).toContain('sm:max-w-md');
  });

  it('animates only where motion is welcome', () => {
    render(
      <Drawer open onDismiss={() => {}} title="RV-LOT-0001">
        <p>Body</p>
      </Drawer>,
    );
    const classes = screen.getByRole('dialog', { name: 'RV-LOT-0001' }).className.split(/\s+/);
    const motion = classes.filter((c) => /transition|animate|duration/.test(c));
    expect(motion.length).toBeGreaterThan(0);
    expect(motion.every((c) => c.startsWith('motion-safe:'))).toBe(true);
  });
});

// --- MutationConfirmation ---------------------------------------------------

function ConfirmationHarness(props: Partial<Parameters<typeof MutationConfirmation>[0]> = {}) {
  const [reason, setReason] = useState('');
  return (
    <MutationConfirmation
      open
      onCancel={() => {}}
      onConfirm={() => {}}
      title="Void duplicate lot"
      consequence="The lot is removed from active inventory. The record and its history are kept."
      objectFacts={
        <dl>
          <dt>Lot</dt>
          <dd>RV-LOT-0001</dd>
        </dl>
      }
      reason={{ value: reason, onChange: setReason, required: true }}
      {...props}
    />
  );
}

describe('MutationConfirmation', () => {
  it('states the action and its consequence in plain language', () => {
    render(<ConfirmationHarness />);
    const dialog = screen.getByRole('dialog', { name: 'Void duplicate lot' });
    expect(within(dialog).getByText(/removed from active inventory/i)).toBeTruthy();
  });

  it('renders the caller-supplied object facts', () => {
    render(<ConfirmationHarness />);
    expect(screen.getByText('RV-LOT-0001')).toBeTruthy();
  });

  it('collects the reason through a labelled field, never a browser prompt', () => {
    const prompt = vi.spyOn(window, 'prompt');
    render(<ConfirmationHarness />);
    expect(screen.getByLabelText(/Reason/)).toBeTruthy();
    expect(prompt).not.toHaveBeenCalled();
    prompt.mockRestore();
  });

  it('hands the caller exactly what the operator typed', () => {
    const onChange = vi.fn();
    render(<ConfirmationHarness reason={{ value: '', onChange, required: true }} />);
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: '  Duplicate of RV-LOT-0009  ' } });
    // Not trimmed, not normalised: the recorded reason and the displayed reason
    // must be the same string.
    expect(onChange).toHaveBeenCalledWith('  Duplicate of RV-LOT-0009  ');
  });

  it('confirms and cancels through the caller', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmationHarness onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('respects the caller gate on confirm', () => {
    const onConfirm = vi.fn();
    render(<ConfirmationHarness confirmDisabled onConfirm={onConfirm} />);
    const confirm = screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('renders destructive intent in critical semantics, never in brand gold', () => {
    render(<ConfirmationHarness confirmVariant="destructive" confirmLabel="Void lot" />);
    const confirm = screen.getByRole('button', { name: 'Void lot' });
    expect(confirm.getAttribute('data-variant')).toBe('destructive');
    expect(confirm.className).not.toContain('accent');
  });

  it('blocks re-submission and incidental dismissal while pending', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmationHarness pending onConfirm={onConfirm} onCancel={onCancel} />);

    const confirm = screen.getByRole('button', { name: 'Working…' });
    expect(confirm.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();

    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Void duplicate lot' }), { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('disables the reason field while pending', () => {
    render(<ConfirmationHarness pending />);
    expect((screen.getByLabelText(/Reason/) as HTMLTextAreaElement).disabled).toBe(true);
  });

  // A failed response is not proof that nothing happened.
  it('reports a bounded failure without claiming the mutation did not commit', () => {
    render(<ConfirmationHarness error={{ code: 'LOT_VOID_CONFLICT', message: 'The lot changed while you were working.' }} />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('The lot changed while you were working.');
    expect(alert.textContent).toContain('LOT_VOID_CONFLICT');
    expect(alert.textContent).not.toMatch(/nothing (was|has been) (saved|changed|recorded)/i);
  });
});
