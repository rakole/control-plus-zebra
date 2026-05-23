import type {
  HarnessDescriptor,
  SessionSourceAdapter
} from "../adapter-contract/index.js";
import type { AdapterId } from "../model/identifiers.js";

export class AdapterRegistry {
  readonly #adapters = new Map<AdapterId, SessionSourceAdapter>();

  register(adapter: SessionSourceAdapter): this {
    if (this.#adapters.has(adapter.descriptor.id)) {
      throw new Error(`Adapter '${adapter.descriptor.id}' is already registered.`);
    }

    this.#adapters.set(adapter.descriptor.id, adapter);
    return this;
  }

  get(adapterId: AdapterId): SessionSourceAdapter | undefined {
    return this.#adapters.get(adapterId);
  }

  require(adapterId: AdapterId): SessionSourceAdapter {
    const adapter = this.get(adapterId);

    if (!adapter) {
      throw new Error(`Adapter '${adapterId}' is not registered.`);
    }

    return adapter;
  }

  listDescriptors(): HarnessDescriptor[] {
    return [...this.#adapters.values()].map((adapter) => adapter.descriptor);
  }

  listAdapters(): SessionSourceAdapter[] {
    return [...this.#adapters.values()];
  }
}
