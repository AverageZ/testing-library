// @vitest-environment jsdom
import * as React from 'react';
import { afterEach, expect, test } from 'vitest';
import { cleanup, getComponentRenderer } from '@avgz/react-contract-renderer';

afterEach(cleanup);

test('attaches lazily to document.body and removes its container on unmount', () => {
  function App() {
    return <main>mounted</main>;
  }
  const before = document.body.childElementCount;
  const session = getComponentRenderer(App, {}).mount();

  expect(document.body.childElementCount).toBe(before);
  const main = session.subject.find('main').getDOMNode();
  expect(document.body.contains(main)).toBe(true);
  expect(document.body.childElementCount).toBe(before + 1);

  session.unmount();
  expect(document.body.contains(main)).toBe(false);
  expect(document.body.childElementCount).toBe(before);
});

test('returns the same committed DOM element through refs and composite subjects', () => {
  const ref = React.createRef<HTMLElement>();
  const Panel = React.forwardRef<HTMLElement, { label: string }>(
    ({ label }, forwardedRef) => <section ref={forwardedRef}>{label}</section>,
  );
  function App() {
    return <Panel ref={ref} label="content" />;
  }
  const { subject } = getComponentRenderer(App, {}).mount();
  const panelDOM = subject.find(Panel).getDOMNode();

  expect(panelDOM).toBe(ref.current);
  expect(subject.find('section').getDOMNode()).toBe(ref.current);
  expect(panelDOM.textContent).toBe('content');
});

test('commits native event state updates inside act', async () => {
  const events: number[] = [];
  function App() {
    const [count, setCount] = React.useState(0);
    return (
      <button
        className={`count-${count}`}
        onClick={() => {
          const next = count + 1;
          events.push(next);
          setCount(next);
        }}
      >
        {count}
      </button>
    );
  }
  const session = getComponentRenderer(App, {}).mount();
  const button = session.subject.find('button');

  await session.act(() => {
    button
      .getDOMNode()
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

  expect(events).toEqual([1]);
  expect(button.text()).toBe('1');
  expect(button.className()).toBe('count-1');
});

test('queries function, class, memo, forwardRef, and host nodes', () => {
  const Leaf = React.forwardRef<HTMLButtonElement, { value: string }>(
    ({ value }, ref) => <button ref={ref}>{value}</button>,
  );
  const MemoLeaf = React.memo(Leaf);
  class ClassBranch extends React.Component<{ value: string }> {
    override render() {
      return <MemoLeaf value={this.props.value} />;
    }
  }
  function FunctionBranch({ value }: { value: string }) {
    return <ClassBranch value={value} />;
  }
  function App() {
    return <FunctionBranch value="tree" />;
  }
  const { subject } = getComponentRenderer(App, {}).mount();

  expect(subject.find(FunctionBranch).prop('value')).toBe('tree');
  expect(subject.find(ClassBranch).prop('value')).toBe('tree');
  expect(subject.find(MemoLeaf).prop('value')).toBe('tree');
  expect(subject.find(Leaf).prop('value')).toBe('tree');
  expect(subject.find('button').text()).toBe('tree');
});

test('tracks committed props and DOM through conditional rerenders', () => {
  const Label = React.memo(
    React.forwardRef<HTMLSpanElement, { value: string }>(({ value }, ref) => (
      <span ref={ref} className={`label-${value}`}>
        {value}
      </span>
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
  const span = session.subject.find('span');

  session.rerender({ value: 'new' });
  expect(label.prop('value')).toBe('new');
  expect(span.text()).toBe('new');
  expect(span.className()).toBe('label-new');
  expect(span.getDOMNode().textContent).toBe('new');

  session.rerender({ visible: false });
  expect(label.exists()).toBe(false);
  expect(span.exists()).toBe(false);
  expect(session.subject.find('p').text()).toBe('absent');
});

test('rejects DOM lookup for a mounted component with no host output', () => {
  function Empty() {
    return null;
  }
  const { subject } = getComponentRenderer(Empty, {}).mount();

  expect(() => subject.getDOMNode()).toThrow(
    'The selected node has no associated host DOM element',
  );
});

test('propagates render, rerender, and effect failures without leaking containers', () => {
  const before = document.body.childElementCount;
  const renderFailure = new RangeError('mount render failure');
  function InitiallyBroken(): never {
    throw renderFailure;
  }
  expect(
    () => getComponentRenderer(InitiallyBroken, {}).mount().subject,
  ).toThrow(renderFailure);
  expect(document.body.childElementCount).toBe(before);

  const rerenderFailure = new TypeError('mount rerender failure');
  function BreakOnUpdate({ broken }: { broken: boolean }) {
    if (broken) throw rerenderFailure;
    return <div />;
  }
  const session = getComponentRenderer(BreakOnUpdate, {
    broken: false,
  }).mount();
  void session.subject;
  expect(() => session.rerender({ broken: true })).toThrow(rerenderFailure);

  const effectFailure = new Error('mount effect failure');
  function BrokenEffect() {
    React.useEffect(() => {
      throw effectFailure;
    }, []);
    return null;
  }
  expect(() => getComponentRenderer(BrokenEffect, {}).mount().subject).toThrow(
    effectFailure,
  );
});
