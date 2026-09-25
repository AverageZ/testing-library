import * as React from 'react';
import type { ReactNode } from 'react';
import type { PropRecord } from '../internal.js';

export interface HostNode {
  type: string;
  props: PropRecord;
  children: HostNode[];
  hidden: boolean;
}

interface Reconciler {
  createContainer(...args: unknown[]): unknown;
  updateContainer(
    element: ReactNode,
    root: unknown,
    parent: null,
    callback: null,
  ): void;
  updateContainerSync?: (
    element: ReactNode,
    root: unknown,
    parent: null,
    callback: null,
  ) => void;
  flushSync?: (callback: () => void) => void;
  flushSyncFromReconciler?: (callback: () => void) => void;
  flushSyncWork?: () => void;
  flushPassiveEffects(): boolean;
}

type Factory = (config: Readonly<Record<string, unknown>>) => Reconciler;
type Act = (callback: () => void | Promise<void>) => PromiseLike<void>;
const noop = (): void => {};
const emptyContext = Object.freeze({});
let instance: Reconciler | undefined;
let cachedAct: Act | undefined;

export function reactVersion(): { major: number; minor: number } {
  const match = /^(17|18|19)\.(\d+)\.(\d+)$/.exec(React.version);
  const major = Number(match?.[1]);
  const minor = Number(match?.[2]);
  if (
    !match ||
    (major === 17 && minor !== 0) ||
    (major === 18 && (minor < 2 || minor > 3)) ||
    (major === 19 && minor > 3)
  ) {
    throw new Error(
      `Unsupported React ${React.version}; tested adapters cover 17.0.2, 18.2–18.3, and 19.0–19.3 stable releases.`,
    );
  }
  return { major, minor };
}

function loadFactory(major: number, minor: number): Factory {
  switch (major) {
    case 17:
      return require('./adapters/react17.cjs') as Factory;
    case 18:
      return require('./adapters/react18.cjs') as Factory;
    case 19:
      switch (minor) {
        case 0:
          return require('./adapters/react19_0.cjs') as Factory;
        case 1:
          return require('./adapters/react19_1.cjs') as Factory;
        case 2:
          return require('./adapters/react19_2.cjs') as Factory;
        case 3:
          return require('./adapters/react19_3.cjs') as Factory;
      }
  }
  throw new Error(`No reconciler adapter for React ${React.version}`);
}

function remove(parent: HostNode, child: HostNode): void {
  const index = parent.children.indexOf(child);
  if (index >= 0) parent.children.splice(index, 1);
}
function append(parent: HostNode, child: HostNode): void {
  remove(parent, child);
  parent.children.push(child);
}
function insert(parent: HostNode, child: HostNode, before: HostNode): void {
  remove(parent, child);
  const index = parent.children.indexOf(before);
  if (index < 0)
    throw new Error('Invalid insertion point in shallow host tree');
  parent.children.splice(index, 0, child);
}

function getReconciler(): Reconciler {
  if (instance) return instance;
  const { major, minor } = reactVersion();
  let priority = 0;
  const config: Record<string, unknown> = {
    rendererVersion: '0.1.0',
    rendererPackageName: 'react-contract-renderer',
    isPrimaryRenderer: false,
    supportsMutation: true,
    supportsPersistence: false,
    supportsHydration: false,
    supportsMicrotasks: true,
    supportsResources: false,
    supportsSingletons: false,
    supportsTestSelectors: false,
    getRootHostContext: () => emptyContext,
    getChildHostContext: () => emptyContext,
    getPublicInstance: (node: HostNode) => node,
    prepareForCommit: () => null,
    resetAfterCommit: noop,
    createInstance: (type: string, props: PropRecord): HostNode => ({
      type,
      props,
      children: [],
      hidden: false,
    }),
    createTextInstance: (text: string): HostNode => ({
      type: '#text',
      props: { text },
      children: [],
      hidden: false,
    }),
    appendInitialChild: append,
    appendChild: append,
    appendChildToContainer: append,
    insertBefore: insert,
    insertInContainerBefore: insert,
    removeChild: remove,
    removeChildFromContainer: remove,
    clearContainer: (container: HostNode) => {
      container.children.length = 0;
    },
    finalizeInitialChildren: () => false,
    shouldSetTextContent: () => false,
    prepareUpdate: () => true,
    commitUpdate:
      major >= 19
        ? (
            node: HostNode,
            _type: string,
            _old: PropRecord,
            props: PropRecord,
          ) => {
            node.props = props;
          }
        : (
            node: HostNode,
            _payload: unknown,
            _type: string,
            _old: PropRecord,
            props: PropRecord,
          ) => {
            node.props = props;
          },
    commitTextUpdate: (node: HostNode, _old: string, text: string) => {
      node.props = { text };
    },
    resetTextContent: (node: HostNode) => {
      node.children.length = 0;
    },
    hideInstance: (node: HostNode) => {
      node.hidden = true;
    },
    unhideInstance: (node: HostNode) => {
      node.hidden = false;
    },
    hideTextInstance: (node: HostNode) => {
      node.hidden = true;
    },
    unhideTextInstance: (node: HostNode) => {
      node.hidden = false;
    },
    detachDeletedInstance: (node: HostNode) => {
      node.children.length = 0;
    },
    preparePortalMount: noop,
    now: () => performance.now(),
    scheduleTimeout: setTimeout,
    cancelTimeout: clearTimeout,
    noTimeout: -1,
    scheduleMicrotask: queueMicrotask,
    getCurrentEventPriority: () => 16,
    getCurrentUpdatePriority: () => priority,
    setCurrentUpdatePriority: (next: number) => {
      priority = next;
    },
    resolveUpdatePriority: () => priority || 32,
    shouldAttemptEagerTransition: () => false,
    trackSchedulerEvent: noop,
    resolveEventType: () => null,
    resolveEventTimeStamp: () => -1.1,
    maySuspendCommit: () => false,
    maySuspendCommitOnUpdate: () => false,
    maySuspendCommitInSyncRender: () => false,
    preloadInstance: () => true,
    NotPendingTransition: null,
    HostTransitionContext: React.createContext(null),
  };
  instance = loadFactory(major, minor)(config);
  return instance;
}

