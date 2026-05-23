import { fakeTestAdapter } from "../../adapters/fake-test/index.js";
import { geminiCliAdapter } from "../../adapters/gemini-cli/index.js";
import { AdapterRegistry } from "./adapter-registry.js";

export function registerBundledAdapters(
  registry: AdapterRegistry = new AdapterRegistry()
): AdapterRegistry {
  registry.register(fakeTestAdapter);
  registry.register(geminiCliAdapter);
  return registry;
}

export function createBundledAdapterRegistry(): AdapterRegistry {
  return registerBundledAdapters();
}
