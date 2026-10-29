import { Plugin, usePlugin } from "@opencode/plugin/tui";
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  ErrorBoundary,
  For,
  getOwner,
  onMount,
  Show,
} from "solid-js";
import { TextAttributes } from "@opentui/core";

const SIDEBAR_SLOT = "sidebar.content";
const PLUGIN_ID = "sidebar.layout";
const COLORS = ["base", "muted", "success", "warning", "error", "info"];
const BUILTIN = /^opencode[./]/;
const ACRONYMS: Record<string, string> = {
  mcp: "MCP",
  ai: "AI",
  lsp: "LSP",
  vcs: "VCS",
  cli: "CLI",
  url: "URL",
};
// Friendly headings used when a section opts into a layout-drawn heading.
const KNOWN_TITLES: Record<string, string> = {
  "timezone.clocks": "Clocks",
  "plugins.pane": "Plugins",
  "mcp.manager": "MCP",
  "streetturtle.recap": "Recap",
  "streetturtle.context-progress": "Context",
};

interface SectionConfig {
  order?: number;
  visible?: boolean;
  header?: boolean;
  collapsed?: boolean;
  color?: string;
  title?: string;
}

// The host keeps every plugin's slot claims in a Solid context that it provides
// around the whole TUI tree. A plugin cannot reach another plugin's registered
// render through the public slot API, but its own render is mounted inside that
// tree, so the host context is reachable by walking the Solid owner chain and
// looking for the object that exposes `slots.resolved` and `registered`.
function hostFromOwner(): any {
  let owner: any;
  try {
    owner = getOwner();
  } catch {
    return undefined;
  }
  while (owner) {
    const context = owner.context;
    if (context && typeof context === "object") {
      for (const key of Object.getOwnPropertySymbols(context)) {
        const value = (context as any)[key];
        if (
          value &&
          typeof value === "object" &&
          value.slots &&
          typeof value.slots.resolved === "function" &&
          typeof value.registered === "function"
        ) {
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
function suppressedSidebarClaims(host: any): any[] {
  if (!host) return [];
  let resolved: any;
  try {
    resolved = host.slots.resolved();
  } catch {
    return [];
  }
  const mine = resolved?.slotted?.get?.(SIDEBAR_SLOT)?.replace;
  if (!mine) return [];
  const claims: any[] = [];
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

function normalizeName(value: string) {
  return String(value)
    .toLowerCase()
    .replace(/^.*[/:]/, "")
    .replace(/^opencode[-_]?/, "")
    .replace(/[^a-z0-9]/g, "");
}

function shortenVersion(value: string) {
  return /^[a-f0-9]{40}$/i.test(value) || /^[a-f0-9]{64}$/i.test(value)
    ? value.slice(0, 7)
    : value;
}

function isBuiltin(id: string) {
  return BUILTIN.test(String(id));
}

// Friendly default heading for an adopted plugin, so the sidebar does not show
// raw reverse-DNS ids such as "opencode.sidebar.mcp".
function defaultTitle(id: string) {
  const tail = String(id)
    .replace(/^opencode[./]/, "")
    .replace(/^sidebar[./]/, "")
    .replace(/^plugin[./]/, "");
  const last = tail.split(/[./]/).filter(Boolean).pop() ?? String(id);
  return (
    last
      .split(/[-_]/)
      .filter(Boolean)
      .map(
        (word) =>
          ACRONYMS[word.toLowerCase()] ??
          word.charAt(0).toUpperCase() + word.slice(1),
      )
      .join(" ") || String(id)
  );
}

// Pure list reorder used by drag reordering: moves `id` to sit immediately
// before or after `targetId`, keeping every other entry in relative order.
// Returns the new order, or undefined when the move would change nothing.
export function moveWithin(
  ids: string[],
  id: string,
  targetId: string,
  after: boolean,
): string[] | undefined {
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

export default Plugin.define({
  id: PLUGIN_ID,
  async setup(context: any) {
    const home = (globalThis as any)?.process?.env?.HOME || "/home/craig";
    const configPath = `${home}/.config/opencode/sidebar-layout.json`;
    const defaults = {
      mode: "adopt",
      includeBuiltin: false,
      collapseByDefault: context.options?.collapsedByDefault !== false,
      dragReorder: true,
      sections: {} as Record<string, SectionConfig>,
    };
    let loaded: any = defaults;
    try {
      const fsMod: any = await import("node:fs");
      loaded = {
        ...defaults,
        ...JSON.parse(fsMod.readFileSync(configPath, "utf8")),
      };
      if (!loaded.sections || typeof loaded.sections !== "object") {
        loaded.sections = {};
      }
    } catch {}

    const [config, setConfig] = createSignal<any>(loaded);
    const updateConfig = async (fn: (draft: any) => void) => {
      const draft = JSON.parse(JSON.stringify(config()));
      if (!draft.sections || typeof draft.sections !== "object") {
        draft.sections = {};
      }
      fn(draft);
      setConfig(draft);
      try {
        const fsMod: any = await import("node:fs");
        fsMod.writeFileSync(configPath, JSON.stringify(draft, null, 2) + "\n");
      } catch {}
    };

    const [detected, setDetected] = createSignal<string[]>([]);

    // Best-effort version/source label per plugin, from the server inventory
    // first and the local TUI plugin list second.
    const [sources] = createResource(async () => {
      const index: Record<string, string> = {};
      try {
        const location = context.location ?? context.data.location.default();
        const res = await context.client.plugin.list({ location });
        const rows = (res && (res.data ?? res)) || [];
        for (const row of Array.isArray(rows) ? rows : []) {
          const version = row?.source?.version;
          const target = row?.source?.target;
          const label = version
            ? shortenVersion(String(version))
            : target
              ? String(target)
              : undefined;
          if (!label) continue;
          if (row?.id) index[normalizeName(String(row.id))] = label;
          if (target) index[normalizeName(String(target))] = label;
        }
      } catch {}
      try {
        const fsMod: any = await import("node:fs");
        const parsed = JSON.parse(
          fsMod.readFileSync(`${home}/.config/opencode/cli.json`, "utf8"),
        );
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

    const section = (id: string): SectionConfig =>
      config()?.sections?.[id] ?? {};
    const collapseDefault = () => config()?.collapseByDefault !== false;
    const includeBuiltin = () => config()?.includeBuiltin === true;
    // Built-ins pass through untouched by default; third-party plugins are
    // always managed. Setting includeBuiltin adopts the host's own sections too.
    const isManaged = (id: string) => includeBuiltin() || !isBuiltin(id);
    // No layout-drawn heading by default: every known sidebar plugin already
    // renders its own heading, so drawing a second one would duplicate it. This
    // also keeps the default safe for third-party plugins the layout has never
    // seen. A section that wants a managed heading sets header: true.
    const hasHeader = (id: string) =>
      isManaged(id) && section(id).header === true;
    const isVisible = (id: string) => section(id).visible !== false;
    const isCollapsed = (id: string) =>
      section(id).collapsed ?? collapseDefault();
    const colorName = (id: string) => section(id).color ?? "base";
    const labelFor = (id: string) =>
      section(id).title ?? KNOWN_TITLES[id] ?? defaultTitle(id);
    const versionFor = (id: string) => {
      const label = sources()?.[normalizeName(id)];
      return label ? ` · ${label}` : "";
    };

    const setSection = (id: string, patch: Partial<SectionConfig>) =>
      updateConfig((draft) => {
        draft.sections[id] = { ...(draft.sections[id] ?? {}), ...patch };
      });

    // Managed groups keep their registered order unless an explicit section
    // order moves them. Built-in pass-through groups always keep their slot.
    const orderKey = (group: { id: string; index: number }) => {
      const order = section(group.id).order;
      if (typeof order === "number") return order;
      return 1e3 + group.index;
    };

    const orderedIds = () =>
      detected()
        .map((id, index) => ({ id, index }))
        .filter((group) => isManaged(group.id))
        .sort((a, b) => orderKey(a) - orderKey(b) || a.index - b.index)
        .map((group) => group.id);

    // Ordering is persisted as an explicit `order` index per section, so a
    // reorder survives the next launch and applies to hidden sections too.
    function persistOrder(ids: string[]) {
      updateConfig((draft) => {
        ids.forEach((sid, i) => {
          draft.sections[sid] = { ...(draft.sections[sid] ?? {}), order: i };
        });
      });
    }

    function reorder(id: string, delta: number) {
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
    function moveTo(id: string, targetId: string, after: boolean) {
      const next = moveWithin(orderedIds(), id, targetId, after);
      if (next) persistOrder(next);
    }

    function color(name: string) {
      return (context.theme?.text as any)?.[name] ?? context.theme?.text?.base;
    }

    function Managed(props: { input: any }) {
      const ctx = usePlugin();
      const groups = createMemo(() => {
        const map = new Map<
          string,
          { id: string; index: number; claims: any[] }
        >();
        let index = 0;
        for (const claim of suppressedSidebarClaims(hostFromOwner())) {
          const id = String(claim.plugin);
          let group = map.get(id);
          if (!group) {
            group = { id, index: index++, claims: [] };
            map.set(id, group);
          }
          group.claims.push(claim);
        }
        return [...map.values()];
      });
      createEffect(() => setDetected(groups().map((group) => group.id)));

      const visibleGroups = createMemo(() =>
        groups()
          .filter((group) => isVisible(group.id))
          .sort((a, b) => orderKey(a) - orderKey(b) || a.index - b.index),
      );

      // Drag reordering. Ctrl is the only modifier the renderer excludes from
      // its text-selection path, so ctrl + left-drag reorders instead of
      // selecting the section content under the pointer. Drag events reach the
      // pressed renderable and bubble up to its section wrapper; `over` reaches
      // the wrapper under the pointer; `drop` reaches the wrapper it lands on.
      const [dragId, setDragId] = createSignal<string | undefined>();
      const [dropTarget, setDropTarget] = createSignal<
        { id: string; after: boolean } | undefined
      >();
      const dragEnabled = () => config()?.dragReorder !== false;

      const onSectionMouse = (id: string, e: any) => {
        if (!dragEnabled()) return;
        const type = e?.type;
        if (type === "down") {
          if (e?.button === 0 && e?.modifiers?.ctrl) {
            setDragId(id);
            setDropTarget(undefined);
          }
          return;
        }
        if (type === "over") {
          const active = dragId();
          if (!active || active === id) return;
          const rect = e?.currentTarget;
          const top = rect?.screenY ?? rect?.y ?? 0;
          const height = rect?.height ?? 0;
          const after = Number(e?.y ?? top) > top + height / 2;
          setDropTarget({ id, after });
          return;
        }
        if (type === "drop") {
          const active = dragId();
          const target = dropTarget();
          if (active && target && target.id !== active) {
            moveTo(active, target.id, target.after);
          }
          setDropTarget(undefined);
          return;
        }
        if (type === "up" || type === "drag-end") {
          setDragId(undefined);
          setDropTarget(undefined);
        }
      };

      const dragStatus = () => {
        const active = dragId();
        if (!active) return "";
        const target = dropTarget();
        if (!target)
          return `Moving ${labelFor(active)} · release over a section`;
        return `Moving ${labelFor(active)} · ${target.after ? "after" : "before"} ${labelFor(target.id)}`;
      };

      const claimView = (claim: any, id: string) => (
        <ErrorBoundary
          fallback={(error: any) => (
            <text fg={ctx.theme.text.error}>{`${id}: ${String(error)}`}</text>
          )}
        >
          {claim.render(props.input)}
        </ErrorBoundary>
      );

      return (
        <box flexDirection="column" marginTop={1}>
          <For each={visibleGroups()}>
            {(group) =>
              hasHeader(group.id) ? (
                <box
                  flexDirection="column"
                  marginTop={1}
                  onMouse={(e: any) => onSectionMouse(group.id, e)}
                >
                  <box
                    onMouseDown={(e: any) => {
                      // Ctrl + drag reorders the section rather than collapsing
                      // it, so the heading never toggles on a ctrl press.
                      if (e?.modifiers?.ctrl) return;
                      try {
                        e?.stopPropagation?.();
                      } catch {}
                      setSection(group.id, {
                        collapsed: !isCollapsed(group.id),
                      });
                    }}
                  >
                    <text
                      fg={color(colorName(group.id))}
                      attributes={TextAttributes.BOLD}
                    >
                      {(isCollapsed(group.id) ? "▶ " : "▼ ") +
                        labelFor(group.id) +
                        versionFor(group.id)}
                    </text>
                  </box>
                  <Show when={!isCollapsed(group.id)}>
                    <box flexDirection="column" paddingLeft={1}>
                      <For each={group.claims}>
                        {(claim: any) => claimView(claim, group.id)}
                      </For>
                    </box>
                  </Show>
                </box>
              ) : (
                <box
                  flexDirection="column"
                  marginTop={1}
                  onMouse={(e: any) => onSectionMouse(group.id, e)}
                >
                  <For each={group.claims}>
                    {(claim: any) => claimView(claim, group.id)}
                  </For>
                </box>
              )
            }
          </For>
          <Show when={dragStatus()}>
            <text fg={color("info")}>{dragStatus()}</text>
          </Show>
        </box>
      );
    }

    async function openPluginSettings(id: string) {
      let commands: any[] = [];
      try {
        commands = Array.from(context.keymap.commands() ?? []);
      } catch {}
      const matches = commands.filter(
        (command) =>
          command?.palette &&
          typeof command?.id === "string" &&
          command.id.startsWith(`${id}.`),
      );
      if (!matches.length) {
        await context.ui.dialog.alert({
          title: labelFor(id),
          message: `No settings command found for ${id}.`,
        });
        return;
      }
      if (matches.length === 1) {
        context.keymap.dispatch(matches[0].id);
        return;
      }
      const pick = await context.ui.dialog.select({
        title: `${labelFor(id)} settings`,
        options: matches.map((command) => ({
          title: command.title ?? command.id,
          value: command.id,
        })),
      });
      if (pick) context.keymap.dispatch(pick);
    }

    // The section action menu keeps `Move up`/`Move down` open so a section can
    // be nudged repeatedly without reopening the menu and re-selecting the
    // entry. The move actions are also bound to alt+arrow as dialog footer
    // actions, which the host triggers without closing the dialog. Escape
    // returns to the section list; a second Escape at the list closes the flow.
    async function configureSection(id: string): Promise<boolean> {
      let sticky: string | undefined;
      const actionOptions = () => [
        { title: "Toggle visibility", value: "visible" },
        {
          title: hasHeader(id) ? "Remove layout heading" : "Add layout heading",
          value: "header",
        },
        { title: "Move up", value: "up" },
        { title: "Move down", value: "down" },
        { title: "Toggle collapsed", value: "collapsed" },
        { title: "Set colour", value: "color" },
        { title: "Rename", value: "title" },
        { title: "Open plugin settings", value: "settings" },
      ];
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
            return [
              {
                bind: "alt+up",
                title: "Move up",
                selection: "none" as const,
                onTrigger: () => reorder(id, -1),
              },
              {
                bind: "alt+down",
                title: "Move down",
                selection: "none" as const,
                onTrigger: () => reorder(id, 1),
              },
            ];
          },
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
            value: labelFor(id),
          });
          if (title !== undefined) setSection(id, { title: title || id });
          return false;
        }
        if (action === "color") {
          const choice = await context.ui.dialog.select({
            title: "Colour",
            options: COLORS.map((c) => ({ title: c, value: c })),
          });
          if (choice) setSection(id, { color: choice });
          return false;
        }
        if (action === "visible") {
          setSection(id, { visible: !isVisible(id) });
          return false;
        }
        if (action === "header") {
          setSection(id, { header: !hasHeader(id) });
          return false;
        }
        if (action === "collapsed") {
          setSection(id, { collapsed: !isCollapsed(id) });
          return false;
        }
        return false;
      }
    }

    async function configure() {
      if (!orderedIds().length) {
        await context.ui.dialog.alert({
          title: "Sidebar layout",
          message:
            "No adopted sidebar sections detected. Open a session so the sidebar mounts, or set includeBuiltin in sidebar-layout.json to manage the host's own sections.",
        });
        return;
      }
      const sectionOptions = () =>
        orderedIds().map((id) => ({
          title: `${isVisible(id) ? "shown" : "hidden"} · ${
            hasHeader(id)
              ? isCollapsed(id)
                ? "collapsed"
                : "expanded"
              : "no heading"
          } · ${labelFor(id)}`,
          value: id,
        }));
      for (;;) {
        const pick = await context.ui.dialog.select({
          title: "Sidebar section",
          get options() {
            return sectionOptions();
          },
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
      return <box />;
    }

    let dispose: (() => void) | undefined;
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
        render: (slotInput: any) => <Managed input={slotInput} />,
      });
    }

    if (config()?.mode !== "coexist") {
      dispose = context.ui.slot({
        prepend: SIDEBAR_SLOT,
        render: () => <Probe />,
      });
    }

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "sidebar.layout.configure",
          title: "Configure sidebar layout",
          group: "Sidebar",
          palette: true,
          slash: { name: "sidebar-layout", aliases: ["layout"] },
          run: async () => {
            await configure();
          },
        },
      ],
    }));

    return () => {
      try {
        dispose?.();
      } catch {}
    };
  },
});
