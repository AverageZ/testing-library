// @vitest-environment jsdom
import * as React from 'react';
import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, getComponentRenderer } from '@avgz/react-contract-renderer';

const modes = ['shallow', 'mount'] as const;
const actEnvironment = 'IS_REACT_ACT_ENVIRONMENT';

afterEach(cleanup);

for (const mode of modes) {
  describe(`${mode} act boundaries`, () => {
    test('flush initial and rerender effects before returning', () => {
      const events: string[] = [];
      function App({ value }: { value: string }) {
        React.useLayoutEffect(() => {
          events.push(`layout:${value}`);
          return () => {
            events.push(`layout-clean:${value}`);
          };
        }, [value]);
        React.useEffect(() => {
          events.push(`effect:${value}`);
          return () => {
            events.push(`effect-clean:${value}`);
          };
        }, [value]);
        return null;
      }
      const session = getComponentRenderer(App, { value: 'first' })[mode]();

      void session.subject;
      expect(events).toEqual(['layout:first', 'effect:first']);

      session.rerender({ value: 'second' });
      expect(events).toEqual([
        'layout:first',
        'effect:first',
        'layout-clean:first',
        'layout:second',
        'effect-clean:first',
        'effect:second',
      ]);
    });

    test('commit synchronous and asynchronous callback updates', async () => {
      const Child = (_props: { count: number; increment: () => void }) => null;
      function App() {
        const [count, increment] = React.useReducer(
          (value: number) => value + 1,
          0,
        );
        return <Child count={count} increment={increment} />;
      }
      const session = getComponentRenderer(App, {})[mode]();
      const child = session.subject.find(Child);

      await session.act(() => child.prop('increment')());
      expect(child.prop('count')).toBe(1);

      await session.act(async () => {
        await Promise.resolve();
        child.prop('increment')();
      });
      expect(child.prop('count')).toBe(2);
    });

    test('propagate callback failures and remain usable', async () => {
      const Child = (_props: { count: number; increment: () => void }) => null;
      function App() {
        const [count, increment] = React.useReducer(
          (value: number) => value + 1,
          0,
        );
        return <Child count={count} increment={increment} />;
      }
      const session = getComponentRenderer(App, {})[mode]();
      const child = session.subject.find(Child);
      const synchronous = new RangeError('synchronous act failure');
      const asynchronous = new TypeError('asynchronous act failure');

      await expect(
        session.act(() => {
          throw synchronous;
        }),
      ).rejects.toBe(synchronous);
      await expect(
        session.act(async () => {
          await Promise.resolve();
          throw asynchronous;
        }),
      ).rejects.toBe(asynchronous);

      await session.act(() => child.prop('increment')());
      expect(child.prop('count')).toBe(1);
    });

    test('restore the complete act-environment descriptor after work and errors', async () => {
      const original = Object.getOwnPropertyDescriptor(
        globalThis,
        actEnvironment,
      );
      const previous = {
        configurable: true,
        enumerable: false,
        value: false,
        writable: false,
      } satisfies PropertyDescriptor;
      Object.defineProperty(globalThis, actEnvironment, previous);

      try {
        function App() {
          return null;
        }
        const session = getComponentRenderer(App, {})[mode]();
        void session.subject;
        expect(
          Object.getOwnPropertyDescriptor(globalThis, actEnvironment),
        ).toEqual(previous);

        await expect(
          session.act(async () => {
            await Promise.resolve();
            throw new Error('act rejected');
          }),
        ).rejects.toThrow('act rejected');
        expect(
          Object.getOwnPropertyDescriptor(globalThis, actEnvironment),
        ).toEqual(previous);
      } finally {
        if (original === undefined) {
          Reflect.deleteProperty(globalThis, actEnvironment);
        } else {
          Object.defineProperty(globalThis, actEnvironment, original);
        }
      }
    });

    test('flush already scheduled state work', () => {
      const Child = (_props: { count: number }) => null;
      let schedule: (() => void) | undefined;
      function App() {
        const [count, setCount] = React.useState(0);
        schedule = () => setCount((value) => value + 1);
        return <Child count={count} />;
      }
      const session = getComponentRenderer(App, {})[mode]();
      const child = session.subject.find(Child);

      schedule?.();
      session.flush();

      expect(child.prop('count')).toBe(1);
    });
  });
}

test('mount flushes a native event dispatched inside act', async () => {
  function App() {
    const [count, setCount] = React.useState(0);
    return (
      <button onClick={() => setCount((value) => value + 1)}>{count}</button>
    );
  }
  const session = getComponentRenderer(App, {}).mount();
  const button = session.subject.find('button');

  await session.act(() => {
    button
      .getDOMNode()
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

  expect(button.text()).toBe('1');
});
