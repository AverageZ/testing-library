// @vitest-environment jsdom
import * as React from 'react';
import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, getComponentRenderer } from '@avgz/react-contract-renderer';

const modes = ['shallow', 'mount'] as const;

afterEach(cleanup);

for (const mode of modes) {
  describe(`${mode} prop-tree queries`, () => {
    test('flatten arrays and fragments while traversing host children in order', () => {
      function App(_props: { content?: React.ReactNode }) {
        return null;
      }
      const content = [
        null,
        false,
        undefined,
        'outside',
        [
          <React.Fragment key="fragment">
            <section data-testid="section">
              before
              <>
                {2}
                <span data-testid="item">first</span>
                {false}
              </>
              after
            </section>
          </React.Fragment>,
          <span key="second" data-testid="item">
            second
          </span>,
        ],
      ];
      const { subject } = getComponentRenderer(App, { content })[mode]();
      const tree = subject.tree('content');

      expect(subject.find('span').exists()).toBe(false);
      expect(tree.findAll('span').map((node) => node.text())).toEqual([
        'first',
        'second',
      ]);
      expect(tree.findAllByTestId('item').map((node) => node.text())).toEqual([
        'first',
        'second',
      ]);
      const section = tree.findByTestId('section', 'section');
      expect(section.text()).toBe('before2firstafter');
      expect(section.findByTestId('section').type()).toBe('section');
      expect(section.findByTestId('item', 'span').text()).toBe('first');
      expect(tree.find(React.Fragment).exists()).toBe(false);
    });

    test('keep custom props opaque until each boundary is explicitly crossed', () => {
      let calls = 0;
      function Child(_props: {
        children?: React.ReactNode;
        footer?: React.ReactNode;
      }): React.ReactElement | null {
        calls += 1;
        throw new Error('A query must not render this child');
      }
      function App(_props: { content: React.ReactNode }) {
        return null;
      }
      const { subject } = getComponentRenderer(App, {
        content: (
          <section>
            <Child
              data-testid="child"
              footer={<i data-testid="footer">footer</i>}
            >
              <button data-testid="nested">nested</button>
            </Child>
          </section>
        ),
      })[mode]();
      const tree = subject.tree('content');
      const child = tree.findByTestId('child', Child);

      expect(tree.findByTestId('nested').exists()).toBe(false);
      expect(tree.findByTestId('footer').exists()).toBe(false);
      expect(tree.find('button').exists()).toBe(false);
      expect(child.findByTestId('nested').exists()).toBe(false);
      expect(child.text()).toBe('');
      expect(child.tree('children').findByTestId('nested').text()).toBe(
        'nested',
      );
      expect(child.tree('footer').find('i').text()).toBe('footer');
      expect(child.element().type).toBe(Child);
      expect(calls).toBe(0);
    });

    test('inspect function, class, memo, forwardRef, and lazy elements without executing them', () => {
      const executions: string[] = [];
      function FunctionChild(): React.ReactElement | null {
        executions.push('function');
        throw new Error('Unexpected function render');
      }
      class ClassChild extends React.Component {
        constructor(props: object) {
          super(props);
          executions.push('constructor');
        }
        override render(): React.ReactNode {
          executions.push('class');
          return null;
        }
      }
      const MemoChild = React.memo(FunctionChild);
      const ForwardChild = React.forwardRef(() => {
        executions.push('forwardRef');
        return null;
      });
      const LazyChild = React.lazy(async () => {
        executions.push('lazy');
        return { default: FunctionChild };
      });
      function App(_props: { content: React.ReactNode }) {
        return null;
      }
      const tree = getComponentRenderer(App, {
        content: (
          <>
            <FunctionChild data-testid="function" />
            <ClassChild data-testid="class" />
            <MemoChild data-testid="memo" />
            <ForwardChild data-testid="forward" />
            <LazyChild data-testid="lazy" />
          </>
        ),
      })
        [mode]()
        .subject.tree('content');

      expect(tree.findByTestId('function', FunctionChild).type()).toBe(
        FunctionChild,
      );
      expect(tree.find(ClassChild).type()).toBe(ClassChild);
      expect(tree.findByTestId('memo', MemoChild).type()).toBe(MemoChild);
      expect(tree.findByTestId('forward', ForwardChild).type()).toBe(
        ForwardChild,
      );
      expect(tree.findByTestId('lazy', LazyChild).type()).toBe(LazyChild);
      expect(executions).toEqual([]);
    });

    test('report empty and ambiguous selections with their ID and explicit prop boundary', () => {
      function App(_props: { content?: React.ReactNode }) {
        return null;
      }
      const session = getComponentRenderer(App, {})[mode]();
      const tree = session.subject.tree('content');
      const missing = tree.findByTestId('missing');

      expect(missing.exists()).toBe(false);
      expect(tree.findAllByTestId('missing')).toEqual([]);
      expect(() => missing.props()).toThrow(
        /empty.*tree\("content"\).*"missing"/,
      );
      for (const content of [
        null,
        false,
        true,
        '',
        0,
        undefined,
        [null, false],
        <></>,
      ]) {
        session.rerender({ content });
        expect(tree.find('div').exists()).toBe(false);
        expect(tree.findAllByTestId('missing')).toEqual([]);
      }
      session.rerender({
        content: (
          <>
            <div data-testid="duplicate" />
            <span data-testid="duplicate" />
          </>
        ),
      });
      const duplicate = tree.findByTestId('duplicate', 'div');
      expect(() => duplicate.exists()).toThrow(
        /ambiguous.*2.*tree\("content"\).*"duplicate"/,
      );
      expect(() => tree.find('section').props()).toThrow(
        /empty.*tree\("content"\)/,
      );
      expect(
        tree.findAllByTestId('duplicate').map((node) => node.type()),
      ).toEqual(['div', 'span']);
    });

    test('keep nested selections and query lists live across rerender, act, and unmount', async () => {
      function Carrier(_props: {
        content: React.ReactNode;
        increment: () => void;
      }) {
        return null;
      }
      function Item(_props: { value: string }) {
        return null;
      }
      function App({ values }: { values: readonly string[] }) {
        const [count, setCount] = React.useState(0);
        return (
          <Carrier
            data-testid="carrier"
            increment={() => setCount((value) => value + 1)}
            content={
              <>
                <output data-testid="count">{count}</output>
                {values.map((value) => (
                  <Item key={value} data-testid="item" value={value} />
                ))}
              </>
            }
          />
        );
      }
      const session = getComponentRenderer(App, {
        values: ['first', 'second'],
      })[mode]();
      const carrier = session.subject.findByTestId('carrier', Carrier);
      const tree = carrier.tree('content');
      const count = tree.findByTestId('count', 'output');
      const items = tree.findAllByTestId('item', Item);
      const byType = tree.findAll(Item);

      expect(count.text()).toBe('0');
      expect(items.map((item) => item.prop('value'))).toEqual([
        'first',
        'second',
      ]);
      session.rerender({ values: ['second'] });
      expect(items[0]?.prop('value')).toBe('second');
      expect(byType[0]?.prop('value')).toBe('second');
      expect(items[1]?.exists()).toBe(false);
      expect(byType[1]?.exists()).toBe(false);
      await session.act(() => carrier.prop('increment')());
      expect(count.text()).toBe('1');
      session.unmount();
      expect(count.exists()).toBe(false);
      expect(tree.findAllByTestId('item')).toEqual([]);
    });

    test('resolve initially missing nodes and validate changing types against current props', () => {
      function App(_props: { content?: React.ReactNode }) {
        return null;
      }
      const session = getComponentRenderer(App, {})[mode]();
      const tree = session.subject.tree('content');
      const value = tree.findByTestId('value', 'button');
      expect(value.exists()).toBe(false);
      session.rerender({ content: <button data-testid="value">ready</button> });
      expect(value.text()).toBe('ready');
      session.rerender({ content: <span data-testid="value">changed</span> });
      expect(() => value.props()).toThrow(
        /type mismatch.*"button".*"span".*tree\("content"\).*"value"/,
      );
      expect(() =>
        tree.findAllByTestId('value', 'button')[0]?.exists(),
      ).toThrow(/type mismatch/);
    });

    test('never associate prop-tree selections with mounted DOM', () => {
      function App({ children }: { children: React.ReactNode }) {
        return <section>{children}</section>;
      }
      const { subject } = getComponentRenderer(App, {
        children: <button data-testid="action">action</button>,
      })[mode]();
      const selected = subject
        .tree('children')
        .findByTestId('action', 'button');

      expect(selected.prop('children')).toBe('action');
      expect(() => selected.getDOMNode()).toThrow(
        /prop-tree.*no associated host DOM/,
      );
      if (mode === 'mount') {
        expect(subject.findByTestId('action').getDOMNode().tagName).toBe(
          'BUTTON',
        );
      }
    });
  });

  describe(`${mode} subject test-ID queries`, () => {
    test('match exact values including the current root, never CSS selectors', () => {
      const literal = '#save[data-kind="primary"] .button';
      function App(_props: { 'data-testid': string }) {
        return (
          <div data-testid={literal}>
            <span data-testid="save">save</span>
            <span data-testid={123} />
          </div>
        );
      }
      const { subject } = getComponentRenderer(App, { 'data-testid': 'root' })[
        mode
      ]();

      expect(subject.findByTestId('root', App).type()).toBe(App);
      expect(subject.findByTestId(literal, 'div').type()).toBe('div');
      expect(subject.findByTestId('#save').exists()).toBe(false);
      expect(subject.findByTestId('SAVE').exists()).toBe(false);
      expect(subject.findByTestId('123').exists()).toBe(false);
      expect(subject.findByTestId('save', 'span').text()).toBe('save');
      expect(subject.findByTestId(literal).findByTestId(literal).type()).toBe(
        'div',
      );
      expect(subject.findAllByTestId('root', App)[0]?.prop('data-testid')).toBe(
        'root',
      );
    });

    test('validate types without filtering mismatches or duplicate IDs', () => {
      function Child(_props: { count: number }) {
        return null;
      }
      function App() {
        return (
          <>
            <Child data-testid="same" count={3} />
            <span data-testid="same" />
            <div data-testid="only" />
          </>
        );
      }
      const { subject } = getComponentRenderer(App, {})[mode]();
      const duplicate = subject.findByTestId('same', Child);
      expect(() => duplicate.exists()).toThrow(/ambiguous.*2.*Subject.*"same"/);
      expect(() => subject.findByTestId('only', Child).props()).toThrow(
        /type mismatch.*Child.*"div".*"only"/,
      );
      const matches = subject.findAllByTestId('same', Child);
      expect(matches[0]?.prop('count')).toBe(3);
      expect(() => matches[1]?.props()).toThrow(
        /type mismatch.*Child.*"span".*"same"/,
      );
      const missing = subject.findByTestId('absent');
      expect(missing.exists()).toBe(false);
      expect(() => missing.props()).toThrow(/empty.*Subject.*"absent"/);
      expect(() => subject.findByTestId('only', '.selector' as 'div')).toThrow(
        /not a CSS selector/,
      );
    });

    test('keep singular and plural subject test-ID selections live', () => {
      function App({ values }: { values: readonly string[] }) {
        return (
          <>
            {values.map((value) => (
              <span key={value} data-testid="item">
                {value}
              </span>
            ))}
          </>
        );
      }
      const session = getComponentRenderer(App, {
        values: ['first', 'second'],
      })[mode]();
      const singular = session.subject.findByTestId('item', 'span');
      const items = session.subject.findAllByTestId('item', 'span');
      expect(() => singular.text()).toThrow(/ambiguous/);
      session.rerender({ values: ['second'] });
      expect(singular.text()).toBe('second');
      expect(items[0]?.text()).toBe('second');
      expect(items[1]?.exists()).toBe(false);
      session.rerender({ values: [] });
      expect(singular.exists()).toBe(false);
    });
  });
}

test('leave shallow custom children opaque outside an explicit tree boundary', () => {
  function Child({ children }: { children: React.ReactNode }) {
    return <section>{children}</section>;
  }
  function App() {
    return (
      <Child>
        <button data-testid="nested">nested</button>
      </Child>
    );
  }
  const { subject } = getComponentRenderer(App, {}).shallow();

  expect(subject.find('button').exists()).toBe(false);
  expect(subject.findByTestId('nested').exists()).toBe(false);
  expect(
    subject.find(Child).tree('children').findByTestId('nested').text(),
  ).toBe('nested');
});
