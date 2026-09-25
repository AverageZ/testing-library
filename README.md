# React Contract Renderer

Typed component-contract tests for React. Assert which children a component renders and which props it passes without rendering every descendant.

```tsx
import { afterEach, expect, test } from "vitest";
import { cleanup, getComponentRenderer } from "react-contract-renderer";

afterEach(cleanup);

const renderer = getComponentRenderer(AccountPage, {
  accountId: "default",
});

test("passes the active account to its panel", () => {
  const { subject } = renderer.shallow({ accountId: "active" });

  expect(subject.find(AccountPanel).prop("accountId")).toBe("active");
});
```

`find(AccountPanel)` infers `AccountPanel`'s props, so both the prop name and asserted value remain checked by TypeScript.

## Why use it?

A relationship between two components can be an application contract even when it is not directly visible in the DOM. Inferring that relationship from a fully rendered tree makes failures broader: a test for `App` passing `session` to `Header` can also fail because of a change several components lower in the tree.

React Contract Renderer lets each test stop at the boundary it owns:

- **Local failures:** shallow rendering runs the target but keeps custom children opaque. A broken child cannot fail its parent's contract test.
- **Typed prop assertions:** component identity drives `find()`, `props()`, and `prop()` inference. Renamed or incompatible props fail type checking.
- **Modern shallow rendering:** hooks, effects, state updates, context, fragments, `memo`, `forwardRef`, lazy components, and class lifecycles run in the target component.
- **One query API:** the same live `Subject` methods work for shallow and DOM-mounted sessions.
- **Deliberate lifecycle control:** sessions initialize lazily, accept provider wrappers, preserve state across `rerender()`, expose async `act()`, and clean up explicitly.
- **Small surface:** query by component identity or host tag, then inspect the contract. There are no CSS-selector, event-simulation, or component-instance APIs.

## Install

```sh
pnpm add -D react-contract-renderer
```

React and React DOM are peer dependencies. The package supports matching stable versions of React 17.0.2, React 18.2–18.3, and React 19.0–19.3. Node.js 22 or newer is required.

## Choose the boundary you mean to test

| Question                                                                                    | Best tool                                                  |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Does this parent render the expected child and pass the right typed props?                  | React Contract Renderer `shallow()`                        |
| Does this component produce the expected host DOM, refs, and browser-facing attributes?     | React Contract Renderer `mount()` or React Testing Library |
| Can a user find, operate, and understand this UI by role, name, text, focus, or form state? | React Testing Library                                      |
| Does the complete application work in a real browser?                                       | Playwright or Cypress                                      |

React Testing Library and React Contract Renderer test different contracts. Testing Library intentionally queries DOM nodes the way users encounter them. React Contract Renderer intentionally queries component identities and props. Use both when both boundaries matter; do not replace an accessibility or user-flow test with a prop assertion.

### Compared with React Testing Library

|                                           | React Contract Renderer                      | React Testing Library                                       |
| ----------------------------------------- | -------------------------------------------- | ----------------------------------------------------------- |
| Primary contract                          | Component composition and props              | User-observable DOM behavior                                |
| Queries                                   | Component identity or intrinsic tag          | Role, accessible name, label, text, and other DOM semantics |
| Rendering                                 | Target-only shallow render or full DOM mount | Full DOM render                                             |
| Descendant components in the focused mode | Opaque under `shallow()`                     | Rendered                                                    |
| Prop inference after a query              | Inferred from the selected component         | Not applicable; queries return DOM nodes                    |
| Best failure locality                     | Parent/child interfaces                      | Visible behavior and accessibility                          |

### Compared with Enzyme

Enzyme established the useful idea of shallow-rendering a component as a unit and inspecting child components. React Contract Renderer keeps that narrow capability rather than recreating Enzyme's wrapper ecosystem:

- component identities and intrinsic tag names instead of CSS selectors;
- TypeScript-inferred props instead of untyped string-keyed assertions;
- hooks and effects in shallow tests on supported modern React versions;
- public React DOM rendering for `mount()`, with read-only, version-gated inspection;
- no component instances, state mutation, selector language, or simulated events.

It is not a drop-in Enzyme replacement.

## Rendering modes

```tsx
const renderer = getComponentRenderer(SaveButton, { label: "Save" });

const shallow = renderer.shallow();
expect(shallow.subject.find(Icon).prop("name")).toBe("save");

const mounted = renderer.mount();
expect(mounted.subject.find("button").getDOMNode().textContent).toBe("Save");
```

