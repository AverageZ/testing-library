# React Contract Renderer

Test the contracts between React components with typed assertions. Check which children a component renders and which props it passes to them. Use shallow rendering to run these checks without a DOM renderer.

## Why does this library exist?

Mostly because I disagree with React Testing Library's approach. Testing how users use an application is a good goal. I prefer browser tests with Playwright or Cypress for that job.

RTL treats props and effects as implementation details that tests should avoid. As an application grows, those details become contracts between components and I want tests for those contracts.

> "The ability to improve a design occurs primarily at the interfaces. This is also the prime location for screwing it up."

— Akin's law #15

### DOM assertions can still couple a test to composition

React Testing Library (RTL) lets you find elements by role and accessible name and these queries help you check accessibility. A test that renders `App` can also depend on several layers of components just to effectively check a prop passed between two of them.

For example, `App` passes a session to `AppLayout`. The layout passes it to `Header`, which sets the label for `UserMenu`:

> [!NOTE]
> This might also be context or something like redux state but the idea is that a top level component passes down to a child.

```tsx
function App() {
  const session = useSession();
  return <AppLayout session={session} />;
}

function AppLayout({ session }: { session: Session | null }) {
  return <Header session={session} />;
}

function Header({ session }: { session: Session | null }) {
  return (
    <UserMenu
      aria-label={session?.isAdmin ? "Logged in as admin" : "Not logged in"}
    />
  );
}
```

An RTL test might render the whole app and find the button by role and name:

```tsx
render(<App />);

expect(
  screen.getByRole("button", { name: "Logged in as admin" }),
).toBeInTheDocument();
```

This assertion depends on the rendered button and its name. The test runs through `App`, `AppLayout`, `Header`, and `UserMenu` and a failure could start anywhere along that chain. Replacing the button with a link would also break the test, even if the administrator can still see that they are signed in.

> [!NOTE]
> Rendering the whole tree can also require providers, mock stores, and other setup. That is a lot of furniture to move just to check one prop.

The same issue occurs when a test renders a large tree to infer session state from labels:

```tsx
render(<App />);

expect(screen.queryByLabelText("Not logged in")).not.toBeInTheDocument();
expect(screen.getByLabelText("Logged in as admin")).toBeInTheDocument();
```

Choose the test based on the behavior you want to check:

- Use a browser test to check that an administrator can tell they are signed in.
- Use a focused RTL test to check the menu's role and accessible name.
- Use component-contract tests to check how `App`, `AppLayout`, `Header`, and `UserMenu` pass session data and derive the label.

### Test each interface and then the leaf's DOM contract

Split the checks by component. This can work well if you use a Connected & Presentational pattern. Each shallow test runs the component under test and inspects the props it gives its children. You can test that a Connected component maps or passes along data without having to worry about the internals of the Presentational bits.

```tsx
const admin = { isAdmin: true } as Session;

test("AppLayout passes the session to Header", () => {
  const { subject } = getComponentRenderer(AppLayout, {
    session: admin,
  }).shallow();

  expect(subject.find(Header).prop("session")).toBe(admin);
});

test("Header gives UserMenu the administrator label", () => {
  const { subject } = getComponentRenderer(Header, {
    session: admin,
  }).shallow();

  expect(subject.find(UserMenu).prop("aria-label")).toBe("Logged in as admin");
});

test("UserMenu exposes its label on a button", () => {
  const { subject } = getComponentRenderer(UserMenu, {
    "aria-label": "Logged in as admin",
  }).mount();
  const button = subject.find("button").getDOMNode();

  // A native button supplies the accessible role "button".
  expect(button.tagName).toBe("BUTTON");
  expect(button.getAttribute("aria-label")).toBe("Logged in as admin");
});
```

## Install

```sh
pnpm add -D @avgz/react-contract-renderer
```

React and React DOM are peer dependencies. The package supports matching stable versions of React 17.0.2, React 18.2–18.3, and React 19.0–19.3. Node.js 22 or newer is required.

## Quick start

```ts
import { afterEach, expect, test } from "vitest";
import { cleanup, getComponentRenderer } from "@avgz/react-contract-renderer";

afterEach(cleanup);

const renderer = getComponentRenderer(AccountPage, { accountId: "default" });

test("passes the active account to its panel", () => {
  const { subject } = renderer.shallow({ accountId: "active" });

  expect(subject.find(AccountPanel).prop("accountId")).toBe("active");
});
```

`find(AccountPanel)` infers `AccountPanel`'s props, so TypeScript checks both the prop name and the asserted value.

Use `mount()` to check DOM output:

