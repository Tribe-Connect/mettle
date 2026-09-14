# Mettle

A cognitive-fitness app built on honest measurement. See the Build Bible for the
full specification, the evidence base and the delivery plan.

- `apps/mobile` — the Expo / React Native app (SDK 57, RN 0.86.3)
- `packages/engine` — adaptive staircase, ability estimate, measurement layer and
  scheduler. Pure TypeScript, no UI, no platform dependency. 71 tests.

## Builds

Every push to `main` builds an installable APK on GitHub's runners and attaches
it to the run. Open the run, scroll to **Artifacts**, download `mettle-apk`.

The pipeline runs the type check, the 71 engine unit tests and the T2 adaptive
simulation before it builds, so a regression in the measurement layer fails the
build rather than shipping.
