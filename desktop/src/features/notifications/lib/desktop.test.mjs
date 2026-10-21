import assert from "node:assert/strict";
import test from "node:test";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";

const notifications = [];

class WorkingNotification {
  static permission = "granted";

  constructor(title, options) {
    notifications.push({ title, options });
  }

  close() {}
}

class ThrowingNotification {
  static permission = "granted";

  constructor() {
    throw new Error("notification backend unavailable");
  }
}

globalThis.window = { Notification: ThrowingNotification };

const {
  sendDesktopNotification,
  getDesktopNotificationPermissionState,
  setDesktopAppBadge,
} = await import("./desktop.ts");

// Stands in for the plugin's injected shim: `permission` is a cached value and
// only `requestPermission()` reaches the backend and rewrites it.
function shimNotification(initialPermission, grantedPermission = "granted") {
  class ShimNotification {
    static permission = initialPermission;
    static requestCount = 0;

    static async requestPermission() {
      ShimNotification.requestCount += 1;
      ShimNotification.permission = grantedPermission;
      return grantedPermission;
    }

    close() {}
  }

  return ShimNotification;
}

async function withEnvironment({ platform, isTauri, notification }, callback) {
  const originalNavigator = Object.getOwnPropertyDescriptor(
    globalThis,
    "navigator",
  );
  const originalNotification = window.Notification;
  const originalIsTauri = globalThis.isTauri;

  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { platform, userAgent: "" },
  });
  window.Notification = notification;
  globalThis.isTauri = isTauri;

  try {
    return await callback();
  } finally {
    if (originalNavigator) {
      Object.defineProperty(globalThis, "navigator", originalNavigator);
    } else {
      delete globalThis.navigator;
    }
    window.Notification = originalNotification;
    globalThis.isTauri = originalIsTauri;
  }
}

test("constructor failure is a delivery miss and does not prevent a later notification", async (t) => {
  const warnings = [];
  t.mock.method(console, "warn", (...args) => warnings.push(args));

  const failed = await sendDesktopNotification({ title: "First" });

  assert.equal(failed, false);
  assert.equal(warnings.length, 1);
  assert.match(String(warnings[0][1]), /notification backend unavailable/);

  window.Notification = WorkingNotification;

  const delivered = await sendDesktopNotification({
    title: "Second",
    body: "Recovered",
  });

  assert.equal(delivered, true);
  assert.deepEqual(notifications, [
    {
      title: "Second",
      options: { body: "Recovered", silent: true, extra: undefined },
    },
  ]);
});

test("Windows Tauri repairs the shim's false denied state on read", async () => {
  const Notification = shimNotification("denied");

  const permission = await withEnvironment(
    { platform: "Win32", isTauri: true, notification: Notification },
    () => getDesktopNotificationPermissionState(),
  );

  assert.equal(permission, "granted");
  assert.equal(Notification.requestCount, 1);
});

test("the repaired state is cached, so later reads do not request again", async () => {
  const Notification = shimNotification("denied");

  await withEnvironment(
    { platform: "Win32", isTauri: true, notification: Notification },
    async () => {
      await getDesktopNotificationPermissionState();
      const second = await getDesktopNotificationPermissionState();
      assert.equal(second, "granted");
    },
  );

  assert.equal(Notification.requestCount, 1);
});

test("a denial that survives the request is reported as denied", async () => {
  const Notification = shimNotification("denied", "denied");

  const permission = await withEnvironment(
    { platform: "Win32", isTauri: true, notification: Notification },
    () => getDesktopNotificationPermissionState(),
  );

  assert.equal(permission, "denied");
  assert.equal(Notification.requestCount, 1);
});

test("denied stays terminal outside the Windows Tauri app", async () => {
  for (const environment of [
    { label: "Windows web", platform: "Win32", isTauri: false },
    { label: "Linux Tauri", platform: "Linux x86_64", isTauri: true },
    { label: "Linux web", platform: "Linux x86_64", isTauri: false },
  ]) {
    const Notification = shimNotification("denied");

    const permission = await withEnvironment(
      { ...environment, notification: Notification },
      () => getDesktopNotificationPermissionState(),
    );

    assert.equal(permission, "denied", environment.label);
    assert.equal(Notification.requestCount, 0, environment.label);
  }
});

test("granted is returned untouched and never triggers a request", async () => {
  const Notification = shimNotification("granted");

  const permission = await withEnvironment(
    { platform: "Win32", isTauri: true, notification: Notification },
    () => getDesktopNotificationPermissionState(),
  );

  assert.equal(permission, "granted");
  assert.equal(Notification.requestCount, 0);
});

test("Windows badge uses overlay and honors the latest request", async () => {
  await withEnvironment(
    { platform: "Win32", isTauri: true, notification: WorkingNotification },
    async () => {
      const updates = [];
      let releaseImage;
      let imageRequests = 0;
      const imageReady = new Promise((resolve) => {
        releaseImage = resolve;
      });
      mockWindows("main");
      mockIPC((command, args) => {
        if (command === "plugin:image|new") {
          imageRequests += 1;
          assert.equal(args.width, 16);
          assert.equal(args.height, 16);
          assert.equal(args.rgba.length, 16 * 16 * 4);
          return imageReady;
        }
        if (command === "plugin:window|set_overlay_icon") {
          assert.equal(args.label, "main");
          updates.push(args.value);
        }
      });

      try {
        // Clear while the first native image is still being created.
        const show = setDesktopAppBadge({ kind: "count", count: 1 });
        const hide = setDesktopAppBadge({ kind: "none" });
        releaseImage(42);
        await Promise.all([show, hide]);
        assert.deepEqual(updates, [undefined]);

        updates.length = 0;
        const cases = [
          [{ kind: "count", count: 1 }, 42],
          [{ kind: "count", count: 0 }, undefined],
          [{ kind: "dot" }, 42],
          [{ kind: "none" }, undefined],
        ];
        for (const [state, expected] of cases) {
          const before = updates.length;
          await setDesktopAppBadge(state);
          assert.equal(updates.length, before + 1);
          assert.equal(updates.at(-1), expected);
        }
        assert.equal(imageRequests, 1);

        // The same ordering guarantee applies to a cached image.
        updates.length = 0;
        await Promise.all([
          setDesktopAppBadge({ kind: "count", count: 1 }),
          setDesktopAppBadge({ kind: "none" }),
        ]);
        assert.ok(updates.length > 0);
        assert.equal(updates.at(-1), undefined);
      } finally {
        clearMocks();
      }
    },
  );
});

test("macOS badge retains its native count and label behavior", async () => {
  await withEnvironment(
    { platform: "MacIntel", isTauri: true, notification: WorkingNotification },
    async () => {
      const calls = [];
      mockWindows("main");
      mockIPC((command, args) => {
        calls.push([command, args.value]);
      });
      try {
        await setDesktopAppBadge({ kind: "count", count: 3 });
        await setDesktopAppBadge({ kind: "dot" });
        await setDesktopAppBadge({ kind: "none" });
        assert.deepEqual(calls, [
          ["plugin:window|set_badge_count", 3],
          ["plugin:window|set_badge_label", " "],
          ["plugin:window|set_badge_label", ""],
          ["plugin:window|set_badge_count", undefined],
        ]);
      } finally {
        clearMocks();
      }
    },
  );
});
