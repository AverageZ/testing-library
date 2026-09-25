import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { MessageChannel } from 'node:worker_threads';
import { JSDOM } from 'jsdom';

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
  { name: 'leaf', component: Leaf, text: 'contract' },
  { name: 'effect-update', component: Effect, text: 'contract' },
  {
    name: 'child-tree',
    component: Tree,
    text: Array.from({ length: 24 }, (_, index) => `contract:${index}`).join(
      '',
    ),
  },
];
const iterations = 100;
const rounds = 11;
const results = [];
let failed = false;

try {
  for (const fixture of fixtures) {
    const props = { label: 'contract' };
    const renderer = getComponentRenderer(fixture.component, props);
    const element = h(fixture.component, props);
    const mounted = renderer.mount();
    assert.equal(mounted.subject.text(), fixture.text);
    cleanup();
    const reference = render(element);
    assert.equal(reference.container.textContent, fixture.text);
    rtlCleanup();
    const operations = {
      shallow: () => {
        void renderer.shallow().subject;
        cleanup();
      },
      mount: () => {
        void renderer.mount().subject;
        cleanup();
      },
      rtl: () => {
        render(element);
        rtlCleanup();
      },
    };
    const samples = { shallow: [], mount: [], rtl: [] };
    const names = Object.keys(operations);
    for (let warmup = 0; warmup < 60; warmup++) {
      for (const name of names) operations[name]();
    }
    for (let round = 0; round < rounds; round++) {
      // Rotate order to distribute JIT, GC and machine drift across implementations.
      for (let offset = 0; offset < names.length; offset++) {
        const name = names[(round + offset) % names.length];
        const start = performance.now();
        for (let iteration = 0; iteration < iterations; iteration++)
          operations[name]();
        samples[name].push((performance.now() - start) / iterations);
      }
    }
    const medians = Object.fromEntries(
      names.map((name) => {
        samples[name].sort((a, b) => a - b);
        return [name, samples[name][Math.floor(rounds / 2)]];
      }),
    );
    const passed =
      medians.shallow <= medians.rtl && medians.mount <= medians.rtl;
    failed ||= !passed;
    results.push({
      fixture: fixture.name,
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
    JSON.stringify({ react: React.version, iterations, rounds, results }),
  );
  if (failed)
    throw new Error(
      'Performance gate failed: every shallow and mount median must be <= its React Testing Library baseline.',
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
