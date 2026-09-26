/**
 * App chrome copy that a deploy can change under a running suite.
 *
 * Same problem `pollar-copy.ts` has and the same answer: these runs start the
 * moment main receives a merge, so a run can land on the build before the one
 * it was triggered by. A string pinned to the commit under test then fails
 * against the build that is actually serving — which is exactly what happened
 * when the masthead button became "Cambiar a modo real" (PR #58): the merge's
 * own run passed against the old build, and the *next* commit's run failed
 * against the new one, blaming a change that had nothing to do with it.
 *
 * So the matcher spans the window. Once production has served the new copy
 * for a while, the old half can go.
 */
export const APP = {
  /**
   * The preview masthead's door into production, `PREVIEW_MASTHEAD.action` in
   * apps/web/lib/mode-copy.ts. It opens the Pollar login modal under either
   * label; only the wording changed.
   */
  loginAction: /^(Empezá a comprar|Cambiar a modo real)$/,
} as const;
