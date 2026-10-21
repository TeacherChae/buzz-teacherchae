import assert from "node:assert/strict";
import test from "node:test";

import {
  APP_BADGE_ICON_SIZE as SIZE,
  createAppBadgeIconPixels,
} from "./appBadgeIcon.ts";

test("icon has RGBA pixels", () => {
  const pixels = createAppBadgeIconPixels();

  assert.equal(pixels.length, SIZE * SIZE * 4);
});

test("icon center is opaque red", () => {
  const pixels = createAppBadgeIconPixels();
  const center = (8 * SIZE + 8) * 4;
  const color = Array.from(pixels.slice(center, center + 4));

  assert.deepEqual(color, [239, 68, 68, 255]);
});

test("icon corner is transparent", () => {
  const pixels = createAppBadgeIconPixels();

  assert.deepEqual(Array.from(pixels.slice(0, 4)), [0, 0, 0, 0]);
});
