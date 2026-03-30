import { syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";

/**
 * Extracts a JSONPath from a CodeMirror EditorState based on the character position.
 * Uses the lezer-json syntax tree for accurate traversal.
 */
export function getJsonPathFromCmtree(state: EditorState, pos: number): string {
  const tree = syntaxTree(state);
  let node = tree.resolveInner(pos, -1);
  const segments: string[] = [];

  let child = node;
  let parent = node.parent;

  // Traverse up the syntax tree until we hit the root JSON text
  while (parent && parent.name !== "JsonText") {
    if (parent.name === "Property") {
      // If we are inside a property, the first child is the PropertyName (key)
      const keyNode = parent.getChild("PropertyName");
      if (keyNode) {
        const rawKey = state.sliceDoc(keyNode.from, keyNode.to);
        // Clean up quotes and escape characters
        const key = rawKey.replace(/^"|"$/g, "").replace(/\\"/g, '"');
        
        // Handle keys with special characters by wrapping in brackets if needed
        // For simplicity, we'll mostly use dot notation but can be expanded
        if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key)) {
          segments.unshift(key);
        } else {
          segments.unshift(`['${key}']`);
        }
      }
    } else if (parent.name === "Array") {
      // Calculate the index by counting previous sibling value nodes
      let index = 0;
      let curr = parent.firstChild;
      while (curr && curr.from < child.from) {
        // Skip structural tokens like [, ], and ,
        if (!["[", "]", ","].includes(curr.name)) {
          index++;
        }
        curr = curr.nextSibling;
      }
      segments.unshift(`[${index}]`);
    }

    child = parent;
    parent = parent.parent;
  }

  if (segments.length === 0) return "$";

  // Join segments, handling correctly the dot before a bracket
  let path = "$";
  for (const segment of segments) {
    if (segment.startsWith("[")) {
      path += segment;
    } else {
      path += "." + segment;
    }
  }

  return path;
}
