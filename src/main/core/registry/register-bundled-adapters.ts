import { fakeTestAdapter } from "../../adapters/fake-test/index.js";
import { AdapterRegistry } from "./adapter-registry.js";

export function registerBundledAdapters(
  registry: AdapterRegistry = new AdapterRegistry()
): AdapterRegistry {
  registry.register(fakeTestAdapter);
  return registry;
}

export function createBundledAdapterRegistry(): AdapterRegistry {
  return registerBundledAdapters();
}
