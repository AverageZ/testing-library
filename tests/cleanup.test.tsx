// @vitest-environment jsdom
import * as fc from 'fast-check';
import * as React from 'react';
import { afterEach, describe, expect, test } from 'vitest';
import {
  cleanup,
  getComponentRenderer,
  type RenderSession,
} from 'react-contract-renderer';

const modes = ['shallow', 'mount'] as const;

afterEach(cleanup);

test('cleanup unmounts every initialized mode and removes mounted DOM', () => {
  const stopped: string[] = [];
  function App({ name }: { name: string }) {
    React.useEffect(
      () => () => {
        stopped.push(name);
      },
      [name],
    );
    return <span>{name}</span>;
  }
  const before = document.body.childElementCount;
  const shallow = getComponentRenderer(App, { name: 'shallow' }).shallow();
  const mount = getComponentRenderer(App, { name: 'mount' }).mount();
  const shallowSubject = shallow.subject;
  const mountSubject = mount.subject;

  expect(document.body.childElementCount).toBe(before + 1);
  cleanup();

  expect(stopped.sort()).toEqual(['mount', 'shallow']);
  expect(shallowSubject.exists()).toBe(false);
  expect(mountSubject.exists()).toBe(false);
  expect(document.body.childElementCount).toBe(before);
});

test('cleanup is repeatable and does not initialize untouched sessions', () => {
  let renders = 0;
  function App() {
    renders++;
    return null;
  }
  const untouched = getComponentRenderer(App, {}).mount();

  cleanup();
  cleanup();
  expect(renders).toBe(0);

  void untouched.subject;
  expect(renders).toBe(1);
  untouched.unmount();
});

for (const mode of modes) {
  describe(`${mode} cleanup failures`, () => {
    test('continue cleaning later sessions before rethrowing one failure', () => {
      const failure = new Error(`${mode} cleanup failed`);
      const stopped: string[] = [];
      function App() {
        return null;
      }
      const broken = getComponentRenderer(App, {})[mode]();
      const healthy = getComponentRenderer(App, {})[mode]();
      void broken.subject;
      void healthy.subject;
      const unmountBroken = broken.unmount.bind(broken);
      const unmountHealthy = healthy.unmount.bind(healthy);
      broken.unmount = () => {
        unmountBroken();
        stopped.push('broken');
        throw failure;
      };
      healthy.unmount = () => {
        unmountHealthy();
        stopped.push('healthy');
      };

      expect(() => cleanup()).toThrow(failure);
      expect(stopped).toEqual(['broken', 'healthy']);
    });
  });
}

test('aggregate every cleanup failure after attempting all sessions', () => {
  const first = new Error('first cleanup failed');
  const second = new Error('second cleanup failed');
  const stopped: string[] = [];
  function App() {
    return null;
  }
  const one = getComponentRenderer(App, {}).shallow();
  const two = getComponentRenderer(App, {}).mount();
  void one.subject;
  void two.subject;
  const unmountOne = one.unmount.bind(one);
  const unmountTwo = two.unmount.bind(two);
  one.unmount = () => {
    unmountOne();
    stopped.push('first');
    throw first;
  };
  two.unmount = () => {
    unmountTwo();
    stopped.push('second');
    throw second;
  };

  let thrown: unknown;
  try {
    cleanup();
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(AggregateError);
  expect((thrown as AggregateError).errors).toEqual([first, second]);
  expect(stopped).toEqual(['first', 'second']);
});

describe('property-based tests', () => {
  const sessionSpecification = fc.record({
    mode: fc.constantFrom(...modes),
    initialized: fc.boolean(),
  });

  test('cleanup disposes exactly the initialized generated sessions', () => {
    fc.assert(
      fc.property(
        fc.array(sessionSpecification, { maxLength: 6 }),
        (specifications) => {
          const stopped: number[] = [];
          const initialized: Array<{
            id: number;
            session: RenderSession<{ id: number }>;
          }> = [];
          function App({ id }: { id: number }) {
            React.useEffect(
              () => () => {
                stopped.push(id);
              },
              [id],
            );
            return null;
          }

          specifications.forEach((specification, id) => {
            const session = getComponentRenderer(App, { id })[
              specification.mode
            ]();
            if (specification.initialized) {
              void session.subject;
              initialized.push({ id, session });
            }
          });

          cleanup();

          expect(stopped.sort((left, right) => left - right)).toEqual(
            initialized.map(({ id }) => id),
          );
          for (const { session } of initialized) {
            expect(() => session.subject).toThrow(
              'Cannot use an unmounted render session',
            );
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});
