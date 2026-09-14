# Mettle v0.1 — Android preview build

Paste these into PowerShell, one at a time, from this folder.

```powershell
npm install
npx eas-cli@latest login
npx eas-cli@latest init --id 4e73c753-5067-42bd-b011-e0b1abe1b436
npx eas-cli@latest build --platform android --profile preview
```

The last one queues a cloud build and prints a link. Open that link on the Pixel,
tap Install, and allow Chrome to install apps when Android asks.

Everything is pinned to Expo SDK 57 / React Native 0.86.3 — do not run
`npm update` or `npx expo install --fix` without checking the Build Bible first.