```ts
const session = getComponentRenderer(SaveButton, { label: "Save" }).mount();

expect(session.subject.find("button").getDOMNode().textContent).toBe("Save");
```

## Rendering modes

| Mode        | Use it for                                  | What runs                                            |
| ----------- | ------------------------------------------- | ---------------------------------------------------- |
| `shallow()` | Child components and the props they receive | The target runs. Custom child components do not run. |
| `mount()`   | DOM output, refs, and host behavior         | The component tree renders into a DOM container.     |

Both modes wait until you access `subject` to start rendering. This lets you add providers first:

```tsx
const session = renderer.shallow().with(OuterProvider, InnerProvider);

expect(session.subject.find(AccountPanel).exists()).toBe(true);
```

Providers nest in argument order; the first provider is outermost. `mount()` requires a DOM environment such as Vitest's `jsdom` environment.

Register `cleanup` with your test runner's `afterEach` to unmount all sessions after each test.

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

A `Subject` is live: an existing selection reads the latest committed render after state changes or `rerender()`. Available inspections are `find`, `findAll`, `exists`, `props`, `prop`, `className`, `type`, `element`, `text`, and, after `mount()`, `getDOMNode`.

## Why choose it over React Testing Library?

[React Testing Library](https://testing-library.com/docs/react-testing-library/intro/) is a good choice for testing individual UI components. Use it to check roles, text, form input, and focus.

Use React Contract Renderer when you need to:

- Check that a parent renders a specific child with the expected, type-checked props.
- Run a component's own hooks and effects during a shallow test.
- Query components in both shallow and mounted tests with the same `Subject` API.

Both libraries can earn a place in the same test suite. Use RTL for user-facing behavior and accessibility checks. Use React Contract Renderer for component relationships and props that your application relies on.

## How is it different from Enzyme?

Enzyme established the useful idea of shallow-rendering a component as a unit and inspecting its children. React Contract Renderer keeps that narrow capability instead of recreating Enzyme's wrapper API.

Queries use component identities or intrinsic tag names rather than CSS selectors. Props are inferred by TypeScript rather than exposed through untyped string keys. Hooks and effects run in shallow tests on supported React versions.

There are no component-instance, state-mutation, selector-language, or simulated-event APIs. This is not a drop-in Enzyme replacement.

## Benchmarks

The included benchmark compares complete render-and-cleanup operations with `@testing-library/react/pure`. Each fixture gets 60 warm-ups and reports the median of 11 rounds. The three small fixtures run 1,000 operations per round. The application fixture runs 25 because each full render commits thousands of DOM nodes. The benchmark checks each renderer's output before timing it.

The application fixture is modeled on a large strategy game's board: a 20×24 map with three layers, 1,440 material tiles, units, mechanisms, environmental effects, fog of war, placed items, portraits, navigation, an action bar, a message log, an inventory dialog, and a combat forecast.

One local run on an Apple M4 Pro with Node 24.11.1, React 19.3.0, and jsdom 26.1.0 produced:

| Fixture              |  Shallow |     Mount | React Testing Library | Shallow vs. RTL | Mount vs. RTL |
| -------------------- | -------: | --------: | --------------------: | --------------: | ------------: |
| Leaf component       | 0.017 ms |  0.049 ms |              0.070 ms |     4.1× faster |    30% faster |
| Effect-driven update | 0.024 ms |  0.057 ms |              0.082 ms |     3.4× faster |    30% faster |
| 24-child tree        | 0.033 ms |  0.222 ms |              0.242 ms |     7.3× faster |     8% faster |
| Strategy game board  | 0.112 ms | 42.717 ms |             42.385 ms |     377× faster |   0.8% slower |

On the application fixture, shallow rendering runs `GameBoard` and records its immediate component contracts without rendering the thousands of descendant nodes. Mount and RTL both render the complete tree and finish within 1% of each other. The benchmark requires shallow to remain faster than RTL and allows mount a 10% margin around RTL for timing noise.

Run it on your hardware:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm benchmark
```

See [`scripts/benchmark.mjs`](scripts/benchmark.mjs) for the measurement method and [`scripts/benchmark-fixtures/strategy-game.mjs`](scripts/benchmark-fixtures/strategy-game.mjs) for the application fixture.

## Scope and tradeoffs

Use this library when component composition is a contract you deliberately want to maintain. Do not use it to prove accessibility, styling, layout, real browser behavior, or an end-to-end user flow.

Shallow rendering couples a test to component boundaries. That coupling is the feature, but it should be intentional: test stable application interfaces, not every wrapper or incidental implementation detail.
