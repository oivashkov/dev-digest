/* diff-viewer — unified-diff viewer with optional inline GitHub comments.
   Public surface: the DiffViewer component + the DiffCommentApi contract,
   plus the internal building blocks (FileCard, CodeLine, parsePatch, the
   shared style helpers `s`/`chevronFor`/`lineRowFor`/`lineSignFor`) so a
   sibling viewer (e.g. SmartDiffViewer) can reuse them instead of
   reimplementing file/line rendering. */
export { DiffViewer } from "./DiffViewer";
export type { DiffCommentApi } from "./comments";
export { FileCard } from "./FileCard";
export { CodeLine } from "./CodeLine";
export { parsePatch, type Line } from "./helpers";
export { s, chevronFor, lineRowFor, lineSignFor } from "./styles";
