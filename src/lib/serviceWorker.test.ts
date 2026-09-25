import { describe, it, expect, vi } from "vitest";
import { activateWaitingVersion, watchForWaitingVersion } from "./serviceWorker";

class FakeWorker extends EventTarget {
  state: ServiceWorkerState = "installing";
  postMessage = vi.fn();

  moveTo(state: ServiceWorkerState) {
    this.state = state;
    this.dispatchEvent(new Event("statechange"));
  }
}

class FakeRegistration extends EventTarget {
  active: FakeWorker | null = null;
  waiting: FakeWorker | null = null;
  installing: FakeWorker | null = null;

  /** The browser found a new version and starts installing it. */
  find(worker: FakeWorker) {
    this.installing = worker;
    this.dispatchEvent(new Event("updatefound"));
  }
}

const asRegistration = (registration: FakeRegistration) =>
  registration as unknown as ServiceWorkerRegistration;

describe("watchForWaitingVersion", () => {
  it("reports a version that was already waiting when the app started", () => {
    const registration = new FakeRegistration();
    registration.active = new FakeWorker();
    registration.waiting = new FakeWorker();
    const onReady = vi.fn();

    watchForWaitingVersion(asRegistration(registration), onReady);

    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("reports a new version once it has installed", () => {
    const registration = new FakeRegistration();
    registration.active = new FakeWorker();
    const onReady = vi.fn();
    watchForWaitingVersion(asRegistration(registration), onReady);

    const next = new FakeWorker();
    registration.find(next);
    expect(onReady).not.toHaveBeenCalled();
    next.moveTo("installed");

    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("does not offer a first install as an update", () => {
    const registration = new FakeRegistration();
    const onReady = vi.fn();
    watchForWaitingVersion(asRegistration(registration), onReady);

    const first = new FakeWorker();
    registration.find(first);
    first.moveTo("installed");

    expect(onReady).not.toHaveBeenCalled();
  });
});

describe("activateWaitingVersion", () => {
  it("asks the waiting version to take over and reloads only once it has", () => {
    const registration = new FakeRegistration();
    const waiting = new FakeWorker();
    registration.waiting = waiting;
    const container = new EventTarget();
    const reload = vi.fn();

    activateWaitingVersion(asRegistration(registration), container, reload);

    expect(waiting.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    expect(reload).not.toHaveBeenCalled();
    container.dispatchEvent(new Event("controllerchange"));
    container.dispatchEvent(new Event("controllerchange"));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads straight away when the new version has already taken over", () => {
    const registration = new FakeRegistration();
    registration.active = new FakeWorker();
    const reload = vi.fn();

    activateWaitingVersion(asRegistration(registration), new EventTarget(), reload);

    expect(reload).toHaveBeenCalledTimes(1);
  });
});
