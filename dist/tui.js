import { insertNode as _$insertNode } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { createComponent as _$createComponent } from "@opentui/solid";
import { Plugin, usePlugin } from "@opencode/plugin/tui";
import { createEffect, createMemo, createResource, createSignal, ErrorBoundary, For, getOwner, onMount, Show } from "solid-js";
import { TextAttributes } from "@opentui/core";
const SIDEBAR_SLOT = "sidebar.content";
const PLUGIN_ID = "sidebar.layout";
const COLORS = ["base", "muted", "success", "warning", "error", "info"];
const BUILTIN = /^opencode[./]/;
const ACRONYMS = {
  mcp: "MCP",
  ai: "AI",
  lsp: "LSP",
  vcs: "VCS",
  cli: "CLI",
  url: "URL"
};
// Friendly headings used when a section opts into a layout-drawn heading.
const KNOWN_TITLES = {
  "timezone.clocks": "Clocks",
  "plugins.pane": "Plugins",
  "mcp.manager": "MCP",
  "streetturtle.recap": "Recap",
  "streetturtle.context-progress": "Context"
};
// The host keeps every plugin's slot claims in a Solid context that it provides
// around the whole TUI tree. A plugin cannot reach another plugin's registered
// render through the public slot API, but its own render is mounted inside that
// tree, so the host context is reachable by walking the Solid owner chain and
// looking for the object that exposes `slots.resolved` and `registered`.
function hostFromOwner() {
  let owner;
  try {
    owner = getOwner();
  } catch {
    return undefined;
  }
  while (owner) {
    const context = owner.context;
    if (context && typeof context === "object") {
      for (const key of Object.getOwnPropertySymbols(context)) {
        const value = context[key];
        if (value && typeof value === "object" && value.slots && typeof value.slots.resolved === "function" && typeof value.registered === "function") {
          return value;
        }
      }
    }
    owner = owner.owner;
  }
  return undefined;
}

// Every claim that targets the sidebar and was displaced by our `replace`
// claim. These are the real blocks other plugins registered, so rendering them
// keeps each plugin's own component, settings and version.
function suppressedSidebarClaims(host) {
  if (!host) return [];
  let resolved;
  try {
    resolved = host.slots.resolved();
  } catch {
    return [];
  }
  const mine = resolved?.slotted?.get?.(SIDEBAR_SLOT)?.replace;
  if (!mine) return [];
  const claims = [];
  for (const entry of resolved.suppressed ?? []) {
    const claim = entry?.claim;
    if (!claim || claim.plugin === PLUGIN_ID) continue;
    if (claim.placement?.target !== SIDEBAR_SLOT) continue;
    const by = entry?.by;
    if (by !== mine && by?.plugin !== PLUGIN_ID) continue;
    claims.push(claim);
  }
  return claims;
}
function normalizeName(value) {
  return String(value).toLowerCase().replace(/^.*[/:]/, "").replace(/^opencode[-_]?/, "").replace(/[^a-z0-9]/g, "");
}
function shortenVersion(value) {
  return /^[a-f0-9]{40}$/i.test(value) || /^[a-f0-9]{64}$/i.test(value) ? value.slice(0, 7) : value;
}
function isBuiltin(id) {
  return BUILTIN.test(String(id));
}

// Friendly default heading for an adopted plugin, so the sidebar does not show
// raw reverse-DNS ids such as "opencode.sidebar.mcp".
function defaultTitle(id) {
  const tail = String(id).replace(/^opencode[./]/, "").replace(/^sidebar[./]/, "").replace(/^plugin[./]/, "");
  const last = tail.split(/[./]/).filter(Boolean).pop() ?? String(id);
  return last.split(/[-_]/).filter(Boolean).map(word => ACRONYMS[word.toLowerCase()] ?? word.charAt(0).toUpperCase() + word.slice(1)).join(" ") || String(id);
}

