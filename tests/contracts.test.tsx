// @vitest-environment jsdom
import * as React from 'react';
import { afterEach, expect, test } from 'vitest';
import { cleanup, getComponentRenderer } from 'react-contract-renderer';

afterEach(cleanup);

for (const mode of ['shallow', 'mount'] as const) {
  test(`${mode}: provider composition, hook-derived props, callbacks and live updates`, async () => {
    const Context = React.createContext('missing');
    const events: string[] = [];
    function Outer({ children }: { children?: React.ReactNode }) {
      return <Context.Provider value="outer">{children}</Context.Provider>;
    }
    function Inner({ children }: { children?: React.ReactNode }) {
      const outer = React.useContext(Context);
      return (
        <Context.Provider value={`${outer}:inner`}>{children}</Context.Provider>
      );
    }
    function Page({
      title,
      onRename,
    }: {
      title: string;
      onRename: (value: string) => void;
    }) {
      return (
        <button className="page" onClick={() => onRename('clicked')}>
          {title}
        </button>
      );
    }
    function App({ name }: { name: string }) {
      const prefix = React.useContext(Context);
      const [value, setValue] = React.useState(name);
      React.useEffect(() => {
        events.push('start');
        return () => {
          events.push('stop');
        };
      }, []);
      return <Page title={`${prefix}:${value}`} onRename={setValue} />;
    }
    const renderer = getComponentRenderer(App, { name: 'default' });
    const session = renderer[mode]({ name: 'override' }).with(Outer, Inner);
    const { subject } = session;
    const page = subject.find(Page);
    expect(page.prop('title')).toBe('outer:inner:override');
    expect(subject.type()).toBe(App);
    expect(subject.find(Outer).exists()).toBe(false);
    expect(events).toEqual(['start']);
    await session.act(() => {
      page.prop('onRename')('changed');
    });
    expect(page.prop('title')).toBe('outer:inner:changed');
    if (mode === 'mount') {
      const button = subject.find('button');
      expect(button.text()).toBe('outer:inner:changed');
      expect(button.className()).toBe('page');
      expect(document.body.contains(button.getDOMNode())).toBe(true);
      await session.act(() => {
        button
          .getDOMNode()
          .dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(button.text()).toBe('outer:inner:clicked');
    } else {
      expect(subject.find('button').exists()).toBe(false);
    }
    session.unmount();
    session.unmount();
    expect(page.exists()).toBe(false);
    expect(events).toEqual(['start', 'stop']);
  });
}

test('mount returns current committed props for memo/forwardRef and conditional children', async () => {
  const Label = React.memo(
    React.forwardRef<HTMLSpanElement, { value: string }>(({ value }, ref) => (
      <span ref={ref}>{value}</span>
    )),
  );
  function App({ visible, value }: { visible: boolean; value: string }) {
    return <div>{visible ? <Label value={value} /> : <p>absent</p>}</div>;
  }
  const session = getComponentRenderer(App, {
    visible: true,
    value: 'old',
  }).mount();
  const label = session.subject.find(Label);
  expect(label.prop('value')).toBe('old');
  session.rerender({ value: 'new' });
  expect(label.prop('value')).toBe('new');
  expect(label.getDOMNode().textContent).toBe('new');
  session.rerender({ visible: false });
  expect(label.exists()).toBe(false);
  expect(session.subject.find('p').text()).toBe('absent');
});

test('mount propagates asynchronous effect results and cleans up subscriptions', async () => {
  const request = Promise.withResolvers<string>();
  let subscribed = 0;
  function App() {
    const [value, setValue] = React.useState('waiting');
    React.useEffect(() => {
      subscribed++;
      let active = true;
      void request.promise.then((result) => {
        if (active) setValue(result);
      });
      return () => {
        active = false;
        subscribed--;
      };
    }, []);
    return <output>{value}</output>;
  }
  const session = getComponentRenderer(App, {}).mount();
  const output = session.subject.find('output');
  expect(output.text()).toBe('waiting');
  await session.act(async () => {
    request.resolve('received');
    await request.promise;
  });
  expect(output.text()).toBe('received');
  const dom = output.getDOMNode();
  session.unmount();
  expect(document.body.contains(dom)).toBe(false);
  expect(subscribed).toBe(0);
});

test('mount propagates real render failures and removes its failed container', () => {
  const previous = document.body.childElementCount;
  const error = new TypeError('user render failed');
  function Broken(): never {
    throw error;
  }
  expect(() => getComponentRenderer(Broken, {}).mount().subject).toThrow(error);
  expect(document.body.childElementCount).toBe(previous);
});
