import * as React from 'react';
import { afterEach, expect, test } from 'vitest';
import { cleanup, getComponentRenderer } from 'react-contract-renderer';

afterEach(cleanup);

test('runs the target without a DOM and keeps custom children opaque', async () => {
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

  session.unmount();
  expect(stopped).toBe(true);
  expect(page.exists()).toBe(false);
});

test('inspects host descendants and flattens fragments around them', () => {
  const Opaque = (_props: { label: string }) => {
    throw new Error('opaque child executed');
  };
  function App() {
    return (
      <>
        <section>
          before
          <span>inside</span>
          <Opaque label="contract" />
          after
        </section>
      </>
    );
  }
  const { subject } = getComponentRenderer(App, {}).shallow();

  expect(subject.find('section').text()).toBe('beforeinsideafter');
  expect(subject.find('span').text()).toBe('inside');
  expect(subject.find(Opaque).prop('label')).toBe('contract');
});

test('supports function, class, and intrinsic roots', () => {
  const Child = (_props: { value: string }) => null;
  function FunctionRoot({ value }: { value: string }) {
    return <Child value={`function:${value}`} />;
  }
  class ClassRoot extends React.Component<
    { value: string },
    { mounted: boolean }
  > {
    override state = { mounted: false };

    override componentDidMount() {
      this.setState({ mounted: true });
    }

    override render() {
      return <Child value={`${this.props.value}:${this.state.mounted}`} />;
    }
  }

  const functionSubject = getComponentRenderer(FunctionRoot, {
    value: 'value',
  }).shallow().subject;
  const classSubject = getComponentRenderer(ClassRoot, {
    value: 'class',
  }).shallow().subject;
  const intrinsicSubject = getComponentRenderer('button', {
    type: 'button',
    children: 'Save',
  }).shallow().subject;

  expect(functionSubject.find(Child).prop('value')).toBe('function:value');
  expect(classSubject.find(Child).prop('value')).toBe('class:true');
  expect(intrinsicSubject.type()).toBe('button');
  expect(intrinsicSubject.text()).toBe('Save');
});

test('supports memo and forwardRef roots', () => {
  const Child = (_props: { name: string }) => null;
  const Parent = React.memo(
    React.forwardRef<unknown, { name: string }>(({ name }, _ref) => {
      const value = React.useMemo(() => name.toUpperCase(), [name]);
      return <Child name={value} />;
    }),
  );
  const session = getComponentRenderer(Parent, { name: 'first' }).shallow();
  const child = session.subject.find(Child);

  expect(child.prop('name')).toBe('FIRST');
  session.rerender({ name: 'second' });
  expect(child.prop('name')).toBe('SECOND');
});

test('resolves a lazy root through a Suspense provider', async () => {
  const Child = (_props: { value: string }) => null;
  function Loaded({ value }: { value: string }) {
    return <Child value={value} />;
  }
  const loaded = Promise.resolve({ default: Loaded });
  const LazyRoot = React.lazy(() => loaded);
  function SuspenseProvider({ children }: { children?: React.ReactNode }) {
    return <React.Suspense fallback={null}>{children}</React.Suspense>;
  }
  const session = getComponentRenderer(LazyRoot, { value: 'ready' })
    .shallow()
    .with(SuspenseProvider);
  const child = session.subject.find(Child);

  expect(child.exists()).toBe(false);
  await session.act(async () => {
    await loaded;
  });
  expect(child.prop('value')).toBe('ready');
});

test('preserves state, reducer, memo, and context output', async () => {
  const Context = React.createContext('missing');
  const Child = (_props: {
    label: string;
    rename: (value: string) => void;
    increment: () => void;
  }) => null;
  function Provider({ children }: { children?: React.ReactNode }) {
    return <Context.Provider value="context">{children}</Context.Provider>;
  }
  function App({ initial }: { initial: string }) {
    const prefix = React.useContext(Context);
    const [name, setName] = React.useState(initial);
    const [count, increment] = React.useReducer(
      (value: number) => value + 1,
      0,
    );
    const label = React.useMemo(
      () => `${prefix}:${name}:${count}`,
      [count, name, prefix],
    );
    return <Child label={label} rename={setName} increment={increment} />;
  }
  const session = getComponentRenderer(App, { initial: 'first' })
    .shallow()
    .with(Provider);
  const child = session.subject.find(Child);

  await session.act(() => {
    child.prop('rename')('second');
    child.prop('increment')();
  });

  expect(child.prop('label')).toBe('context:second:1');
});

test('preserves effect cleanup ordering across changed dependencies', () => {
  const lifecycle: string[] = [];
  function Parent({ name }: { name: string }) {
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
    return null;
  }
  const session = getComponentRenderer(Parent, { name: 'first' }).shallow();

  void session.subject;
  session.rerender({ name: 'second' });
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

test('tracks keyed host reordering and conditional removal', () => {
  function App({ ids, visible }: { ids: readonly number[]; visible: boolean }) {
    return visible ? (
      <section>
        {ids.map((id) => (
          <span key={id}>{id}</span>
        ))}
      </section>
    ) : null;
  }
  const session = getComponentRenderer(App, {
    ids: [1, 2, 3],
    visible: true,
  }).shallow();

  expect(session.subject.findAll('span').map((span) => span.text())).toEqual([
    '1',
    '2',
    '3',
  ]);
  session.rerender({ ids: [3, 1] });
  expect(session.subject.findAll('span').map((span) => span.text())).toEqual([
    '3',
    '1',
  ]);
  session.rerender({ visible: false });
  expect(session.subject.find('section').exists()).toBe(false);
});

test('propagates initial render, rerender, and effect failures', () => {
  const initialFailure = new RangeError('initial failure');
  function InitiallyBroken(): never {
    throw initialFailure;
  }
  expect(
    () => getComponentRenderer(InitiallyBroken, {}).shallow().subject,
  ).toThrow(initialFailure);

  const rerenderFailure = new TypeError('rerender failure');
  function BreakOnUpdate({ broken }: { broken: boolean }) {
    if (broken) throw rerenderFailure;
    return null;
  }
  const session = getComponentRenderer(BreakOnUpdate, {
    broken: false,
  }).shallow();
  void session.subject;
  expect(() => session.rerender({ broken: true })).toThrow(rerenderFailure);

  const effectFailure = new Error('effect failure');
  function BrokenEffect() {
    React.useEffect(() => {
      throw effectFailure;
    }, []);
    return null;
  }
  expect(
    () => getComponentRenderer(BrokenEffect, {}).shallow().subject,
  ).toThrow(effectFailure);
});
