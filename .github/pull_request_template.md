## What this changes

<!-- One paragraph. What was wrong or missing, and what this does about it. -->

## Which phase

<!-- Sidecar is built in numbered phases, see docs/BUILD-PLAN.md.
     Say which phase this belongs to, or "outside the plan" and why. -->

## Checklist

- [ ] `npm run lint`, `npm test` and `npm run build` all pass
- [ ] Manually smoke-tested with `NODE_ENV=development npm start`
- [ ] No API key is logged, serialised, or sent to the renderer
- [ ] Any new IPC channel is whitelisted in `src/preload/index.js`
- [ ] Any new interactive surface matches the click-through selectors in `App.jsx`
- [ ] New settings keys are added to `defaults` in `SettingsManager`

## New dependencies

<!-- Required if you added one: what it is, how big it is, and why nothing already
     in the tree does the job. Native modules break the unsigned cross-platform build. -->

## How I tested this

<!-- Real steps, not "it should work". Say what you did not test. -->