| Mode        | Use it for                                  | What runs                                                |
| ----------- | ------------------------------------------- | -------------------------------------------------------- |
| `shallow()` | Child components and the props they receive | The target runs; custom child components do not          |
| `mount()`   | DOM output, refs, and host behavior         | The complete component tree renders into a DOM container |

`mount()` requires a DOM environment such as Vitest's `jsdom` environment. Both modes render on the first observation or update, so providers can be configured before mounting:

```tsx
const session = renderer.shallow().with(OuterProvider, InnerProvider);

expect(session.subject.find(AccountPanel).exists()).toBe(true);
```

Providers nest in argument order; the first provider is outermost.

## API at a glance

```ts
const session = getComponentRenderer(Component, defaultProps).shallow(
  overrides,
);

session.with(Provider);
session.subject.find(Child).prop("value");
session.subject.findAll("li");
session.rerender(partialProps);
await session.act(async () => {
  await request;
});
session.flush();
session.unmount();
```

A `Subject` is live: an existing selection reads the latest committed render after state changes or `rerender()`. Available inspections are `find`, `findAll`, `exists`, `props`, `prop`, `className`, `type`, `element`, `text`, and—after `mount()`—`getDOMNode`.

Register global cleanup with the test runner:

```ts
afterEach(cleanup);
```

## Benchmarks

The included benchmark measures complete render-and-cleanup operations against `@testing-library/react/pure`. Each fixture gets 60 warm-ups, then reports the median of 11 rounds. The three microbenchmarks run 1,000 operations per round; the application fixture runs 25 because each full render commits thousands of DOM nodes. Order rotates between implementations, and shallow, mount, and RTL output is checked before timing.

The large fixture is a self-contained extraction modeled on `strategy-game-3`'s largest board and its `GameBoard` boundaries: a 20×24 map with three layers, 1,440 material tiles, 48 units, 30 mechanisms, 96 environmental effects, fog of war, placed items, corpses, portraits, layer navigation, an action bar, a message log, a 24-item inventory dialog, and a combat forecast. It preserves the production component shape and scale without making this package depend on a sibling application.

One local run on an Apple M4 Pro with Node 24.11.1, React 19.3.0, and jsdom 26.1.0 produced:

| Fixture              |  Shallow |     Mount | React Testing Library | Shallow vs. RTL | Mount vs. RTL |
| -------------------- | -------: | --------: | --------------------: | --------------: | ------------: |
| Leaf component       | 0.017 ms |  0.049 ms |              0.070 ms |     4.1× faster |    30% faster |
| Effect-driven update | 0.024 ms |  0.057 ms |              0.082 ms |     3.4× faster |    30% faster |
| 24-child tree        | 0.033 ms |  0.222 ms |              0.242 ms |     7.3× faster |     8% faster |
| Strategy game board  | 0.112 ms | 42.717 ms |             42.385 ms |     377× faster |   0.8% slower |

The important bit here is the shape of the scaling vs. just the flat duration. On the strategy-game workload, shallow rendering executes `GameBoard` (think chess board with materials, units, ASCII effects like fire and smoke, etc.) and records its immediate component contracts while leaving the thousands of descendant nodes opaque. Mount and RTL both render the complete application tree and land within 1% of each other which is to be expected. The command enforces that shallow remains faster than RTL and that mount stays within 10% of the RTL baseline; the mount margin accommodates normal timing noise between two full DOM renderers.

Reproduce the measurement on your hardware:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm benchmark
```

See [`scripts/benchmark.mjs`](scripts/benchmark.mjs) for the measurement method and [`scripts/benchmark-fixtures/strategy-game.mjs`](scripts/benchmark-fixtures/strategy-game.mjs) for the application fixture.

## Inspirations

- [Enzyme's shallow renderer](https://enzymejs.github.io/enzyme/docs/api/shallow.html) demonstrated the value of testing a component without indirectly asserting on child implementations.
- [Testing Library's guiding principles](https://testing-library.com/docs/guiding-principles/) define the complementary user-facing boundary. React Contract Renderer is intentionally for the component interface checks those principles exclude.
- [React's former shallow and test renderers](https://react.dev/warnings/react-test-renderer) showed the usefulness of non-DOM component inspection. They are now deprecated; this package provides a smaller, version-tested contract API rather than exposing their renderer trees.
- Akin's law #15: “The ability to improve a design occurs primarily at the interfaces. This is also the prime location for screwing it up.”

## Scope and tradeoffs

Use this library when component composition is a contract you deliberately want to maintain. Do not use it to prove accessibility, styling, layout, real browser behavior, or an end-to-end user flow.

Shallow rendering couples a test to component boundaries. That coupling is the feature here, but it should be intentional: test stable application interfaces, not every wrapper or incidental implementation detail.