// Pure list reorder used by drag reordering: moves `id` to sit immediately
// before or after `targetId`, keeping every other entry in relative order.
// Returns the new order, or undefined when the move would change nothing.
export function moveWithin(ids, id, targetId, after) {
  if (id === targetId) return undefined;
  const from = ids.indexOf(id);
  if (from < 0) return undefined;
  const next = ids.slice();
  next.splice(from, 1);
  const at = next.indexOf(targetId);
  if (at < 0) return undefined;
  next.splice(after ? at + 1 : at, 0, id);
  for (let i = 0; i < next.length; i += 1) {
    if (next[i] !== ids[i]) return next;
  }
  return undefined;
}
// Pure drag state machine for section reordering.
//
// A press arms the drag when it is either ctrl + left (ctrl is the only
// modifier the renderer excludes from its text-selection path) or a plain left
// press on non-selectable content. `over` records the section under the pointer
// and whether the release lands after its midpoint; moving back over the source
// clears that target again. The release itself commits the move, because the
// renderer dispatches `drag-end` and `up` to the source renderable where the
// drag was captured, and only then dispatches `drop` to the target. Committing
// on `up` therefore works even if the `drop` never arrives, and `drop` stays as
// a fallback. The caller clears only after the release has been handled.
export function dragReduce(state, event) {
  const commit = () => {
    const target = state.target;
    if (state.source && target && target.id !== state.source) {
      return {
        state: {
          source: state.source
        },
        move: {
          id: state.source,
          targetId: target.id,
          after: target.after
        }
      };
    }
    return {
      state
    };
  };
  switch (event.type) {
    case "down":
      if (event.button === 0 && (event.ctrl || event.plain)) {
        return {
          state: {
            source: event.id
          }
        };
      }
      return {
        state: {}
      };
    case "over":
      {
        if (!state.source) return {
          state
        };
        if (state.source === event.id) return {
          state: {
            source: state.source
          }
        };
        const top = event.top ?? 0;
        const height = event.height ?? 0;
        const after = (event.pointerY ?? top) > top + height / 2;
        return {
          state: {
            source: state.source,
            target: {
              id: event.id,
              after
            }
          }
        };
      }
    case "up":
    case "drop":
      return commit();
    case "drag-end":
    default:
      return {
        state
      };
  }
}
export default Plugin.define({
  id: PLUGIN_ID,
  async setup(context) {
    const home = globalThis?.process?.env?.HOME || "/home/craig";
    const configPath = `${home}/.config/opencode/sidebar-layout.json`;
    const defaults = {
      mode: "adopt",
      includeBuiltin: false,
      collapseByDefault: context.options?.collapsedByDefault !== false,
      dragReorder: true,
      sections: {}
    };
    let loaded = defaults;
    try {
      const fsMod = await import("node:fs");
      loaded = {
        ...defaults,
        ...JSON.parse(fsMod.readFileSync(configPath, "utf8"))
      };
      if (!loaded.sections || typeof loaded.sections !== "object") {
        loaded.sections = {};
      }
    } catch {}
    const [config, setConfig] = createSignal(loaded);
    const updateConfig = async fn => {
      const draft = JSON.parse(JSON.stringify(config()));
      if (!draft.sections || typeof draft.sections !== "object") {
        draft.sections = {};
      }
      fn(draft);
      setConfig(draft);
      try {
        const fsMod = await import("node:fs");
        fsMod.writeFileSync(configPath, JSON.stringify(draft, null, 2) + "\n");
      } catch {}
    };
    const [detected, setDetected] = createSignal([]);

    // Best-effort version/source label per plugin, from the server inventory
    // first and the local TUI plugin list second.
    const [sources] = createResource(async () => {
      const index = {};
      try {
        const location = context.location ?? context.data.location.default();
        const res = await context.client.plugin.list({
          location
        });
        const rows = res && (res.data ?? res) || [];
        for (const row of Array.isArray(rows) ? rows : []) {
          const version = row?.source?.version;
          const target = row?.source?.target;
          const label = version ? shortenVersion(String(version)) : target ? String(target) : undefined;
          if (!label) continue;
          if (row?.id) index[normalizeName(String(row.id))] = label;
          if (target) index[normalizeName(String(target))] = label;
        }
      } catch {}
      try {
        const fsMod = await import("node:fs");
        const parsed = JSON.parse(fsMod.readFileSync(`${home}/.config/opencode/cli.json`, "utf8"));
        for (const entry of parsed?.plugins ?? []) {
          const spec = typeof entry === "string" ? entry : entry?.package;
          if (typeof spec !== "string") continue;
          if (spec === "*" || spec.startsWith("-")) continue;
          const key = normalizeName(spec);
          if (key && !index[key]) index[key] = spec;
        }
      } catch {}
      return index;
    });
    const section = id => config()?.sections?.[id] ?? {};
    const collapseDefault = () => config()?.collapseByDefault !== false;
    const includeBuiltin = () => config()?.includeBuiltin === true;
    // Built-ins pass through untouched by default; third-party plugins are
    // always managed. Setting includeBuiltin adopts the host's own sections too.
    const isManaged = id => includeBuiltin() || !isBuiltin(id);
    // No layout-drawn heading by default: every known sidebar plugin already
    // renders its own heading, so drawing a second one would duplicate it. This
    // also keeps the default safe for third-party plugins the layout has never
    // seen. A section that wants a managed heading sets header: true.
    const hasHeader = id => isManaged(id) && section(id).header === true;
    const isVisible = id => section(id).visible !== false;
    const isCollapsed = id => section(id).collapsed ?? collapseDefault();
    const colorName = id => section(id).color ?? "base";
    const labelFor = id => section(id).title ?? KNOWN_TITLES[id] ?? defaultTitle(id);
    const versionFor = id => {
      const label = sources()?.[normalizeName(id)];
      return label ? ` · ${label}` : "";
    };
    const setSection = (id, patch) => updateConfig(draft => {
      draft.sections[id] = {
        ...(draft.sections[id] ?? {}),
        ...patch
      };
    });

    // Managed groups keep their registered order unless an explicit section
    // order moves them. Built-in pass-through groups always keep their slot.
    const orderKey = group => {
      const order = section(group.id).order;
      if (typeof order === "number") return order;
      return 1e3 + group.index;
    };
    const orderedIds = () => detected().map((id, index) => ({
      id,
      index
    })).filter(group => isManaged(group.id)).sort((a, b) => orderKey(a) - orderKey(b) || a.index - b.index).map(group => group.id);

    // Ordering is persisted as an explicit `order` index per section, so a
    // reorder survives the next launch and applies to hidden sections too.
    function persistOrder(ids) {
      updateConfig(draft => {
        ids.forEach((sid, i) => {
          draft.sections[sid] = {
            ...(draft.sections[sid] ?? {}),
            order: i
          };
        });
      });
    }
    function reorder(id, delta) {
      const ids = orderedIds();
      const index = ids.indexOf(id);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= ids.length) return;
      const next = ids.slice();
      next.splice(target, 0, next.splice(index, 1)[0]);
      persistOrder(next);
    }

    // Moves `id` to sit immediately before or after `targetId` and persists the
    // new order. Used by drag reordering.
    function moveTo(id, targetId, after) {
      const next = moveWithin(orderedIds(), id, targetId, after);
      if (next) persistOrder(next);
    }
    function color(name) {
      return context.theme?.text?.[name] ?? context.theme?.text?.base;
    }
    function Managed(props) {
      const ctx = usePlugin();
      const groups = createMemo(() => {
        const map = new Map();
        let index = 0;
        for (const claim of suppressedSidebarClaims(hostFromOwner())) {
          const id = String(claim.plugin);
          let group = map.get(id);
          if (!group) {
            group = {
              id,
              index: index++,
              claims: []
            };
            map.set(id, group);
          }
          group.claims.push(claim);
        }
        return [...map.values()];
      });
      createEffect(() => setDetected(groups().map(group => group.id)));
      const visibleGroups = createMemo(() => groups().filter(group => isVisible(group.id)).sort((a, b) => orderKey(a) - orderKey(b) || a.index - b.index));

      // Drag reordering. Ctrl is the only modifier the renderer excludes from
      // its text-selection path, so ctrl + left-drag always reorders; a plain
      // left press on non-selectable content reorders too. Drag events reach the
      // pressed renderable and bubble up to its section wrapper; `over` reaches
      // the wrapper under the pointer; `drop` reaches the wrapper it lands on.
      const [drag, setDrag] = createSignal({});
      const dragEnabled = () => config()?.dragReorder !== false;

      // The heading of a headed section doubles as a drag handle: it is not
      // selectable, so a plain press arms a reorder instead of a text selection.
      // A release in place (no drop target) still toggles collapse.
      let headingClick;
      const onSectionMouse = (id, e) => {
        if (!dragEnabled()) return;
        const type = e?.type;
        if (type === "down") {
          const target = e?.target;
          setDrag(dragReduce(drag(), {
            type: "down",
            id,
            button: e?.button,
            ctrl: Boolean(e?.modifiers?.ctrl),
            plain: Boolean(target && target.selectable === false)
          }).state);
          return;
        }
        if (type === "over") {
          const rect = e?.currentTarget;
          setDrag(dragReduce(drag(), {
            type: "over",
            id,
            pointerY: Number(e?.y ?? 0),
            top: rect?.screenY ?? rect?.y ?? 0,
            height: rect?.height ?? 0
          }).state);
          return;
        }
        if (type === "drop") {
          const result = dragReduce(drag(), {
            type: "drop",
            id
          });
          if (result.move) {
            moveTo(result.move.id, result.move.targetId, result.move.after);
          }
          setDrag({});
          return;
        }
        if (type === "up") {
          // Commit on release: the renderer sends `up` to the source where the
          // drag was captured, so this works even when no `drop` follows.
          const result = dragReduce(drag(), {
            type: "up",
            id
          });
          if (result.move) {
            moveTo(result.move.id, result.move.targetId, result.move.after);
          }
          setDrag({});
          return;
        }
        if (type === "drag-end") {
          // `up` follows immediately and carries the commit.
          return;
        }
      };
      const dragStatus = () => {
        const current = drag();
        if (!current.source) return "";
        const target = current.target;
        if (!target) return `Moving ${labelFor(current.source)} · release over a section`;
        return `Moving ${labelFor(current.source)} · ${target.after ? "after" : "before"} ${labelFor(target.id)}`;
      };
      const claimView = (claim, id) => _$createComponent(ErrorBoundary, {
        fallback: error => (() => {
          var _el$ = _$createElement("text");
          _$insert(_el$, () => `${id}: ${String(error)}`);
          _$effect(_$p => _$setProp(_el$, "fg", ctx.theme.text.error, _$p));
          return _el$;
        })(),
        get children() {
          return claim.render(props.input);
        }
      });
      return (() => {
        var _el$2 = _$createElement("box");
        _$setProp(_el$2, "flexDirection", "column");
        _$setProp(_el$2, "marginTop", 1);
        _$insert(_el$2, _$createComponent(For, {
          get each() {
            return visibleGroups();
          },
          children: group => hasHeader(group.id) ? (() => {
            var _el$4 = _$createElement("box"),
              _el$5 = _$createElement("box"),
              _el$6 = _$createElement("text");
            _$insertNode(_el$4, _el$5);
            _$setProp(_el$4, "flexDirection", "column");
            _$setProp(_el$4, "marginTop", 1);
            _$setProp(_el$4, "onMouse", e => onSectionMouse(group.id, e));
            _$insertNode(_el$5, _el$6);
            _$setProp(_el$5, "onMouseDown", e => {
              // Arm the reorder from the heading, then stop the event so
              // the section wrapper does not arm it a second time.
              try {
                e?.stopPropagation?.();
              } catch {}
              onSectionMouse(group.id, e);
              if (!e?.modifiers?.ctrl) headingClick = group.id;
            });
            _$setProp(_el$5, "onMouseUp", e => {
              // A drag that leaves the heading reorders the section;
              // only a release in place toggles collapse. Ctrl presses
              // never toggle.
              if (e?.modifiers?.ctrl) return;
              if (headingClick !== group.id) return;
              headingClick = undefined;
              if (drag().target) return;
              setSection(group.id, {
                collapsed: !isCollapsed(group.id)
              });
            });
            _$setProp(_el$6, "selectable", false);
            _$insert(_el$6, () => (isCollapsed(group.id) ? "▶ " : "▼ ") + labelFor(group.id) + versionFor(group.id));
            _$insert(_el$4, _$createComponent(Show, {
              get when() {
                return !isCollapsed(group.id);
              },
              get children() {
                var _el$7 = _$createElement("box");
                _$setProp(_el$7, "flexDirection", "column");
                _$setProp(_el$7, "paddingLeft", 1);
                _$insert(_el$7, _$createComponent(For, {
                  get each() {
                    return group.claims;
                  },
                  children: claim => claimView(claim, group.id)
                }));
                return _el$7;
              }
            }), null);
            _$effect(_p$ => {
              var _v$ = color(colorName(group.id)),
                _v$2 = TextAttributes.BOLD;
              _v$ !== _p$.e && (_p$.e = _$setProp(_el$6, "fg", _v$, _p$.e));
              _v$2 !== _p$.t && (_p$.t = _$setProp(_el$6, "attributes", _v$2, _p$.t));
              return _p$;
            }, {
              e: undefined,
              t: undefined
            });
            return _el$4;
          })() : (() => {
            var _el$8 = _$createElement("box");
            _$setProp(_el$8, "flexDirection", "column");
            _$setProp(_el$8, "marginTop", 1);
            _$setProp(_el$8, "onMouse", e => onSectionMouse(group.id, e));
            _$insert(_el$8, _$createComponent(For, {
              get each() {
                return group.claims;
              },
              children: claim => claimView(claim, group.id)
            }));
            return _el$8;
          })()
        }), null);
        _$insert(_el$2, _$createComponent(Show, {
          get when() {
            return dragStatus();
          },
          get children() {
            var _el$3 = _$createElement("text");
            _$insert(_el$3, dragStatus);
            _$effect(_$p => _$setProp(_el$3, "fg", color("info"), _$p));
            return _el$3;
          }
        }), null);
        return _el$2;
      })();
    }
    async function openPluginSettings(id) {
      let commands = [];
      try {
        commands = Array.from(context.keymap.commands() ?? []);
      } catch {}
      const matches = commands.filter(command => command?.palette && typeof command?.id === "string" && command.id.startsWith(`${id}.`));
      if (!matches.length) {
        await context.ui.dialog.alert({
          title: labelFor(id),
          message: `No settings command found for ${id}.`
        });
        return;
      }
      if (matches.length === 1) {
        context.keymap.dispatch(matches[0].id);
        return;
      }
      const pick = await context.ui.dialog.select({
        title: `${labelFor(id)} settings`,
        options: matches.map(command => ({
          title: command.title ?? command.id,
          value: command.id
        }))
      });
      if (pick) context.keymap.dispatch(pick);
    }

    // The section action menu keeps `Move up`/`Move down` open so a section can
    // be nudged repeatedly without reopening the menu and re-selecting the
    // entry. The move actions are also bound to alt+arrow as dialog footer
    // actions, which the host triggers without closing the dialog. Escape
    // returns to the section list; a second Escape at the list closes the flow.
    async function configureSection(id) {
      let sticky;
      const actionOptions = () => [{
        title: "Toggle visibility",
        value: "visible"
      }, {
        title: hasHeader(id) ? "Remove layout heading" : "Add layout heading",
        value: "header"
      }, {
        title: "Move up",
        value: "up"
      }, {
        title: "Move down",
        value: "down"
      }, {
        title: "Toggle collapsed",
        value: "collapsed"
      }, {
        title: "Set colour",
        value: "color"
      }, {
        title: "Rename",
        value: "title"
      }, {
        title: "Open plugin settings",
        value: "settings"
      }];
      for (;;) {
        const action = await context.ui.dialog.select({
          get title() {
            return `Configure ${labelFor(id)}`;
          },
          get current() {
            return sticky;
          },
          get options() {
            return actionOptions();
          },
          get actions() {
            return [{
              bind: "alt+up",
              title: "Move up",
              selection: "none",
              onTrigger: () => reorder(id, -1)
            }, {
              bind: "alt+down",
              title: "Move down",
              selection: "none",
              onTrigger: () => reorder(id, 1)
            }];
          }
        });
        if (!action) return true;
        if (action === "up" || action === "down") {
          sticky = action;
          reorder(id, action === "up" ? -1 : 1);
          continue;
        }
        if (action === "settings") {
          await openPluginSettings(id);
          return false;
        }
        if (action === "title") {
          const title = await context.ui.dialog.prompt({
            title: "Section title",
            value: labelFor(id)
          });
          if (title !== undefined) setSection(id, {
            title: title || id
          });
          return false;
        }
        if (action === "color") {
          const choice = await context.ui.dialog.select({
            title: "Colour",
            options: COLORS.map(c => ({
              title: c,
              value: c
            }))
          });
          if (choice) setSection(id, {
            color: choice
          });
          return false;
        }
        if (action === "visible") {
          setSection(id, {
            visible: !isVisible(id)
          });
          return false;
        }
        if (action === "header") {
          setSection(id, {
            header: !hasHeader(id)
          });
          return false;
        }
        if (action === "collapsed") {
          setSection(id, {
            collapsed: !isCollapsed(id)
          });
          return false;
        }
        return false;
      }
    }
    async function configure() {
      if (!orderedIds().length) {
        await context.ui.dialog.alert({
          title: "Sidebar layout",
          message: "No adopted sidebar sections detected. Open a session so the sidebar mounts, or set includeBuiltin in sidebar-layout.json to manage the host's own sections."
        });
        return;
      }
      const sectionOptions = () => orderedIds().map(id => ({
        title: `${isVisible(id) ? "shown" : "hidden"} · ${hasHeader(id) ? isCollapsed(id) ? "collapsed" : "expanded" : "no heading"} · ${labelFor(id)}`,
        value: id
      }));
      for (;;) {
        const pick = await context.ui.dialog.select({
          title: "Sidebar section",
          get options() {
            return sectionOptions();
          }
        });
        if (!pick) return;
        if (!(await configureSection(pick))) return;
      }
    }

    // Sidebar plugins that own their settings expose a command under their own
    // id, so the layout can offer a shortcut once a plugin is adopted.
    function Probe() {
      onMount(() => {
        upgrade();
      });
      return _$createElement("box");
    }
    let dispose;
    let upgraded = false;
    function upgrade() {
      if (upgraded) return;
      if (!hostFromOwner()) return;
      upgraded = true;
      try {
        dispose?.();
      } catch {}
      dispose = context.ui.slot({
        replace: SIDEBAR_SLOT,
        render: slotInput => _$createComponent(Managed, {
          input: slotInput
        })
      });
    }
    if (config()?.mode !== "coexist") {
      dispose = context.ui.slot({
        prepend: SIDEBAR_SLOT,
        render: () => _$createComponent(Probe, {})
      });
    }
    context.keymap.layer(() => ({
      mode: "global",
      commands: [{
        id: "sidebar.layout.configure",
        title: "Configure sidebar layout",
        group: "Sidebar",
        palette: true,
        slash: {
          name: "sidebar-layout",
          aliases: ["layout"]
        },
        run: async () => {
          await configure();
        }
      }]
    }));
    return () => {
      try {
        dispose?.();
      } catch {}
    };
  }
});
