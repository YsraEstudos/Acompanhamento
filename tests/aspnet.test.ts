import { subscribeAspNetEndRequest } from '../src/aspnet';

describe('ASP.NET subscription adapter', () => {
  const cleanups: Array<() => void> = [];
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanups.splice(0).forEach(dispose => dispose());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function installManager() {
    let handler: () => void = () => {};
    const manager = {
      add_endRequest: vi.fn((callback: () => void) => { handler = callback; }),
      remove_endRequest: vi.fn((_callback: () => void) => {})
    };
    vi.stubGlobal('unsafeWindow', { Sys: { WebForms: { PageRequestManager: { getInstance: () => manager } } } });
    return { manager, notify: () => handler() };
  }

  it('shares discovery and the native hook without disposing another consumer', async () => {
    const { manager, notify } = installManager();
    const first = vi.fn();
    const second = vi.fn();
    const disposeFirst = subscribeAspNetEndRequest(first);
    const disposeSecond = subscribeAspNetEndRequest(second);
    cleanups.push(disposeFirst, disposeSecond);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(250);
    expect(manager.add_endRequest).toHaveBeenCalledOnce();
    notify();
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    disposeFirst();
    notify();
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledTimes(2);
    expect(manager.remove_endRequest).not.toHaveBeenCalled();
    disposeSecond();
    expect(manager.remove_endRequest).toHaveBeenCalledWith(manager.add_endRequest.mock.calls[0][0]);
    notify();
    expect(second).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('discovers a late manager and removes discovery when no subscribers remain', async () => {
    vi.stubGlobal('unsafeWindow', {});
    const callback = vi.fn();
    const dispose = subscribeAspNetEndRequest(callback);
    cleanups.push(dispose);
    await vi.advanceTimersByTimeAsync(500);
    const { manager, notify } = installManager();
    await vi.advanceTimersByTimeAsync(250);
    notify();
    expect(callback).toHaveBeenCalledOnce();
    dispose();
    expect(manager.remove_endRequest).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds discovery when the page has no ASP.NET manager', async () => {
    vi.stubGlobal('unsafeWindow', {});
    cleanups.push(subscribeAspNetEndRequest(vi.fn()));
    await vi.advanceTimersByTimeAsync(8500);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels discovery before attachment and supports a fresh subscription', async () => {
    const { manager } = installManager();
    const dispose = subscribeAspNetEndRequest(vi.fn());
    dispose();
    await vi.advanceTimersByTimeAsync(250);
    expect(manager.add_endRequest).not.toHaveBeenCalled();
    cleanups.push(subscribeAspNetEndRequest(vi.fn()));
    await vi.advanceTimersByTimeAsync(250);
    expect(manager.add_endRequest).toHaveBeenCalledOnce();
  });
});
