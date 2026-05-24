import type { DataSourceViewModel } from "../../bridge/data-sources.js";

export interface DataSourceEditorState extends DataSourceViewModel {
  isDraft?: boolean | undefined;
}
