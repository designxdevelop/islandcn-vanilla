// Ported from islandcn (https://github.com/opencoredev/islandcn), MIT, copyright (c) 2026 Leo.
import { addStyle } from "./runtime";

/**
 * Puts a block of CSS in the document head once, however many pieces of content ask for it.
 *
 * Content primitives keep their keyframes and pseudo-class rules here (hover, press, focus),
 * which inline styles can't express. Class names start with `icn-`.
 */
export const IslandStyle = ({ id, css }: { id: string; css: string }): null => {
  addStyle(id, css);
  return null;
};
