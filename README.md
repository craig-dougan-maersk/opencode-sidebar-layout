# OpenCode sidebar layout

A sidebar host for OpenCode. Instead of re-implementing clocks, plugin lists and
costs, this plugin installs nothing itself: it adopts the sidebar sections that
other plugins register and gives you one place to order, show, hide, collapse,
rename and colour them — including third-party plugins, with no fork.

The `./tui` export loads committed JavaScript from `dist/tui.js`, not raw TSX.
The Solid universal compiler targets `@opentui/solid`; host runtime imports
remain external. No React dependency or bundled renderer is introduced.

## How adoption works

The host exposes a single `sidebar.content` slot that every sidebar plugin claims
into (`prepend`, `append`, `before`, `after` or `replace`). The host only renders
one `replace` claim per slot and suppresses the claims it displaces, so the
layout plugin:

1. claims `prepend: "sidebar.content"` with a tiny probe while it looks for the
   host context, then
2. once found, disposes the probe and re-claims `replace: "sidebar.content"`, and
3. re-renders every suppressed sibling claim — the real component registered by
   each plugin, with that plugin's own context, so each plugin's own settings
   keep working.

The host context is reached by walking the Solid owner chain to the provider that
exposes the resolved slot graph. Nothing about the other plugins is forked or
copied, and no other plugin needs a code change to appear here. If the host
context cannot be found, the layout stays inert and the sidebar simply renders
the way the host would have rendered it (no suppression).

Adopted sections are grouped per plugin and re-rendered exactly as that plugin
registered them, so each keeps its own heading, collapsible state and settings.
The layout never draws a second heading by default: every known sidebar plugin
already renders its own, and defaulting to no heading also keeps the behaviour
safe for third-party plugins the layout has never seen. A section that wants a
layout-managed heading opts in with `header: true`. Every section is separated
from the previous one by a single blank line.

## Host sections versus third-party sections

The single `replace` claim necessarily displaces the host's own sidebar sections
(session context, limits, MCP servers, todos) as well as third-party ones. By
default those host sections are re-rendered unchanged — no heading, always
visible — so the built-in sidebar looks the same. Set `includeBuiltin` to `true`
to adopt the host sections into the same heading/order/visibility model.

## Configuration

Settings live in `~/.config/opencode/sidebar-layout.json` and are edited with the
`Configure sidebar layout` command (palette entry, or `/sidebar-layout`):

```jsonc title="~/.config/opencode/sidebar-layout.json"
{
  // "adopt" (default) hosts other plugins' sidebar sections; "coexist" disables
  // hosting entirely so every plugin renders exactly as the host would render it.
  "mode": "adopt",
  // Also adopt the host's own sidebar sections (default: false, they pass through).
  "includeBuiltin": false,
  // New sections start collapsed unless a section overrides it.
  "collapseByDefault": true,
  // Ctrl + drag a section up or down to reorder it (default: true).
  "dragReorder": true,
  // Keyed by the plugin id that registered the section.
  "sections": {
    "plugins.pane": {
      "order": 0,
      "visible": true,
    },
    "timezone.clocks": {
      "order": 1,
      "visible": true,
      // Opt in to a layout-drawn heading; the plugin's own heading is used
      // otherwise (the default, so nothing is ever duplicated).
      "header": true,
      "color": "info",
      "title": "Clocks",
    },
  },
}
```

- `order` — lower sorts first among managed sections; unset keeps registration order.
- `visible` — set `false` to hide a section entirely.
- `header` — set `true` to have the layout draw its own collapsible heading
  instead of relying on the plugin's. Defaults to `false`, because every known
  sidebar plugin already draws its own heading; the default is also safe for
  third-party plugins the layout has not seen. `title`, `color` and `collapsed`
  only apply when a heading is drawn.
- `collapsed` — per-section override of `collapseByDefault` for headed sections.
- `color` — one of `base`, `muted`, `success`, `warning`, `error`, `info`.
- `title` — heading text; defaults to a friendly name derived from the plugin id.
- `dragReorder` — set `false` to disable ctrl + drag reordering of sections.

## Reordering

Two ways to reorder sections, beyond setting `order` by hand:

- In the `Configure sidebar layout` command, choose a section and then `Move up`
  or `Move down`. The action menu stays on the move entry after each move, so a
  section can be nudged repeatedly without reopening the menu, and the two moves
  are also bound to `alt+up` and `alt+down` as dialog footer actions, which the
  host triggers without closing the dialog. `Escape` returns to the section
  list; a second `Escape` at the list closes the command.
- Hold `Ctrl` and drag a section up or down. A status line above the sidebar
  shows where the section will land. `Ctrl` is required: the renderer starts a
  text selection on a plain or `Alt` drag over the plugins' selectable text, and
  `Ctrl` is the only modifier it excludes from that path. Set `dragReorder` to
  `false` to turn dragging off.

Both write the same explicit per-section `order` index used by the `order`
setting.

`collapsedByDefault` can also be set in the plugin options, which is equivalent
to `collapseByDefault`:

```jsonc title="cli.json"
{
  "plugins": [
    {
      "package": "craig-dougan-maersk/opencode-sidebar-layout",
      "options": { "collapsedByDefault": true },
    },
  ],
}
```

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

Packaging checks do not execute plugin setup for rendering. Adoption is exercised
by a setup probe (claim shape in `adopt` versus `coexist`); the live suppression
and re-render path needs host verification after a TUI restart. Adoption depends
on the host's internal slot graph being reachable from a plugin render through
the shared Solid owner chain; if a future host version changes that, the plugin
falls back to rendering nothing of its own and the host's sidebar is unchanged.
