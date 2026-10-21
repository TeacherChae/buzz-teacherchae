import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeNotificationSettings } from "./hooks.ts";

test("badges stay on with popups off", () => {
  const settings = sanitizeNotificationSettings({
    desktopEnabled: false,
  });

  assert.equal(settings.desktopEnabled, false);
  assert.equal(settings.appBadgeEnabled, true);
});

test("saved badge off stays off", () => {
  const settings = sanitizeNotificationSettings({
    desktopEnabled: true,
    appBadgeEnabled: false,
  });

  assert.equal(settings.desktopEnabled, true);
  assert.equal(settings.appBadgeEnabled, false);
});

test("invalid app badge preference falls back to enabled", () => {
  const settings = sanitizeNotificationSettings({
    desktopEnabled: false,
    appBadgeEnabled: "false",
  });

  assert.equal(settings.desktopEnabled, false);
  assert.equal(settings.appBadgeEnabled, true);
});
