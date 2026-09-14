# Prototype content and live acceptance mapping

## Purpose and correction

These fixtures describe actions that can actually be performed in the copied reporting design beside the guide. They exercise review-tooling interactions; **they do not accept the deployed Reporting MVP**.

The prototype leaves the approved application mock untouched. Its two stories and nine checkpoints exercise source-verified mock interactions. Every original live criterion remains mapped below for integrated UAT.

The visible guide uses one short setup: work in the reporting example; no sign-in is needed. Detailed provenance and limits belong here, not in every checkpoint.

## Actual executable source

- `prototypes/uat-review/reporting-reference.html`, copied original approved design; inspected SHA-256 `5e0d4386ee29d55e269759dea3c5c326daacdff65117876043e696bc0a7c44e9`.
- `prototypes/uat-review/custom-data-export-example.js`, SHA-256 `92b009491d5758616cd4f047079c2b097f5f3ccc56cd5d74252e4b4c6cbec936`.
- The example supports seven downloadable field names: Accession Number, Collection Date, Lab Section, Test Name, Result Value, Result Unit and Result Status. It has no Spreadsheet/Detailed-list selector, Result ID or instance-specific Viral Load column.
- August 1–31, 2026; Virology; HIV viral load; Validated (finalized) produces five rows: DEMO-0801 `<20`, DEMO-0812 `430`, DEMO-0831 `1200`, DEMO-0831 `1250`, DEMO-0824 blank. The preliminary August row and September row are excluded by those choices.
- Start a new export clears fields and dates; it also resets Result Status to All statuses. The revised guide therefore explicitly requests Validated (finalized), rather than incorrectly expecting five rows from default filters.
- A month-long export generates asynchronously in the mock. The executable path is Create CSV and add to queue → My Report Queue → newest Ready row → Download. There is no Your current report download card.
- Custom Data Export and My Report Queue are working sidebar buttons. Other destinations are decorative. Page changes use in-memory state, with no address/history/reload persistence. The narrow sidebar is hidden, with usable reporting actions near the page heading; there is no working phone menu drawer or Admin route.

Data validation executed the actual example module: the described three-column and four-column requests both return the five expected rows, including the repeated accession values and blank result. Source inspection confirms the requested control labels. This is not yet a browser walkthrough receipt.

## Revised prototype scenarios

Routine remains six checkpoints: start, choose columns, download August results, edit and download again, return to a draft, and narrower builder. Navigation remains three: find the reporting buttons, retain the draft across page visits, and use the reporting buttons with keyboard/narrower layout.

The fourth routine checkpoint now tests adding Test Name to the same report, since the mock cannot demonstrate switching CSV layouts. The third navigation checkpoint uses the working reporting controls instead of decorative Admin and menu-drawer actions. These replacements demonstrate guide reading, recording, scrolling and recovery; they do not replace the unavailable live acceptance checks.

All prototype outcomes are in `expectations`, never solely in optional help. The longer navigation checkpoint has four expectations totaling 58 words and 142 words of optional directions. Source criteria that cannot run here are deferred below, not disguised as optional help or marked passed.

## Original authority and retained criteria

