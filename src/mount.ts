import * as React from 'react';
import type { ElementType, ReactNode } from 'react';
import { inspectDOMRoot, selectDOMReactVersion } from './adapters/dom.js';
import type { DOMReactVersion } from './adapters/dom.js';
import { enterActEnvironment, leaveActEnvironment, wrap } from './internal.js';
import type { DriverOptions, PropRecord, RenderDriver } from './internal.js';

type ReactAct = (callback: () => void | Promise<void>) => PromiseLike<void>;

interface LegacyDOM {
  readonly version: string;
  render(element: ReactNode, container: Element): unknown;
  unmountComponentAtNode(container: Element): boolean;
}

interface ConcurrentDOM {
  readonly version: string;
  flushSync(callback: () => void): void;
}

interface DOMRoot {
  render(element: ReactNode): void;
  unmount(): void;
}

interface DOMClient {
  createRoot(
    container: Element,
    options?: { onUncaughtError: (error: unknown) => void },
  ): DOMRoot;
}

interface DOMRuntime {
  readonly version: DOMReactVersion;
  readonly reactAct: ReactAct;
  readonly legacy: LegacyDOM | null;
  readonly concurrent: ConcurrentDOM | null;
  readonly client: DOMClient | null;
}

let cachedRuntime: DOMRuntime | undefined;

function loadRuntime(): DOMRuntime {
  const version = selectDOMReactVersion(React.version);
  const reactRuntime = React as unknown as Readonly<Record<string, unknown>>;
  // Load only the entry points supported by this React version, once per process.
  const utilities: Readonly<Record<string, unknown>> =
    typeof reactRuntime['act'] === 'function'
      ? reactRuntime
      : (require('react-dom/test-utils') as Readonly<Record<string, unknown>>);
  const actCandidate = utilities['act'];
  if (typeof actCandidate !== 'function')
    throw new Error(
      'This React build does not provide act(). Use a development React build for testing.',
    );
  const reactAct = actCandidate as ReactAct;
  const legacy = version === 17 ? (require('react-dom') as LegacyDOM) : null;
  const concurrent =
    version === 17 ? null : (require('react-dom') as ConcurrentDOM);
  const domVersion = legacy?.version ?? concurrent?.version;
  if (domVersion !== React.version) {
    throw new Error(
      `React and React DOM versions must match; received React ${React.version} and React DOM ${String(domVersion)}.`,
    );
  }
  const client =
    version === 17 ? null : (require('react-dom/client') as DOMClient);
  return { version, reactAct, legacy, concurrent, client };
}

export function createMountDriver(options: DriverOptions): RenderDriver {
  if (typeof document === 'undefined' || document.body === null) {
    throw new Error(
      'mount() requires a DOM document with a body. Configure jsdom before mounting.',
    );
  }
  const { version, reactAct, legacy, client } = (cachedRuntime ??=
    loadRuntime());
  const container = document.createElement('div');
  let root: DOMRoot | null = null;
  let unmounted = false;
  let currentProps = options.props;
  let currentWrappers = options.wrappers;
  let { initialElement } = options;
  const pendingErrors: unknown[] = [];

  function throwPendingErrors(): void {
    if (pendingErrors.length === 0) return;
    if (pendingErrors.length === 1) throw pendingErrors.shift();
    const errors = pendingErrors.splice(0);
    throw new AggregateError(errors, 'Multiple uncaught React errors.');
  }

  function sync(callback: () => void): void {
    enterActEnvironment();
    try {
      // act() already commits synchronous work and effects; nesting flushSync
      // here creates a second scheduler boundary on every render and unmount.
      reactAct(callback);
      throwPendingErrors();
    } finally {
      leaveActEnvironment();
    }
  }

  const driver: RenderDriver = {
    mode: 'mount',
    inspect() {
      throwPendingErrors();
      return unmounted
        ? null
        : inspectDOMRoot(version, container, root, options.component);
    },
    render(props: PropRecord, wrappers: readonly ElementType[]): void {
      if (unmounted) throw new Error('Cannot render an unmounted subject.');
      currentProps = props;
      currentWrappers = wrappers;
      const target =
        initialElement ?? React.createElement(options.component, props);
      initialElement = undefined;
      const element = wrap(target, wrappers, (type, providerProps) =>
        React.createElement(type, providerProps),
      );
      sync(() => {
        if (legacy !== null) legacy.render(element, container);
        else if (root !== null) root.render(element);
        else throw new Error('React DOM root was not initialized.');
      });
    },
    flush(): void {
      if (!unmounted) driver.render(currentProps, currentWrappers);
    },
    async act(callback: () => void | Promise<void>): Promise<void> {
      if (unmounted) throw new Error('Cannot act on an unmounted subject.');
      enterActEnvironment();
      try {
        await reactAct(async () => {
          await callback();
        });
        throwPendingErrors();
      } finally {
        leaveActEnvironment();
      }
    },
    unmount(): void {
      if (unmounted) return;
      unmounted = true;
      try {
        sync(() => {
          if (legacy !== null) legacy.unmountComponentAtNode(container);
          else root?.unmount();
        });
      } finally {
        root = null;
        container.remove();
      }
    },
  };

  document.body.appendChild(container);
  try {
    if (client !== null) {
      root =
        version === 19
          ? client.createRoot(container, {
              onUncaughtError: (error: unknown) => {
                pendingErrors.push(error);
              },
            })
          : client.createRoot(container);
    }
    driver.render(options.props, options.wrappers);
  } catch (error) {
    try {
      driver.unmount();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Mount failed and React cleanup also failed.',
      );
    }
    throw error;
  }
  return driver;
}
