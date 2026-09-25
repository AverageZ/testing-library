import * as React from 'react';
import { afterEach, expect, test } from 'vitest';
import { cleanup, getComponentRenderer } from 'react-contract-renderer';

afterEach(cleanup);

test('runs parent effects without a DOM or evaluating opaque child contracts', async () => {
  expect(typeof document).toBe('undefined');
  const pending = Promise.withResolvers<string>();
  let childCalls = 0;
  let stopped = false;
  function Page(_props: { name: string; children?: React.ReactNode }): never {
    childCalls++;
    throw new Error('A shallow child must not execute');
  }
  function App({ route }: { route: string }) {
    const [name, setName] = React.useState('loading');
    React.useEffect(() => {
      let active = true;
      void pending.promise.then((value) => {
        if (active) setName(`${route}:${value}`);
      });
      return () => {
        active = false;
        stopped = true;
      };
    }, [route]);
    return (
      <Page name={name}>
        <Page name="passed, not rendered" />
      </Page>
    );
  }
  const session = getComponentRenderer(App, { route: '/home' }).shallow();
  const page = session.subject.find(Page);
  expect(page.prop('name')).toBe('loading');
  expect(session.subject.findAll(Page)).toHaveLength(1);
  await session.act(async () => {
    pending.resolve('Ada');
    await pending.promise;
  });
  expect(page.prop('name')).toBe('/home:Ada');
  expect(childCalls).toBe(0);
  expect(() => page.getDOMNode()).toThrow();
  session.unmount();
  expect(stopped).toBe(true);
  expect(page.exists()).toBe(false);
});

test('distinguishes missing, singular, and ambiguous contracts across live updates', () => {
  const Item = (_props: { id: number }) => null;
  function List({ count }: { count: number }) {
    return (
      <section className="items">
        {Array.from({ length: count }, (_, id) => (
          <Item key={id} id={id} />
        ))}
      </section>
    );
  }
  const session = getComponentRenderer(List, { count: 2 }).shallow();
  const items = session.subject.findAll(Item);
  expect(items.map((item) => item.prop('id'))).toEqual([0, 1]);
  expect(() => session.subject.find(Item).props()).toThrow();
  expect(session.subject.find('section').className()).toBe('items');
  expect(session.subject.find('section').type()).toBe('section');
  expect(items[0]?.element().type).toBe(Item);
  session.rerender({ count: 1 });
  expect(session.subject.find(Item).prop('id')).toBe(0);
  expect(items[1]?.exists()).toBe(false);
  expect(session.subject.find('button').exists()).toBe(false);
  expect(() => session.subject.find('button').props()).toThrow();
});

test('preserves state and effect cleanup ordering through changed dependencies', async () => {
  const lifecycle: string[] = [];
  const Child = (_props: { count: number; increment: () => void }) => null;
  function Parent({ name }: { name: string }) {
    const [count, increment] = React.useReducer(
      (value: number) => value + 1,
      0,
    );
    React.useLayoutEffect(() => {
      lifecycle.push(`layout:${name}`);
      return () => {
        lifecycle.push(`layout-clean:${name}`);
      };
    }, [name]);
    React.useEffect(() => {
      lifecycle.push(`effect:${name}`);
      return () => {
        lifecycle.push(`effect-clean:${name}`);
      };
    }, [name]);
    return <Child count={count} increment={increment} />;
  }
  const session = getComponentRenderer(Parent, { name: 'first' }).shallow();
  const child = session.subject.find(Child);
  await session.act(() => {
    child.prop('increment')();
  });
  session.rerender({ name: 'second' });
  expect(child.prop('count')).toBe(1);
  session.unmount();
  expect(lifecycle).toEqual([
    'layout:first',
    'effect:first',
    'layout-clean:first',
    'layout:second',
    'effect-clean:first',
    'effect:second',
    'layout-clean:second',
    'effect-clean:second',
  ]);
});

test('renders class state lifecycles while leaving returned children opaque', () => {
  const Child = (_props: { ready: boolean }) => {
    throw new Error('opaque');
  };
  let released = false;
  class Parent extends React.Component<{ name: string }, { ready: boolean }> {
    override state = { ready: false };
    override componentDidMount() {
      this.setState({ ready: true });
    }
    override componentWillUnmount() {
      released = true;
    }
    override render() {
      return <Child ready={this.state.ready} />;
    }
  }
  const session = getComponentRenderer(Parent, { name: 'class' }).shallow();
  expect(session.subject.type()).toBe(Parent);
  expect(session.subject.find(Child).prop('ready')).toBe(true);
  session.unmount();
  expect(released).toBe(true);
});

test('supports memo and forwardRef roots without swallowing render errors', () => {
  const Child = (_props: { name: string }) => null;
  const Parent = React.memo(
    React.forwardRef<unknown, { name: string }>(({ name }, _ref) => {
      const value = React.useMemo(() => name.toUpperCase(), [name]);
      return <Child name={value} />;
    }),
  );
  const session = getComponentRenderer(Parent, { name: 'first' }).shallow();
  expect(session.subject.find(Child).prop('name')).toBe('FIRST');
  session.rerender({ name: 'second' });
  expect(session.subject.find(Child).prop('name')).toBe('SECOND');
  const error = new RangeError('failure from user component');
  function Broken(): never {
    throw error;
  }
  expect(() => getComponentRenderer(Broken, {}).shallow().subject).toThrow(
    error,
  );
});
