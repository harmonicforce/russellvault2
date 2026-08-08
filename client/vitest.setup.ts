// Test-environment shims.
//
// jsdom implements no layout engine, so the observer APIs a real browser
// provides simply do not exist there. `@dnd-kit/dom` constructs a
// `ResizeObserver` at module load, so without this the Workbench interaction
// adapter cannot even be imported under test.
//
// These are no-op stubs, and they are honest about what that means: they let
// the module load and let behaviour that does NOT depend on measured geometry
// be tested. They do not simulate resizing, they do not produce layout, and no
// test in this repository claims that a real drag gesture works because of
// them. Real pointer/touch/geometry proof is S1.6.7's browser gate.

class NoopObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
}

const globalScope = globalThis as unknown as Record<string, unknown>;

if (typeof globalScope.ResizeObserver === 'undefined') {
  globalScope.ResizeObserver = NoopObserver;
}
if (typeof globalScope.IntersectionObserver === 'undefined') {
  globalScope.IntersectionObserver = NoopObserver;
}
