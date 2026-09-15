# Review panel UX investigation

> Historical September 11 investigation. Its floating/expanded-panel design has
> been superseded by the accepted [UAT tooling remediation plan](uat-tooling-remediation-plan.md)
> and the current [widget experience](../widget/README.md#what-the-reviewer-gets).
> The measurements and test counts below describe that earlier candidate only.

Screenshot review on testing.openelis-global.org, 11 September 2026. This is a
heuristic assessment and browser walkthrough, not a user study. The before
captures use the deployed widget. The after captures use the candidate widget
in the same browser against the same application and published story catalog.
No application records or Grist submissions were changed for these captures.

## Findings and changes

| Observed problem                                                                                                                                | Change                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The default panel was narrow and tall, wrapping instructions unnecessarily.                                                                     | Prefer 720 × 520 px; narrow automatically when application side panels occupy the available space.                                                                                                         |
| Expansion still left most of the screen unused on desktop. On mobile, it did not enlarge the panel and answer controls overflowed horizontally. | Expanded mode fills the viewport with a 16 px desktop or 8 px mobile inset. Two-column answers apply only at desktop widths.                                                                               |
| The selected story appeared in three headings, alongside five header icons and technical identifiers.                                           | Keep one story selector, a short progress header, and explicit Expand/Back to page controls plus a visible separate-window icon. Move secondary panel commands into the existing More review actions menu. |
| Browsing 37 stories required scanning a long list that squeezed the checklist out of view.                                                      | Add title, story-key, and source-review search in an overlay with its own scrolling list and an explicit empty state.                                                                                      |
| Identity fields and repeated card borders competed with the task.                                                                               | Place reviewer identity beside submission; use quieter separators and retain the active-step emphasis.                                                                                                     |
| Opening the compact panel could leave a clipped fragment of the introduction above the task.                                                    | Align the current task on open. Selecting a different story still reveals its overview.                                                                                                                    |

## Research informing the implementation

- [Nielsen Norman Group: Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/)
  supports keeping frequent actions prominent and placing less frequent commands
  in a discoverable secondary surface. Refresh and Move remain available alongside the existing report and filter
  commands. The separate-window icon stays in the header so that option is
  immediately discoverable.
- [Carbon: Modal usage](https://carbondesignsystem.com/components/modal/usage/)
  informs the header/body/footer hierarchy, content-appropriate sizing, and
  independently scrolling body. The panel preserves readable instructions and
  visible submission controls without horizontal scrolling.
- [Carbon: Menu usage](https://carbondesignsystem.com/components/menu/usage/)
  informs the grouped secondary commands rather than adding another toolbar.
- [W3C APG: Dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
  distinguishes a modal dialog from an overlay that leaves the application
  available. Review remains a nonmodal companion: expansion does not claim
  modal semantics or trap focus. Escape closes an open menu first, then returns
  expanded Review to its compact size, with focus restored to its control.

## Screenshot comparison

Measured browser rectangles; all dimensions are CSS pixels.

| Viewport and mode            | Before    | After      |
| ---------------------------- | --------- | ---------- |
| Desktop 1440 × 900, default  | 560 × 620 | 720 × 520  |
| Desktop 1440 × 900, expanded | 840 × 760 | 1408 × 868 |
| Mobile 390 × 844, default    | 390 × 591 | 390 × 520  |
| Mobile 390 × 844, expanded   | 390 × 591 | 374 × 828  |

## Validation and limits

`npm run check` passes: 200 Node tests and 102 browser tests. The browser suite
checks viewport sizing, mobile overflow, keyboard selection and Escape behavior,
secondary-command access, preserved names/notes/answers, pop-out behavior,
application obstacles, refresh, story scoping, and submissions against local
fixtures. Both screenshot walkthroughs reported no uncaught browser errors.

This change does not alter catalog scope, stable answer keys, deployment identity,
or Grist data. Follow-up usability work should observe reviewers choosing stories
and completing a review; these screenshots establish layout improvements, not a
measured improvement in task completion time.
