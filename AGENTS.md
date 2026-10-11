This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- This project intentionally does **not** use Expo Router (it is not installed). The game is a single full-screen GL canvas; menus and HUD are overlays driven by `GameStateMachine` (`src/game/core`). A router would unmount the GL context and duplicate state. See ARCHITECTURE.md → "Navegación".
- Entry: `index.ts` → `App.tsx` → `src/app/AppRoot.tsx`. `src/app/` is the app root, not a routes folder.

## Project rules

- `src/game/**` (except `rendering/`) must stay free of React, React Native and Three.js imports so the whole game runs headless in vitest.
- Gameplay numbers go in `src/game/content/balance.ts` / content files, not in systems.
- Player and AI both act through `Intent`; never let AI mutate combat state directly.
- Never report a save as done before `SaveManager` finishes the verified write.
- Verify with `npm run check` and `npm run smoke:web`; record what was and wasn't verified in DEVELOPMENT_PROGRESS.md.
- Do not rewrite text files with PowerShell 5 `Get-Content`/`Set-Content` (it corrupts UTF-8 accents).

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md
