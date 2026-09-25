// @vitest-environment jsdom
import * as fc from 'fast-check';
import * as React from 'react';
import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, getComponentRenderer } from 'react-contract-renderer';

const modes = ['shallow', 'mount'] as const;

afterEach(cleanup);

for (const mode of modes) {
  describe(`${mode} render sessions`, () => {
    test('snapshot defaults and keep sessions independent', () => {
      function App(_props: { label: string; count: number }) {
        return null;
      }
      const defaults = { label: 'default', count: 1 };
      const renderer = getComponentRenderer(App, defaults);
      defaults.label = 'mutated after renderer creation';

      const first = renderer[mode]({ label: 'first' });
      const second = renderer[mode]();

      expect(first.subject.props()).toEqual({ label: 'first', count: 1 });
      expect(second.subject.props()).toEqual({ label: 'default', count: 1 });

      first.rerender({ count: 2 });
      expect(first.subject.props()).toEqual({ label: 'first', count: 2 });
      expect(second.subject.props()).toEqual({ label: 'default', count: 1 });
    });

    test('merge rerender overrides while preserving component state', async () => {
      const Child = (_props: {
        left: string;
        right: string;
        count: number;
        increment: () => void;
      }) => null;
      function App({ left, right }: { left: string; right: string }) {
        const [count, increment] = React.useReducer(
          (value: number) => value + 1,
          0,
        );
        return (
          <Child
            left={left}
            right={right}
            count={count}
            increment={increment}
          />
        );
      }
      const session = getComponentRenderer(App, {
        left: 'initial-left',
        right: 'initial-right',
      })[mode]();
      const child = session.subject.find(Child);

      await session.act(() => child.prop('increment')());
      session.rerender({ left: 'updated-left' });

      expect(child.props()).toMatchObject({
        left: 'updated-left',
        right: 'initial-right',
        count: 1,
      });
    });

    test('initialize lazily and compose the first provider outermost', () => {
      const Context = React.createContext('root');
      const Child = (_props: { value: string }) => null;
      let renders = 0;
      function Outer({ children }: { children?: React.ReactNode }) {
        const value = React.useContext(Context);
        return (
          <Context.Provider value={`${value}:outer`}>
            {children}
          </Context.Provider>
        );
      }
      function Inner({ children }: { children?: React.ReactNode }) {
        const value = React.useContext(Context);
        return (
          <Context.Provider value={`${value}:inner`}>
            {children}
          </Context.Provider>
        );
      }
      function App() {
        renders++;
        return <Child value={React.useContext(Context)} />;
      }

      const session = getComponentRenderer(App, {})[mode]().with(Outer, Inner);
      expect(renders).toBe(0);
      expect(session.subject.find(Child).prop('value')).toBe(
        'root:outer:inner',
      );
      expect(renders).toBe(1);
    });

    test('reject provider configuration after initialization', () => {
      function Provider({ children }: { children?: React.ReactNode }) {
        return <>{children}</>;
      }
      function App() {
        return null;
      }
      const session = getComponentRenderer(App, {})[mode]();
      void session.subject;

      expect(() => session.with(Provider)).toThrow(
        'Call .with(...) before observing or updating the subject',
      );
    });

    test('unmount idempotently and invalidate live selections', async () => {
      const Child = () => null;
      function App() {
        return <Child />;
      }
      const session = getComponentRenderer(App, {})[mode]();
      const child = session.subject.find(Child);

      session.unmount();
      session.unmount();

      expect(child.exists()).toBe(false);
      expect(() => session.subject).toThrow(
        'Cannot use an unmounted render session',
      );
      expect(() => session.rerender({})).toThrow(
        'Cannot use an unmounted render session',
      );
      expect(() => session.flush()).toThrow(
        'Cannot use an unmounted render session',
      );
      await expect(session.act(() => undefined)).rejects.toThrow(
        'Cannot use an unmounted render session',
      );
      expect(() => session.with()).toThrow(
        'Cannot configure an unmounted subject',
      );
    });

    test('leave no registered session or DOM container after initialization fails', () => {
      const before = document.body.childElementCount;
      const failure = new Error('initial render failed');
      function Broken(): never {
        throw failure;
      }

      expect(() => getComponentRenderer(Broken, {})[mode]().subject).toThrow(
        failure,
      );
      expect(() => cleanup()).not.toThrow();
      expect(document.body.childElementCount).toBe(before);
    });

    describe('property-based tests', () => {
      const props = fc.record({
        alpha: fc.string({ maxLength: 20 }),
        count: fc.integer({ min: -100, max: 100 }),
        enabled: fc.boolean(),
      });
      const patch = fc.oneof(
        fc.string({ maxLength: 20 }).map((alpha) => ({ alpha }) as const),
        fc
          .integer({ min: -100, max: 100 })
          .map((count) => ({ count }) as const),
        fc.boolean().map((enabled) => ({ enabled }) as const),
      );

      test('arbitrary rerender sequences match last-write-wins props', () => {
        fc.assert(
          fc.property(
            props,
            fc.array(patch, { maxLength: 8 }),
            (defaults, updates) => {
              function App(_props: typeof defaults) {
                return null;
              }
              const renderer = getComponentRenderer(App, defaults);
              const session = renderer[mode]();
              const expected = { ...defaults };

              try {
                for (const update of updates) {
                  Object.assign(expected, update);
                  session.rerender(update);
                  expect(session.subject.props()).toEqual(expected);
                }

                const independent = renderer[mode]();
                try {
                  expect(independent.subject.props()).toEqual(defaults);
                } finally {
                  independent.unmount();
                }
              } finally {
                session.unmount();
              }
            },
          ),
          { numRuns: 50 },
        );
      });
    });
  });
}
