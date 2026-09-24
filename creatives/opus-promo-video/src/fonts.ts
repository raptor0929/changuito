import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";
import { FONT_FAMILY } from "./theme";

// Inter is bundled locally (public/fonts, SIL OFL) so renders never depend on
// network access. loadFont() blocks rendering until each face is ready.
const WEIGHTS = ["500", "600", "700", "800", "900"] as const;

for (const weight of WEIGHTS) {
  loadFont({
    family: FONT_FAMILY,
    url: staticFile(`fonts/inter-latin-${weight}-normal.woff2`),
    weight,
    style: "normal",
    display: "block",
  });
}
