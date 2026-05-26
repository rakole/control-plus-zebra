import {
  FakeWorkbenchEntityStore,
  runWorkbenchEntityStoreContractSuite
} from "./workbench-entity-store.contract-suite.js";

runWorkbenchEntityStoreContractSuite("WorkbenchEntityStore contract", () => ({
  store: new FakeWorkbenchEntityStore()
}));
