import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { MessageChannel } from 'node:worker_threads';
import { JSDOM } from 'jsdom';
import { createStrategyGameFixture } from './benchmark-fixtures/strategy-game.mjs';

// React DOM detects its host environment at import time.
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
// React 17's browser scheduler owns MessagePorts. Track the host resources
// created by this benchmark so teardown can close them instead of forcing exit.
const channels = [];
globalThis.MessageChannel = class extends MessageChannel {
  constructor() {
    super();
    channels.push(this);
  }
};
for (const key of [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'Element',
  'Node',
  'MouseEvent',
  'requestAnimationFrame',
  'cancelAnimationFrame',
]) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: dom.window[key],
  });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { default: React } = await import('react');
const { getComponentRenderer, cleanup } =
  await import('react-contract-renderer');
const { render, cleanup: rtlCleanup } =
  await import('@testing-library/react/pure.js');
const h = React.createElement;

function Leaf({ label }) {
  return h('button', { type: 'button' }, label);
}
function Effect({ label }) {
  const [value, setValue] = React.useState('pending');
  React.useEffect(() => {
    setValue(label);
  }, [label]);
  return h('output', null, value);
}
function Branch({ label }) {
  return h('span', null, label);
}
function Tree({ label }) {
  return h(
    'section',
    null,
    Array.from({ length: 24 }, (_, index) =>
      h(Branch, { key: index, label: `${label}:${index}` }),
    ),
  );
}
const fixtures = [
  {
    component: Leaf,
    expectedText: 'contract',
    iterations: 1000,
    name: 'Leaf component',
    props: { label: 'contract' },
    verifyShallow(subject) {
      assert.equal(subject.text(), 'contract');
    },
  },
  {
    component: Effect,
    expectedText: 'contract',
    iterations: 1000,
    name: 'Effect-driven update',
    props: { label: 'contract' },
    verifyShallow(subject) {
      assert.equal(subject.text(), 'contract');
    },
  },
  {
    component: Tree,
    expectedText: Array.from(
      { length: 24 },
      (_, index) => `contract:${index}`,
    ).join(''),
    iterations: 1000,
    name: '24-child tree',
    props: { label: 'contract' },
    verifyShallow(subject) {
      const branches = subject.findAll(Branch);
      assert.equal(branches.length, 24);
      assert.equal(branches[23].prop('label'), 'contract:23');
    },
  },
  createStrategyGameFixture(React),
];
const warmups = 60;
const rounds = 11;
const mountTolerance = 1.1;
const results = [];
let failed = false;

function createSession(renderer, mode, providers = []) {
  const session = renderer[mode]();
  if (providers.length > 0) session.with(...providers);
  return session;
}

function wrapWithProviders(element, providers = []) {
  return providers.reduceRight(
    (child, Provider) => h(Provider, null, child),
    element,
  );
}

function verifyDOM(fixture, root) {
  if (fixture.expectedText !== undefined)
    assert.equal(root.textContent, fixture.expectedText);
  fixture.verifyDOM?.(root, assert);
}

try {
  for (const fixture of fixtures) {
    const renderer = getComponentRenderer(fixture.component, fixture.props);
    const element = h(fixture.component, fixture.props);
    const wrappedElement = wrapWithProviders(element, fixture.providers);

    const shallow = createSession(renderer, 'shallow', fixture.providers);
    fixture.verifyShallow(shallow.subject, assert);
    cleanup();

    const mounted = createSession(renderer, 'mount', fixture.providers);
    verifyDOM(fixture, mounted.subject.getDOMNode());
    cleanup();

    const reference = render(wrappedElement);
    const referenceRoot = reference.container.firstElementChild;
    assert.ok(referenceRoot, `${fixture.name} rendered no host element`);
    verifyDOM(fixture, referenceRoot);
    rtlCleanup();

    const operations = {
      shallow: () => {
        void createSession(renderer, 'shallow', fixture.providers).subject;
        cleanup();
      },
      mount: () => {
        void createSession(renderer, 'mount', fixture.providers).subject;
        cleanup();
      },
      rtl: () => {
        render(wrappedElement);
        rtlCleanup();
      },
    };
    const samples = { shallow: [], mount: [], rtl: [] };
    const names = Object.keys(operations);
    for (let warmup = 0; warmup < warmups; warmup++) {
      for (const name of names) operations[name]();
    }
    for (let round = 0; round < rounds; round++) {
      // Rotate order to distribute JIT, GC and machine drift across implementations.
      for (let offset = 0; offset < names.length; offset++) {
        const name = names[(round + offset) % names.length];
        const start = performance.now();
        for (let iteration = 0; iteration < fixture.iterations; iteration++)
          operations[name]();
        samples[name].push((performance.now() - start) / fixture.iterations);
      }
    }
    const medians = Object.fromEntries(
      names.map((name) => {
        samples[name].sort((a, b) => a - b);
        return [name, samples[name][Math.floor(rounds / 2)]];
      }),
    );
    const passed =
      medians.shallow <= medians.rtl &&
      medians.mount <= medians.rtl * mountTolerance;
    failed ||= !passed;
    results.push({
      fixture: fixture.name,
      iterations: fixture.iterations,
      shallowMs: medians.shallow,
      mountMs: medians.mount,
      rtlMs: medians.rtl,
      shallowRatio: medians.shallow / medians.rtl,
      mountRatio: medians.mount / medians.rtl,
      passed,
    });
  }
  console.table(results);
  console.log(
    JSON.stringify({
      react: React.version,
      warmups,
      rounds,
      mountTolerance,
      results,
    }),
  );
  if (failed)
    throw new Error(
      'Performance gate failed: shallow must beat React Testing Library and mount must stay within 10% of its baseline.',
    );
} finally {
  try {
    cleanup();
    rtlCleanup();
  } finally {
    for (const channel of channels) {
      channel.port1.close();
      channel.port2.close();
    }
    dom.window.close();
  }
}
