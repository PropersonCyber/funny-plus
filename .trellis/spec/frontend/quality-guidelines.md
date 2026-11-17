# Quality Guidelines

> Code quality standards for frontend development.

---

## Overview

This project ships one ReactLynx codebase to iOS / Android / Web. Two consequences
shape everything below:

- **TypeScript does not cover the Lynx runtime contract.** A `main-thread:` callback
  without the `'main thread'` directive type-checks cleanly and still breaks the page.
- **Anything that fails during render takes the whole page blank**, not just one
  component. There is no error boundary between tabs.

So the gates here are: `tsc --noEmit`, `rstest run`, and a real tap in the web preview.

---

## Main Thread Script (MTS)

Main-thread callbacks run on the UI thread via `'main thread'` functions and
`main-thread:` event prefixes. The directive is a **compiler contract, not a comment**.

### Required Patterns

**1. `'main thread';` must be the FIRST statement of the function body.**

The SWC worklet pass (`swc_plugin_worklet`) only converts a function into a worklet
when the directive is the first statement. A misplaced or missing directive leaves the
function untransformed, so it reaches the runtime as an ordinary JS function and the
runtime rejects it.

```tsx
// correct — directive first
main-thread:ref={(el: MainThread.Element) => { 'main thread'; mtMarkersRef.current[s.order - 1] = el; }}

// wrong — directive second: silently not a worklet
main-thread:ref={(el: MainThread.Element) => { mtMarkersRef.current[s.order - 1] = el; 'main thread'; }}
```

This is the same rule the compiler snapshots pin down in
`swc_plugin_worklet/tests/__swc_snapshots__/lib.rs/should_not_transform_when_wrong_directives.js`.

**2. Prefer `useMainThreadRef` over an inline `main-thread:ref` arrow.**

`useMainThreadRef()` returns a `MainThreadRef` (`_wvid`), which the runtime resolves
directly. An inline arrow becomes a worklet (`_wkltId`) that is **re-registered on every
render**, because the compiler mints a fresh worklet id per inline function.

```tsx
// preferred
const mtBaseRef = useMainThreadRef<MainThread.Element>(null);
<image main-thread:ref={mtBaseRef} ... />

// acceptable but re-registers each render — see MapPage markers, where per-item
// refs force the inline form
main-thread:ref={(el: MainThread.Element) => { 'main thread'; ... }}
```

**3. A worklet may only call main-thread functions.**

Inside a `'main thread'` body, calling an ordinary background-thread function fails at
runtime. That is why `MapPage` reimplements the `Gesture` helpers as `mtBegin` /
`mtMove` / `projectMt` instead of importing them from `mapGesture.ts`.

### Forbidden Patterns

**`main-thread:ref` with a function that has no `'main thread'` directive.**

The runtime throws from `updateWorkletRef`:

```
Error: MainThreadRef: main-thread:ref must be of type MainThreadRef or main-thread function.
```

The throw happens inside the snapshot patch, so `renderPage` aborts mid-patch and the
page renders empty. Observed result: the tab bar was the only thing left on screen.

### Common Mistakes

| Mistake | Why it is invisible |
|---|---|
| Adding `'main thread';` as a normal statement, not the first one | `tsc` passes; the directive is just a string expression to the type checker |
| Assuming `main-thread:` props are type-checked | `main-thread:ref?: Ref<MainThread.Element>` accepts a plain arrow function |
| Adding a directive to a function that only runs on the background thread | No-ops silently |
| Testing only the web build | The same error string exists in `main.lynx.bundle`; a green web build does not clear the native bundle |

---

## Verification Before Reporting Done

A green `tsc` is not evidence that the Lynx runtime accepted the code. For any change
that touches `main-thread:` props, gestures, or rendering:

1. `npx tsc --noEmit -p src/tsconfig.json`
2. `npx rstest run`
3. `npm run build` — confirms the worklet was extracted into both bundles
4. Open the web preview, navigate to the affected tab, and confirm content renders and
   the console has no `MainThreadRef` / snapshot errors
5. For native-affecting changes, `npm run build:ios` and tap once in the simulator

**Gate on the console, not the exit code.** A snapshot error is reported through
`lynx.reportError` and does not fail any build command.

---

## Required Patterns (General)

- Public props are typed explicitly; no `any` at module boundaries.
- Shared domain logic lives in `shared/` (pure TS, no DOM) so both bundles use one copy.
- Styles are CSS Modules per page; see `docs/` for visual references before changing layout.

---

## Code Review Checklist

- [ ] Does every `main-thread:` callback have `'main thread';` as its first statement?
- [ ] Could that callback use `useMainThreadRef` instead of an inline arrow?
- [ ] Does any `'main thread'` body call a background-thread function?
- [ ] Was the change verified in the web preview, or only by `tsc`?
- [ ] Does the change touch a layer the acceptance criteria do not mention?