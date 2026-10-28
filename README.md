# OpenCode sidebar layout

Solid/OpenTUI sidebar sections for MCP cost, clocks, calendar and plugins.
The `./tui` export loads committed JavaScript from `dist/tui.js`, not raw TSX.
The Solid universal compiler targets `@opentui/solid`; host runtime imports
remain external. No React dependency or bundled renderer is introduced.

## Development

Use Node.js 26 and npm. From the repository root:

```sh
npm ci --ignore-scripts
npm audit --audit-level=critical
npm run typecheck
npm run build:check
npm run test:coverage
npm run compile
node --check dist/tui.js
```

After intentional source or compiler changes, run `npm run compile`, regenerate
the signed fixture as documented in `test/fixtures/README.md`, and commit
`dist/tui.js` alongside source. Check freshness before compiling in CI so stale
committed output cannot be hidden. Compilation is explicit: there is no exact
`build`, `prepack`, `prepare`, installation hook or workspace declaration.
Some Git installers attempt nested npm preparation even with scripts disabled
when those declarations are present. Tests exercise actual Git extraction
with an unavailable npm sentinel in addition to scripts-disabled archives.

The root Seroval 1.6.8 override applies to this repository's maintainer install
only. Dependency overrides are not inherited by consumers; this does not
patch OpenCode's host or a consumer's dependency graph. Existing runtime
dependency and peer ranges are unchanged; the lockfile pins the tested graph.

Packaging checks do not execute plugin setup, which writes local settings.
Rendering, mouse interactions and reload persistence need separate host
verification. This plugin already includes clocks/calendar/plugins sections;
other sidebar plugins may overlap. No sections or host settings are changed
by this packaging fix.