function actFunction(): Act | undefined {
  if (cachedAct) return cachedAct;
  const react = React as unknown as { act?: Act };
  if (react.act) cachedAct = react.act;
  else if (reactVersion().major === 18) {
    // React 18.2 exposes the shared act queue through react-dom/test-utils.
    const utilities = require('react-dom/test-utils') as { act: Act };
    cachedAct = utilities.act;
  }
  return cachedAct;
}

/** React owns hook state, scheduling, and effect lifecycles; this adapter owns only host output. */
export function createShallowRoot(): {
  readonly container: HostNode;
  render(element: ReactNode): void;
  flush(): void;
  act(callback: () => void | Promise<void>): Promise<void>;
} {
  const reconciler = getReconciler();
  const { major } = reactVersion();
  const container: HostNode = {
    type: '#root',
    props: {},
    children: [],
    hidden: false,
  };
  let failure: { error: unknown } | undefined;
  const onError = (error: unknown): void => {
    failure = { error };
  };
  const root =
    major === 17
      ? reconciler.createContainer(container, 0, false, null)
      : major === 18
        ? reconciler.createContainer(
            container,
            1,
            null,
            false,
            null,
            '',
            onError,
            null,
          )
        : reconciler.createContainer(
            container,
            1,
            null,
            false,
            null,
            '',
            onError,
            onError,
            onError,
            noop,
          );
  const checkError = (): void => {
    if (failure) {
      const error = failure.error;
      failure = undefined;
      throw error;
    }
  };
  const flushSync = reconciler.flushSync ?? reconciler.flushSyncFromReconciler;
  if (!flushSync)
    throw new Error(
      `React ${React.version} reconciler has no synchronous flush API`,
    );
  const drain = (): void => {
    let passes = 0;
    do {
      flushSync(noop);
      checkError();
      if (++passes > 100)
        throw new Error('Shallow effects did not settle after 100 flushes');
    } while (reconciler.flushPassiveEffects());
    checkError();
  };
  const withEnvironment = <T>(callback: () => T): T => {
    const globals = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    const previous = globals.IS_REACT_ACT_ENVIRONMENT;
    globals.IS_REACT_ACT_ENVIRONMENT = true;
    try {
      return callback();
    } finally {
      if (previous === undefined) delete globals.IS_REACT_ACT_ENVIRONMENT;
      else globals.IS_REACT_ACT_ENVIRONMENT = previous;
    }
  };
  const sync = (callback: () => void): void => {
    const act = actFunction();
    if (act)
      withEnvironment(() => {
        void act(() => {
          callback();
          drain();
        });
      });
    else {
      callback();
      drain();
    }
    checkError();
  };
  return {
    container,
    render(element) {
      sync(() =>
        flushSync(() => {
          (reconciler.updateContainerSync ?? reconciler.updateContainer)(
            element,
            root,
            null,
            null,
          );
        }),
      );
    },
    flush() {
      sync(noop);
    },
    async act(callback) {
      const act = actFunction();
      if (act) {
        const globals = globalThis as typeof globalThis & {
          IS_REACT_ACT_ENVIRONMENT?: boolean;
        };
        const previous = globals.IS_REACT_ACT_ENVIRONMENT;
        globals.IS_REACT_ACT_ENVIRONMENT = true;
        try {
          await act(async () => {
            await callback();
            drain();
          });
        } finally {
          if (previous === undefined) delete globals.IS_REACT_ACT_ENVIRONMENT;
          else globals.IS_REACT_ACT_ENVIRONMENT = previous;
        }
      } else {
        await callback();
        drain();
      }
      checkError();
    },
  };
}
