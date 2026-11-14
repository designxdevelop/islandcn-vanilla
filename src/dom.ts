/**
 * Appends children in order. `Element.append` is not used here so the source also typechecks next
 * to Cloudflare's Workers types, whose HTMLRewriter `Element.append(content)` merges over the DOM's
 * and rejects nodes.
 */
export const appendAll = (parent: Node, ...children: Node[]) => {
  for (const child of children) parent.appendChild(child);
};
