// @vitest-environment jsdom
import * as React from 'react';
import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, getComponentRenderer } from '@avgz/react-contract-renderer';

const modes = ['shallow', 'mount'] as const;

afterEach(cleanup);

for (const mode of modes) {
  describe(`${mode} callback invocation`, () => {
    test('commit domain arguments, state updates, and effects', async () => {
      const effects: string[] = [];
      const Child = (_props: {
        value: string;
        onSelect: (id: string, quantity: number) => void;
      }) => null;
      function App() {
        const [value, setValue] = React.useState('none');
        React.useEffect(() => {
          effects.push(value);
        }, [value]);
        return (
          <Child
            value={value}
            onSelect={(id, quantity) => setValue(`${id}:${quantity}`)}
          />
        );
      }
      const session = getComponentRenderer(App, {})[mode]();
      const child = session.subject.find(Child);

      await session.invoke(child, 'onSelect', 'archer', 3);

      expect(child.prop('value')).toBe('archer:3');
      expect(effects).toEqual(['none', 'archer:3']);
    });

    test('await asynchronous callbacks and discard their return values', async () => {
      const effects: number[] = [];
      const Child = (_props: {
        count: number;
        onLoad: (count: number) => Promise<string>;
      }) => null;
      function App() {
        const [count, setCount] = React.useState(0);
        React.useEffect(() => {
          effects.push(count);
        }, [count]);
        return (
          <Child
            count={count}
            onLoad={async (next) => {
              await Promise.resolve();
              setCount(next);
              return 'loaded';
            }}
          />
        );
      }
      const session = getComponentRenderer(App, {})[mode]();
      const child = session.subject.find(Child);

      const result = await session.invoke(child, 'onLoad', 5);

      expect(result).toBeUndefined();
      expect(child.prop('count')).toBe(5);
      expect(effects).toEqual([0, 5]);
    });

    test('resolve the current callback after rerender and state changes', async () => {
      const Child = (_props: { count: number; onIncrement: () => void }) =>
        null;
      function App({ step }: { step: number }) {
        const [count, setCount] = React.useState(0);
        return (
          <Child count={count} onIncrement={() => setCount(count + step)} />
        );
      }
      const session = getComponentRenderer(App, { step: 1 })[mode]();
      const child = session.subject.find(Child);

      await session.invoke(child, 'onIncrement');
      expect(child.prop('count')).toBe(1);
      session.rerender({ step: 4 });
      await session.invoke(child, 'onIncrement');
      expect(child.prop('count')).toBe(5);
      await session.invoke(child, 'onIncrement');
      expect(child.prop('count')).toBe(9);
    });

    test('use explicitly supplied events without fabricating replacements', async () => {
      const Child = (_props: {
        selected: string;
        onSelect: (event: MouseEvent, id: string) => void;
      }) => null;
      function App() {
        const [selected, setSelected] = React.useState('none');
        return (
          <Child
            selected={selected}
            onSelect={(event, id) => {
              event.preventDefault();
              setSelected(`${id}:${event.clientX}`);
            }}
          />
        );
      }
      const session = getComponentRenderer(App, {})[mode]();
      const child = session.subject.find(Child);
      const event = new MouseEvent('click', {
        cancelable: true,
        clientX: 42,
      });

      await session.invoke(child, 'onSelect', event, 'scout');

      expect(event.defaultPrevented).toBe(true);
      expect(child.prop('selected')).toBe('scout:42');
    });

    test('propagate callback errors and allow later invocations', async () => {
      const Child = (_props: { onRun: () => void | Promise<void> }) => null;
      function App(props: React.ComponentProps<typeof Child>) {
        return <Child {...props} />;
      }
      const synchronous = new RangeError('synchronous callback failure');
      const asynchronous = new TypeError('asynchronous callback failure');
      const session = getComponentRenderer(App, {
        onRun: () => {
          throw synchronous;
        },
      })[mode]();
      const child = session.subject.find(Child);

      await expect(session.invoke(child, 'onRun')).rejects.toBe(synchronous);
      session.rerender({
        onRun: async () => {
          await Promise.resolve();
          throw asynchronous;
        },
      });
      await expect(session.invoke(child, 'onRun')).rejects.toBe(asynchronous);

      let recovered = false;
      session.rerender({
        onRun: () => {
          recovered = true;
        },
      });
      await session.invoke(child, 'onRun');
      expect(recovered).toBe(true);
    });

    test('reject absent optional callbacks instead of silently skipping work', async () => {
      const Child = (_props: { onSave?: (id: string) => void }) => null;
      function App() {
        return <Child />;
      }
      const session = getComponentRenderer(App, {})[mode]();

      await expect(
        session.invoke(session.subject.find(Child), 'onSave', 'archer'),
      ).rejects.toThrow(
        'Cannot invoke prop "onSave": expected a callback function.',
      );
    });

    test('reject non-function callback values received at runtime', async () => {
      const Child = (_props: { onSave: (id: string) => void }) => null;
      function App() {
        const untypedProps = {
          onSave: 'invalid',
        } as unknown as React.ComponentProps<typeof Child>;
        return <Child {...untypedProps} />;
      }
      const session = getComponentRenderer(App, {})[mode]();

      await expect(
        session.invoke(session.subject.find(Child), 'onSave', 'archer'),
      ).rejects.toThrow(
        'Cannot invoke prop "onSave": expected a callback function.',
      );
    });
  });
}
