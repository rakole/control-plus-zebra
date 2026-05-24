import type { HarnessDescriptor } from "../../core/adapter-contract/session-source-adapter.js";
import {
  ARCHIVE_READER_ADAPTER_ID,
  archiveReaderCapabilities
} from "../../core/archive/archive-reader-shared.js";

export { archiveReaderCapabilities } from "../../core/archive/archive-reader-shared.js";

export const archiveReaderDescriptor: HarnessDescriptor = {
  id: ARCHIVE_READER_ADAPTER_ID,
  displayName: "Archive Reader",
  vendor: "Agent Workbench",
  adapterVersion: "0.1.0",
  parserVersion: "0.1.0",
  supportedPlatforms: ["darwin", "linux", "win32"],
  defaultRoots: [],
  capabilities: archiveReaderCapabilities
};
