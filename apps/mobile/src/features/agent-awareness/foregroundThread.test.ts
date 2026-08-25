import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const appState = vi.hoisted(() => ({ currentState: "active" }));

vi.mock("react-native", () => ({ AppState: appState }));

import {
  __resetAndroidForegroundThreadForTests,
  isAndroidForegroundThread,
  isWindowsForegroundThread,
  setAndroidForegroundThread,
} from "./foregroundThread";

const environmentId = "environment-1" as EnvironmentId;
const threadOneId = "thread-1" as ThreadId;
const threadTwoId = "thread-2" as ThreadId;
const focusedDesktopLease = {
  clientKind: "desktop-renderer",
  visible: true,
  focused: true,
  scopes: [{ type: "thread", threadId: threadOneId }],
};

describe("Android foreground-thread notification policy", () => {
  beforeEach(() => {
    appState.currentState = "active";
    __resetAndroidForegroundThreadForTests();
  });

  it("suppresses only the visibly focused thread while the app is active", () => {
    setAndroidForegroundThread({ environmentId, threadId: threadOneId });

    expect(isAndroidForegroundThread({ environmentId, threadId: threadOneId })).toBe(true);
    expect(isAndroidForegroundThread({ environmentId, threadId: threadTwoId })).toBe(false);
  });

  it("fails open when the app is no longer active", () => {
    setAndroidForegroundThread({ environmentId, threadId: threadOneId });
    appState.currentState = "background";

    expect(isAndroidForegroundThread({ environmentId, threadId: threadOneId })).toBe(false);
  });

  it("clears the focused-thread state on route blur", () => {
    const clear = setAndroidForegroundThread({ environmentId, threadId: threadOneId });
    clear();

    expect(isAndroidForegroundThread({ environmentId, threadId: threadOneId })).toBe(false);
  });

  it("suppresses only an exact focused Windows thread lease", () => {
    expect(
      isWindowsForegroundThread({ leases: [focusedDesktopLease] } as never, {
        environmentId,
        threadId: threadOneId,
      }),
    ).toBe(true);
    expect(
      isWindowsForegroundThread({ leases: [focusedDesktopLease] } as never, {
        environmentId,
        threadId: threadTwoId,
      }),
    ).toBe(false);
    expect(
      isWindowsForegroundThread({ leases: [{ ...focusedDesktopLease, focused: false }] } as never, {
        environmentId,
        threadId: threadOneId,
      }),
    ).toBe(false);
  });
});
