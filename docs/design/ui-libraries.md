# UI libraries: what to reuse, what to hand-roll (#764)

AI-built UI looks generic when every component is written from scratch or default shadcn ships unstyled.
Designer and implementer sessions check this page before writing a new web component.
The role prompts in `server/dispatch/roles.js` point here.

## Rules

1. **Foundations.** Build on what is installed: `radix-ui` primitives and the shadcn-style files in `web/src/components/ui/`. Restyle them with the tokens in `web/src/index.css` (`--background`, `--radius`, …). Don't ship stock shadcn colors, radii or shadows. Base UI is the other headless option; propose it only where Radix lacks a primitive.
2. **Specialists, not hand-rolled.** For the components below, AI skips the small details (stacking, swipe, focus, timing, a11y). Use the library in the table instead of writing your own.
3. **Showcase libraries are inspiration only.** Magic UI, Aceternity, 21st.dev, Beautiful UI, RareUI: look, don't install. Copy at most one piece per screen, on purpose, restyled with our tokens, and say so in the PR.
4. **One standout per screen.** A screen gets at most one expressive element (an animated number, a gradient, a motion moment). Everything else stays quiet: tokens, plain borders, CSS transitions.
5. **New dependencies are proposals.** A library marked "proposed" is not installed. Write it in the PR or issue with why; it lands only after approval in the UI pass. Until then, keep using the current code.

## Component → library → when to hand-roll

| Component | Library | Status | Hand-roll when |
| --- | --- | --- | --- |
| Dialog, popover, menu, select, tabs, switch | `radix-ui` via `web/src/components/ui/` | installed | Never for these; restyle the wrapper instead |
| Side sheet | `ui/sheet.tsx` (Radix Dialog) | installed | Never; extend `sheet.tsx` |
| Command menu (⌘K) | `cmdk` via `ui/command.tsx` | installed | Never |
| Class names, variants | `clsx` + `tailwind-merge`, `class-variance-authority` | installed | Never |
| Icons | `lucide-react` | installed | Brand marks only (vendored SVG) |
| Toasts | `sonner` via `ui/sonner.tsx` and `activity/actionToast.ts` | installed (#899) | Never. Only results of what the person just did (save, allow/deny, 시작하기, copy); agent events go to the 알림함 (`activity/appInbox.ts`), not a toast |
| Drawer / bottom sheet (phone width) | Vaul | proposed | Desktop side panels: use `sheet.tsx` |
| Animated number (usage %, ETA, cost) | NumberFlow | proposed | Static numbers: plain text with `tabular-nums` |
| Hover, fade, small enter/exit | none (CSS transitions, `tw-animate-css`) | installed | Always; no motion library for these |
| Showcase effect (glow, beam, marquee) | Magic UI / Aceternity / 21st.dev as reference | not installed | At most one per screen, copied and restyled (rule 3) |
| Anything not in this table | Ask in the PR first | — | When no maintained library fits and the piece is under ~100 lines |

## pick-ui-library skill (evaluated)

Emil Kowalski's `pick-ui-library` (github.com/emilkowalski/skills, MIT) is a lookup table of curated libraries.
Decision: don't install it for sessions.

- It sets `disable-model-invocation: true`, so agent sessions would not load it on their own.
- Its primitive pick is Base UI; we are on Radix and don't churn that.
- It lists libraries we don't use (zustand, motion, recharts, Leva…), which invites new dependencies.

Its useful parts (Sonner, Vaul, cmdk, NumberFlow, "check package.json first", "one library, not a menu") are in the table above.

Related: #730 (notifications), #732 (in-app modals), #727 (designer-led layout).
