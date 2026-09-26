import { createElement } from 'react';
import type {
  ComponentProps,
  ComponentType,
  ElementType,
  ReactElement,
  ReactNode,
} from 'react';
import type { DriverFactory, PropRecord, RenderDriver } from './internal.js';
import { createMountDriver } from './mount.js';
import { createShallowDriver } from './shallow.js';
import { Subject } from './subject.js';

export { QueryTree, Subject } from './subject.js';

/** A React provider applied around every render session with {@link RenderSession.with}. */
export type Provider = ComponentType<{ children?: ReactNode }>;
const mounted = new Set<RenderSession<unknown>>();

type CallbackKeys<P> = {
  [K in keyof P]-?: [NonNullable<P[K]>] extends [never]
    ? never
    : NonNullable<P[K]> extends (...args: never[]) => unknown
      ? K
      : never;
}[keyof P];

// Infer once from the whole callback union: arguments must satisfy every member.
type CallbackArguments<F> = [NonNullable<F>] extends [
  (...args: infer Args) => unknown,
]
  ? Args
  : never;

/**
 * A lazily initialized component render. Configure providers before observing
 * {@link subject}; unmount it manually or with {@link cleanup}.
 */
export class RenderSession<P> {
  private driver: RenderDriver | undefined;
  private wrappers: readonly Provider[] = [];
  private disposed = false;
  private selection: Subject<P> | undefined;

  /**
   * @internal
   * Constructed by {@link getComponentRenderer}.
   */
  constructor(
    private readonly component: ElementType,
    private props: P,
    private readonly factory: DriverFactory,
    private readonly initialElement?: ReactElement,
  ) {}

  /**
   * Configure providers before first observation. Providers nest in argument
   * order, so the first provider is outermost.
   */
  with(...providers: readonly Provider[]): this {
    if (this.disposed) throw new Error('Cannot configure an unmounted subject');
    if (this.driver)
      throw new Error(
        'Call .with(...) before observing or updating the subject',
      );
    this.wrappers = [...this.wrappers, ...providers];
    return this;
  }

  /** Inspect the current render through live, typed contract queries. */
  get subject(): Subject<P> {
    const driver = this.initialize();
    this.selection ??= new Subject<P>(() => {
      const node = driver.inspect();
      return node ? [node] : [];
    }, driver.mode);
    return this.selection;
  }

  /** Merge props into the current render while preserving component state. */
  rerender(overrides: Partial<P>): void {
    const driver = this.initialize();
    this.props = { ...this.props, ...overrides };
    driver.render(this.props as PropRecord, this.wrappers);
  }

  /** Flush already scheduled synchronous work; use {@link act} for asynchronous work. */
  flush(): void {
    this.initialize().flush();
  }

  /** Await React work scheduled by the callback. Await the component request or timer inside the callback. */
  async act(callback: () => void | Promise<void>): Promise<void> {
    await this.initialize().act(callback);
  }

  /**
   * Invoke the selected subject's current callback inside {@link act}.
   * Supply its actual arguments, including any required event; no events are
   * fabricated. Optional callbacks must be present and callable at invocation.
   * Await asynchronous callbacks and React work, discarding callback return values.
   */
  async invoke<Props, K extends CallbackKeys<NoInfer<Props>>>(
    subject: Subject<Props>,
    callbackProp: K,
    ...args: CallbackArguments<NoInfer<Props[K]>>
  ): Promise<void> {
    await this.act(async () => {
      const callback = subject.prop(callbackProp);
      if (typeof callback !== 'function') {
        throw new TypeError(
          `Cannot invoke prop "${String(callbackProp)}": expected a callback function.`,
        );
      }
      await (callback as (...args: CallbackArguments<Props[K]>) => unknown)(
        ...args,
      );
    });
  }

  /** Unmount the render. Calling this more than once is safe. */
  unmount(): void {
    if (this.disposed) return;
    this.disposed = true;
    mounted.delete(this as RenderSession<unknown>);
    this.driver?.unmount();
  }

  private initialize(): RenderDriver {
    if (this.disposed)
      throw new Error('Cannot use an unmounted render session');
    if (!this.driver) {
      this.driver = this.factory({
        component: this.component,
        props: this.props as PropRecord,
        wrappers: this.wrappers,
        initialElement: this.initialElement,
      });
      mounted.add(this as RenderSession<unknown>);
    }
    return this.driver;
  }
}

/** Create shallow and DOM render sessions for one component and its typed defaults. */
export interface ComponentRenderer<C extends ElementType> {
  /**
   * Render the target while keeping custom child components opaque. Hooks and
   * effects in the target still run.
   */
  shallow(
    overrides?: Partial<ComponentProps<C>>,
  ): RenderSession<ComponentProps<C>>;

  /** Render the target and descendants into a DOM container. */
  mount(
    overrides?: Partial<ComponentProps<C>>,
  ): RenderSession<ComponentProps<C>>;
}

/**
 * Create independent render sessions from a snapshot of strictly typed defaults.
 *
 * Shallow uses a version-matched React reconciler to execute the target's hooks
 * and effects. Returned custom children are opaque contracts: their props and
 * presence are inspectable, but neither their render functions nor descendants
 * execute. Host refs/DOM behavior therefore belong in mount tests.
 *
 * Mount requires a DOM environment (for example Vitest's jsdom environment)
 * and matching react/react-dom versions. Rendering uses public React DOM APIs;
 * component queries use isolated, read-only, version-gated Fiber inspection.
 * Supported stable lines: React 17.0.2, 18.2–18.3, and 19.0–19.3.
 *
 * Sessions render on first observation/update so provider chaining mounts once.
 * Register `afterEach(cleanup)` with your test runner.
 *
 * @example
 * const renderer = getComponentRenderer(App, { name: 'value' });
 * const { subject } = renderer.shallow({ name: 'other' });
 * expect(subject.find(Page).prop('name')).toBe('other');
 * const mounted = renderer.mount().with(OuterProvider, InnerProvider);
 * expect(mounted.subject.find('button').getDOMNode().textContent).toBe('Save');
 */
export function getComponentRenderer<C extends ElementType>(
  component: C,
  defaultProps: NoInfer<ComponentProps<C>>,
): ComponentRenderer<C> {
  const defaults = { ...defaultProps };
  let defaultElement: ReactElement | undefined;
  return {
    shallow(overrides) {
      return new RenderSession(
        component,
        overrides === undefined ? defaults : { ...defaults, ...overrides },
        createShallowDriver,
      );
    },
    mount(overrides) {
      const props =
        overrides === undefined ? defaults : { ...defaults, ...overrides };
      const element =
        overrides === undefined
          ? (defaultElement ??= createElement(component, defaults))
          : createElement(component, props);
      return new RenderSession(component, props, createMountDriver, element);
    },
  };
}

/**
 * Unmount every live render session. Register this with the test runner's
 * `afterEach`; cleanup continues after an individual unmount fails.
 */
export function cleanup(): void {
  const errors: unknown[] = [];
  for (const session of mounted) {
    try {
      session.unmount();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1)
    throw new AggregateError(
      errors,
      'Multiple render sessions failed to clean up',
    );
}
