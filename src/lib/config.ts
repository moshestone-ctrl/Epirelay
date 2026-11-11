// App-wide settings. Change the name here when you settle on a final brand.
// ("EpiPen" is a registered trademark of another company, so the app can't use it in its name.)
export const APP_NAME = 'EpiRelay';

// Bump this when the onboarding acknowledgements or Terms change, to make everyone re-accept.
export const TERMS_VERSION = 1;

export const EMERGENCY_NUMBER = '911';

// How long the SOS button must be held, to prevent pocket-dials.
export const SOS_HOLD_MS = 2000;

// Carriers who are "available" refresh their last-known location this often while the app is open.
export const LOCATION_HEARTBEAT_MS = 5 * 60 * 1000;

// Screens that show a live alert re-check the server this often (on top of instant live updates).
export const ALERT_POLL_MS = 4000;

// A responder on the way shares their position this often.
export const RESPONDER_POSITION_MS = 10_000;

// Show "Widen search" if nobody is on the way after this long.
export const WIDEN_PROMPT_AFTER_MS = 45_000;

// Distances: false = feet/miles (US), true = metres/kilometres.
export const USE_METRIC = false;
