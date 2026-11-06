// Bundled only into the iOS/iPadOS app (www/native.js). Exposes native features to clock.ts
// through window.taikyokuNative; the web build never loads this file.
import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { KeepAwake } from "@capacitor-community/keep-awake";
import { StatusBar } from "@capacitor/status-bar";

type Haptic = "tap" | "tick" | "warn" | "period" | "flag";
declare global {
  interface Window { taikyokuNative?: { haptic(kind: Haptic): void; keepAwake(on: boolean): void } }
}

if (Capacitor.isNativePlatform()) {
  const ignore = () => undefined;
  window.taikyokuNative = {
    haptic(kind) {
      switch (kind) {
        case "tap": Haptics.impact({ style: ImpactStyle.Medium }).catch(ignore); break;
        case "tick": Haptics.impact({ style: ImpactStyle.Light }).catch(ignore); break;
        case "warn": Haptics.notification({ type: NotificationType.Warning }).catch(ignore); break;
        case "period": Haptics.notification({ type: NotificationType.Warning }).catch(ignore); break;
        case "flag": Haptics.notification({ type: NotificationType.Error }).catch(ignore); break;
      }
    },
    keepAwake(on) {
      (on ? KeepAwake.keepAwake() : KeepAwake.allowSleep()).catch(ignore);
    },
  };
  // A game clock wants every pixel; the status bar would sit inside the top player's half.
  StatusBar.hide().catch(ignore);
}
