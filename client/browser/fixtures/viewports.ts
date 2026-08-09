// The approved S1.6 reference viewports.
//
// These are the sizes Russell Vault is actually operated at, not Playwright's
// generic device presets. A preset that silently changes with a Playwright
// upgrade would move every screenshot baseline for a reason unrelated to the
// product, so the numbers are stated here and owned here.

export interface ReferenceViewport {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  /** Whether an operator drives this size primarily by touch. */
  readonly touch: boolean;
}

export const PHONE: ReferenceViewport = { name: 'phone-390x844', width: 390, height: 844, touch: true };
export const TABLET_PORTRAIT: ReferenceViewport = {
  name: 'tablet-portrait-834x1194',
  width: 834,
  height: 1194,
  touch: true,
};
export const TABLET_LANDSCAPE: ReferenceViewport = {
  name: 'tablet-landscape-1194x834',
  width: 1194,
  height: 834,
  touch: true,
};
export const DESKTOP: ReferenceViewport = { name: 'desktop-1440x900', width: 1440, height: 900, touch: false };
export const WIDE_DESKTOP: ReferenceViewport = {
  name: 'wide-desktop-1728x1117',
  width: 1728,
  height: 1117,
  touch: false,
};

/** All five, in ascending width. Chromium exercises every one of them. */
export const REFERENCE_VIEWPORTS: readonly ReferenceViewport[] = [
  PHONE,
  TABLET_PORTRAIT,
  TABLET_LANDSCAPE,
  DESKTOP,
  WIDE_DESKTOP,
];

/** iPad is an explicit product requirement, so WebKit smokes both orientations. */
export const IPAD_VIEWPORTS: readonly ReferenceViewport[] = [TABLET_PORTRAIT, TABLET_LANDSCAPE];

/** The width at which the shell switches to a persistent sidebar. */
export const SIDEBAR_BREAKPOINT = 1024;