Original live checklist: [Reporting UAT](https://grist.openelis-global.org/uat/reporting.json), audited revision `14333b9e6281374aac57eeb38177a7fca0bba1ff340f380457261af19e3b3481`.

- Routine: RPT-S01, original revision `c01b9f151fc8`.
- Navigation: RPT-S06, original revision `49b4699fa1a3`.
- Original [reporting contract at 5b2df7e](https://github.com/DIGI-UW/openelis-work/blob/5b2df7e34ff5ad1f983f24c0e9e0ba4db5e8697f/designs/reports/custom-data-export.md).

User-approved MVP differences remain authoritative: both layouts, every repeated result preserved, shared reusable definitions, and current stage availability. In the live acceptance instructions, the stale claim that Referrals is unavailable must be corrected: it was selectable on audited application `d48cd790c49294ddb4a36c9333d3acc744ebb3c4`, while Non-Conformance was unavailable. That observation is not full acceptance of Referrals. The prototype does not use its all-type design cards to claim either live availability or feature completion.

**Every original live assertion below still requires integrated UAT on the real application.** An analogous mock action is useful for testing the guide but cannot satisfy that live assertion.

| Source criterion                                                                                                                                                                                                   | Prototype demonstration                                                                                                                                                        | Deferred to integrated live UAT                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| RPT-001: Reports entry; new/saved choices; Choose columns; Spreadsheet default; empty fields; folded groups; type availability                                                                                     | `prototype-routine-start` demonstrates new/saved entry, Sample & Testing, empty/folded catalog.                                                                                | Real Reports entry, Spreadsheet default and current report-type availability; full original start behavior on the deployed app. Correct stale Referrals wording before publishing.               |
| RPT-002: Find/Add Accession Number, Specimen ID and Viral Load; clear search; explicit Add/Added; reorder Specimen ID first; preview and review order; May 5 dates                                                 | `prototype-routine-columns` and `prototype-routine-spreadsheet` demonstrate analogous search/add/order and August review with Collection Date, Accession Number, Result Value. | Exact instance fields Specimen ID/Viral Load, May 5 dates, all original selection/order/preview/review assertions against production code.                                                       |
| RPT-003: Generate CSV; Your current report becomes Ready to download; two REPORTING-MVP-REPEAT rows with Viral Load 450                                                                                            | `prototype-routine-spreadsheet` demonstrates a mock queue download with five August rows and distinct repeated accession results.                                              | Current-report card, actual job generation/download and the two May 5 results with identical display values. A mock repeated accession is not proof of result-identity handling.                 |
| RPT-004: Edit; Detailed list; Accession Number/Result Value/Result ID; same dates; two readings once each with different IDs; restore Spreadsheet selections                                                       | `prototype-routine-detailed` keeps its ID but now demonstrates adding Test Name, retaining filters and downloading again.                                                      | **Entire two-layout journey**, independent layout selections, Result ID distinction and exact two-row live data assertions. The mock has no layout selector or Result IDs.                       |
| RPT-005: Queue/Continue, Back/Forward/reload preserve draft, dates and columns/order                                                                                                                               | `prototype-routine-resume` demonstrates overview/queue/Continue and in-memory fields/period/step retention.                                                                    | Real route state, browser history, reload and all original draft persistence assertions. The mock resets on reload; never ask reviewers to treat that as the target behavior.                    |
| RPT-005: Phone-width column switching/reordering/search/fold restoration and design comparison                                                                                                                     | `prototype-routine-compact` demonstrates the existing responsive original design and guide layout continuity.                                                                  | Actual OE2 responsive behavior and comparison to the approved design. The guide is not a separate phone-optimized UI project.                                                                    |
| RPT-501: Main Menu, Patient & Orders, Reports, Administration with consistent labels/icons; older groups/Alerts reachable and folded; print queue unavailable; canonical report route and exactly one active entry | `prototype-navigation-find` demonstrates only the two real reporting buttons, headings, overview and active item.                                                              | Configured section labels/icons, Other reports/More tools/Alerts, print-queue availability, canonical URL and real exact-active routing. Decorative mock menus cannot establish these behaviors. |
| RPT-502: New draft with Accession Number; sidebar queue; view=queue; exact active item; Back/Forward/reload; overview/Continue returns to Choose columns; review query settings retained                           | `prototype-navigation-resume` demonstrates in-memory draft retention across working overview/queue actions.                                                                    | Real URLs, query settings, history, reload, exact route matching and deployed draft preservation.                                                                                                |
| RPT-503: Keyboard focus/Enter; phone menu drawer closes on selection; main/admin typography/wrapping; pinned menu leaves heading visible; Back to main menu restores configuration                                 | `prototype-navigation-access` demonstrates keyboard reporting buttons, narrower header actions and guide resizing without lost answers.                                        | Live menu drawer, Admin/back transitions, complete navigation styling/configuration and real keyboard behavior. The original decorative routes are not substituted with simulated claims.        |

No live criteria have been removed from the future authoring/remediation scope. The table makes the prototype's deliberately narrower executable content explicit without overloading the reviewer with technical caveats.

## Identity and JSON contract

`prototype-stories.json` retains the story/step shape with explicit prototype identities:

- Deployment metadata uses `observedApplicationRevision` and `observedReviewToolingRevision` for the earlier live audit, `applicationReferenceRevision` for the copied approved design, and `reviewToolingBaseRevision` for the implementation checkout. These are deliberately distinct.
- Top-level `fixtureRevision: "2026-09-14-mock-aligned-2"`.
- `stories[].source.originalInstructionRevision` preserves the live source revision. `source.instructionRevision` is now a `prototype-<content hash>` of this fixture's actual title, purpose, setup and steps; simulated submissions must use that revised identity.

Story and checkpoint IDs remain unchanged. Existing answers to the earlier wording are historical and must not be presented as fresh answers to these instructions. The prototype renderer should use its changed-instructions recovery rather than silently carrying them over.

```text
{
  schemaVersion: 1, prototypeOnly: true, fixtureRevision: string, title: string,
  deployment: { id, label, observedApplicationRevision, observedReviewToolingRevision,
                applicationReferenceRevision, reviewToolingBaseRevision,
                checklistRevision: string, suggestedStoryIds: string[] },
  stories: [{
    id, title, purpose, feature: string, tickets: string[],
    source: { storyKey, instructionRevision, originalInstructionRevision,
              checklistRevision, jira, pr, mock, contract: string },
    startingConditions: string[],
    steps: [{ id, title, action, route: string,
              expectations: string[], help: { title: string, paragraphs: string[] },
              required: true, sourceStepKeys: string[] }]
  }]
}
```

`route` is now `reporting-reference.html`, the actual prototype application pane. Observed application/widget and checklist revisions retained from drafting are **source-baseline metadata**, not claims that the prototype runs that live application or Grist checklist. The reference revision identifies the copied design and the tooling base identifies the implementation checkout. The copied mock's file hashes above identify what is actually displayed.

No live Grist writes, real feedback submissions, laboratory changes or application-mock edits were made in this content correction.
