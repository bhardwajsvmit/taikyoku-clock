# Taikyoku Clock

A two-player game clock for Go, chess, shogi and other board games. It is written in TypeScript and builds two targets from the same source:

- a single-page web version (`dist/game-clock.html`)
- a universal iPhone and iPad app (`ios/`), using Capacitor

## Features

- **Time systems:** Japanese byo-yomi, Canadian byo-yomi, Fischer increment, Bronstein, simple (US) delay, sudden death and hourglass.
- **Multi-stage time controls:** for example 90 min for 40 moves, then +30 min, with +30 s per move. Add as many stages as you like. Each half shows the moves left until the next stage.
- **Time handicap, undo and move times:** handicap gives one player extra main time. Undo takes back a mistaken tap. Each half shows how long the last move took.
- **Alerts:** a spoken countdown in the device's languages, beeps, or silent, plus haptics. The iOS app uses the Taptic Engine; iOS Safari has no vibration API.
- **Themes:** kaya wood, cherry blossom, ocean, high contrast, light, dark, or match the device.
- **Layouts:**
  - Portrait has the two players facing each other.
  - Wide screens put them side by side, either facing each other or both upright for a clock standing beside the board.
  - The digits scale to whatever space each half has, so the clock fits iPhone, iPad Split View, Slide Over, Stage Manager and foldables.
  - Dual-screen devices that report a hinge get one player per screen.

## Build

```bash
npm install
npm run build          # dist/game-clock.html + www/
```

## Run on iPhone / iPad (needs a Mac with Xcode 16 or later)

```bash
npm run ios:sync       # build web assets and copy them into the Xcode project
npm run ios:open       # opens ios/App/App.xcodeproj
```

In Xcode, follow these steps:

1. Select the **App** target, then **Signing & Capabilities**, and choose your team.
2. Change the bundle ID `app.taikyoku.clock` to one you own.
3. Pick an iPhone or iPad (or a simulator) and press Run.
4. To release: **Product, then Archive, then Distribute App, then App Store Connect.**

Plugins come from Swift Package Manager, so you don't need CocoaPods.

## iOS project settings

These were changed from the Capacitor template:

| Setting | Value | Why |
|---|---|---|
| Device family | iPhone + iPad | Universal app |
| `UIRequiresFullScreen` | `false` | iPad Split View, Slide Over, Stage Manager |
| Orientations | all on iPad; portrait + landscape on iPhone | Clock can sit any way on the table |
| `UIStatusBarHidden` | `true` | Full screen for the top player's half |
| Audio session | `.playback`, mixes with other audio | Spoken countdown works when the ring/silent switch is on silent; choose **Silent** in Settings to mute |
| Keep awake | `@capacitor-community/keep-awake` | Screen stays on only while a clock runs |
| Timing | wall clock | The running clock keeps time correctly if the app is backgrounded |

## Project layout

```
src/clock.ts         clock engine, UI, settings (shared by web + iOS)
src/native-entry.ts  iOS bridge: haptics, keep-awake, status bar (bundled into www/native.js)
src/index.html       markup + styles
build.mjs            builds dist/ and www/
scripts/             font download and icon renderer
assets/              bundled fonts, app icon
ios/                 Xcode project (Capacitor 8)
```
