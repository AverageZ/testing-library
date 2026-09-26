// @vitest-environment jsdom
import * as fc from 'fast-check';
import * as React from 'react';
import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, getComponentRenderer } from '@avgz/react-contract-renderer';

const modes = ['shallow', 'mount'] as const;

afterEach(cleanup);

for (const mode of modes) {
  describe(`${mode} subjects`, () => {
    test('query the root and descendants with explicit cardinality', () => {
      function App() {
        return (
          <ul>
            <li>first</li>
            <li>second</li>
          </ul>
        );
      }
      const { subject } = getComponentRenderer(App, {})[mode]();

      expect(subject.find(App).type()).toBe(App);
      expect(subject.find('ul').type()).toBe('ul');
      expect(subject.findAll('li').map((item) => item.text())).toEqual([
        'first',
        'second',
      ]);
      expect(subject.find('button').exists()).toBe(false);
      expect(() => subject.find('li').text()).toThrow(
        'Subject selection is ambiguous: found 2 nodes',
      );
      expect(() => subject.find('button').props()).toThrow(
        'Subject selection is empty',
      );
    });

    test('keep findAll selections live by render index', () => {
      const Item = (_props: { id: number }) => null;
      function App({ ids }: { ids: readonly number[] }) {
        return (
          <>
            {ids.map((id) => (
              <Item key={id} id={id} />
            ))}
          </>
        );
      }
      const session = getComponentRenderer(App, { ids: [10, 20, 30] })[mode]();
      const items = session.subject.findAll(Item);

      session.rerender({ ids: [30, 10] });

      expect(items[0]?.prop('id')).toBe(30);
      expect(items[1]?.prop('id')).toBe(10);
      expect(items[2]?.exists()).toBe(false);
      expect(
        session.subject.findAll(Item).map((item) => item.prop('id')),
      ).toEqual([30, 10]);
    });

    test('expose props, prop, className, type, and element', () => {
      function App({ label }: { label: string }) {
        return <section className="contract">{label}</section>;
      }
      const { subject } = getComponentRenderer(App, { label: 'value' })[mode]();
      const section = subject.find('section');
      const element = section.element();

      expect(subject.props()).toEqual({ label: 'value' });
      expect(subject.prop('label')).toBe('value');
      expect(section.className()).toBe('contract');
      expect(section.type()).toBe('section');
      expect(element.type).toBe('section');
      expect(element.props).toMatchObject({
        className: 'contract',
        children: 'value',
      });
    });

    test('flatten primitive and fragment text in render order', () => {
      function App() {
        return (
          <output>
            prefix
            <>
              {1}
              {null}
              {false}
              <span>nested</span>
            </>
            suffix
          </output>
        );
      }
      const output = getComponentRenderer(App, {})
        [mode]()
        .subject.find('output');

      expect(output.text()).toBe('prefix1nestedsuffix');
    });

    test('reject invalid query identities and non-string class names', () => {
      const Child = (_props: { className: unknown }) => null;
      function App() {
        return <Child className={{ token: true }} />;
      }
      const { subject } = getComponentRenderer(App, {})[mode]();

      expect(() => subject.find('.item' as 'div')).toThrow(
        'Subject queries accept an intrinsic tag name, not a CSS selector',
      );
      expect(() => subject.find(null as never)).toThrow(
        'Subject queries require a React component identity',
      );
      expect(() => subject.find(Child).className()).toThrow(
        'className prop that is not a string',
      );
    });

    describe('property-based tests', () => {
      const identifiers = fc.uniqueArray(
        fc.integer({ min: -1_000, max: 1_000 }),
        { maxLength: 8 },
      );

      test('generated query cardinality and order match the current render', () => {
        fc.assert(
          fc.property(
            identifiers,
            fc.array(identifiers, { maxLength: 6 }),
            (initial, updates) => {
              const Item = (_props: { id: number }) => null;
              function App({ ids }: { ids: readonly number[] }) {
                return (
                  <>
                    {ids.map((id) => (
                      <Item key={id} id={id} />
                    ))}
                  </>
                );
              }
              const session = getComponentRenderer(App, { ids: initial })[
                mode
              ]();

              try {
                for (const ids of [initial, ...updates]) {
                  session.rerender({ ids });
                  expect(
                    session.subject
                      .findAll(Item)
                      .map((item) => item.prop('id')),
                  ).toEqual(ids);

                  const singular = session.subject.find(Item);
                  if (ids.length === 0) {
                    expect(singular.exists()).toBe(false);
                  } else if (ids.length === 1) {
                    expect(singular.prop('id')).toBe(ids[0]);
                  } else {
                    expect(() => singular.props()).toThrow(
                      `Subject selection is ambiguous: found ${ids.length} nodes`,
                    );
                  }
                }
              } finally {
                session.unmount();
              }
            },
          ),
          { numRuns: 50 },
        );
      });

      const textToken = fc.oneof(
        fc.string({ maxLength: 12 }),
        fc.integer({ min: -1_000, max: 1_000 }),
        fc.constant(null),
        fc.constant(false),
      );

      test('generated fragment text matches renderable primitive concatenation', () => {
        fc.assert(
          fc.property(fc.array(textToken, { maxLength: 10 }), (tokens) => {
            function App() {
              return (
                <output>
                  {tokens.map((token, index) => (
                    <React.Fragment key={index}>{token}</React.Fragment>
                  ))}
                </output>
              );
            }
            const session = getComponentRenderer(App, {})[mode]();

            try {
              const expected = tokens
                .filter(
                  (token): token is string | number =>
                    typeof token === 'string' || typeof token === 'number',
                )
                .map(String)
                .join('');
              expect(session.subject.find('output').text()).toBe(expected);
            } finally {
              session.unmount();
            }
          }),
          { numRuns: 50 },
        );
      });
    });
  });
}

test('mount returns a composite first host element and rejects hostless output', () => {
  function Wrapper() {
    return (
      <section>
        <strong>content</strong>
      </section>
    );
  }
  function Hostless() {
    return null;
  }
  function App() {
    return (
      <>
        <Wrapper />
        <Hostless />
      </>
    );
  }
  const { subject } = getComponentRenderer(App, {}).mount();

  expect(subject.find(Wrapper).getDOMNode().tagName).toBe('SECTION');
  expect(() => subject.find(Hostless).getDOMNode()).toThrow(
    'The selected node has no associated host DOM element',
  );
});

test('shallow rejects DOM access even for host selections', () => {
  function App() {
    return <div />;
  }
  const div = getComponentRenderer(App, {}).shallow().subject.find('div');

  expect(() => div.getDOMNode()).toThrow(
    'getDOMNode() is unavailable for shallow rendering',
  );
});
