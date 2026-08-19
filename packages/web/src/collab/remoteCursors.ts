import { EditorView } from "@codemirror/view";

/**
 * Styling for remote users' cursors and selections.
 *
 * y-codemirror.next draws each remote caret as an element with the CSS classes
 * `.cm-ySelectionCaret` (the vertical bar) and `.cm-ySelectionInfo` (the little
 * name flag above it), and it sets the color inline from each user's awareness
 * `user.color` field. This theme just makes those elements look good and keeps
 * the name flags readable without overlapping the text.
 */
export const remoteCursorsTheme = EditorView.baseTheme({
  ".cm-ySelectionCaret": {
    borderLeftWidth: "2px",
    borderLeftStyle: "solid",
    marginLeft: "-1px",
  },
  // The floating name label; color comes inline from the user's color.
  ".cm-ySelectionInfo": {
    fontSize: "0.7rem",
    fontFamily: "system-ui, sans-serif",
    padding: "0 4px",
    borderRadius: "4px 4px 4px 0",
    color: "#fff",
    fontWeight: "600",
    opacity: "0.95",
    whiteSpace: "nowrap",
    pointerEvents: "none",
  },
  // Remote selection highlight (semi-transparent so text stays readable).
  ".cm-ySelection": {
    opacity: "0.5",
  },
});
