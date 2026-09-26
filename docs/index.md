<!--Heading 1 = name from typedoc.json-->

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
> This might also be context or something like redux state but the idea is that a top level component passes down to a child

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

### Test each interace and then the leaf's DOM contract

Split the checks by component, this can work well if you do a Connected & Presentational pattern. Each shallow test runs the component under test and inspects the props it gives its children. You can test that a Connected component maps or passes along data without having to worry about the internals of the Presentational bits.

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

## Why choose it over React Testing Library?

[React Testing Library](https://testing-library.com/docs/react-testing-library/intro/) is a good choice for testing individual UI components. Use it to check roles, text, form input, and focus.

Use React Contract Renderer when you need to:

- Check that a parent renders a specific child with the expected, type-checked props.
- Run a component's own hooks and effects during a shallow test.
- Query components in both shallow and mounted tests with the same `Subject` API.

Both libraries can earn a place in the same test suite. Use RTL for user-facing behavior and accessibility checks; Use React Contract Renderer for component relationships and props that your application relies on.

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

Both modes wait until you access `subject` to start rendering. To add providers, chain `.with(OuterProvider, InnerProvider)` before that access. Register `cleanup` with your test runner's `afterEach` to unmount all sessions after each test.

## Query explicit slot contracts

`Subject.tree(prop)` inspects React elements already present in a React-node-valued prop without rendering them. Arrays flatten, fragments are transparent, and host children are traversed. Custom components stay opaque until another explicit `tree` call:

```ts
const content = session.subject.find(Modal).tree("children").find(ModalContent);
const preview = content.tree("content").find(DamagePreview);
const actions = content.tree("footer").findAll(Button);
```

This does not change `Subject.find` traversal. Both `Subject` and the returned `QueryTree` support `find`, `findAll`, `findByTestId`, and `findAllByTestId`. Selections remain live after `act` and `rerender`; plural selections track match indices, so re-query the list after insertion or reordering. Prop-tree selections never have associated DOM, even when the session is mounted.

## Identify technical targets

```ts
const save = session.subject.findByTestId("account-save", SaveButton);
const rows = content.tree("content").findAllByTestId("stats-row", "div");
```

IDs match exact `data-testid` values, including the query root, without CSS semantics. An optional component identity or intrinsic tag validates the match and preserves prop inference; it does not filter away wrong types or duplicate IDs. Omit it for generic props with `unknown` values. Singular inspections reject ambiguity; missing selections return `false` from `exists()` and throw on prop inspection. Errors name the ID and query boundary. Plural selections validate their type when inspected.

Prefer named application components and domain props. Use scoped, behavior-named technical IDs where those interfaces are insufficient, declare forwarded IDs in custom component props, and keep role/label/text queries for accessible UI tests.

## Invoke callbacks without bypassing their types

```ts
const view = session.subject.find(AccountPanel);
await session.invoke(view, "onSave");
await session.invoke(view, "onSelect", "archer", 3);
```

`RenderSession.invoke` resolves the live callback inside `act`, preserves required argument types, awaits asynchronous callbacks, and returns `Promise<void>` while discarding callback return values. Absent optional callbacks and non-callable runtime values reject; callback errors propagate.

No events are fabricated and required event arguments cannot be omitted. Prefer domain callbacks for controller contracts and real mounted host interactions for event behavior. `session.act` remains available for store dispatch, arbitrary updates, and real DOM interactions.

