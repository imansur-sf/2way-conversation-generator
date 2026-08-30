# WCAG 2.2 Accessibility Audit Report

Source: W3C Recommendation 12 December 2024  
Target: WCAG 2.2 Level AA  
Scan date: 2026-08-29  
Repo: `/Users/imansur/claude/two-way-sms-email-generator`

Accessibility Score: 78/100  🟡

## Scope and method

Static review of the production HTML and runtime spot checks in Chromium at desktop and 390 px viewport widths. This is an engineering baseline, not a legal conformance assessment or VPAT.

## Summary

| Result | Count | Notes |
| --- | ---: | --- |
| Pass | 7 | Page title/language, native buttons, visible input focus treatment, responsive 390 px reflow, no page horizontal overflow, button target presence, status-message example |
| Fail | 3 | Programmatic form labels, hover-card interaction, incomplete accessible naming of icon-only controls |
| Possible fail | 3 | Fixed header focus obstruction, dynamic status announcements, text scaling/content clipping |
| Cannot determine | 10 | Computed contrast, complete keyboard journey, screen-reader announcement quality, touch target sizing, browser/AT behavior |

## Failures

### 1.3.1 / 3.3.2 — Form labels are not programmatically associated

The builder creates many form fields dynamically with a visually adjacent `<label>` but without a matching `for` attribute or an `aria-labelledby` relationship. Screen-reader users may not receive field names consistently after a re-render. Examples include the identity and AI-setup form markup in `interactive-simulator-builder.html`.

**Fix:** Generate a stable `id` for each input and apply `for`, or add `aria-label` / `aria-labelledby` where the label is dynamic.

### 1.4.13 — Information tooltips are hover/focus-revealed but not hoverable

`.rule-help span` uses `pointer-events:none`; a user cannot move the pointer onto the tooltip to read longer copy. These tooltips also need Escape dismissal and persistent focus behavior.

**Fix:** Use a small accessible popover pattern: a real button with `aria-expanded` and `aria-describedby`, an interactive tooltip/popover with pointer events enabled, Escape-to-close, and placement that avoids clipping.

### 4.1.2 — Some icon-only controls lack durable accessible names

Several simulated phone and WhatsApp controls are rendered with glyph-only content. Some have `aria-label`, but not all; dynamically generated icon controls should always have one even when their visual role is decorative.

**Fix:** Add `aria-label` to every actionable icon; mark purely decorative SVG and glyph content `aria-hidden="true"`.

## Possible failures / manual checks

- **2.4.11 Focus not obscured:** the fixed app bar and sticky preview can cover focusable builder controls during keyboard navigation. Verify in desktop and mobile using Tab/Shift+Tab.
- **4.1.3 Status messages:** AI errors, save success, routing/typing outcomes, and scenario-import results need a single `aria-live="polite"` status region (errors should use `role="alert"`).
- **1.4.4 / 1.4.12 Resize and text spacing:** simulated devices and dense editor cards use fixed heights/overflow rules. Verify 200% zoom and custom text-spacing overrides.

## Verified passes

- Document declares `lang="en"` and a descriptive title.
- Form controls use native elements and inputs show a visible focus treatment.
- At 390 px viewport width, the page reported no horizontal overflow (`scrollWidth === viewport width`).
- Key phone actions, including New Message, have accessible labels.
- Recipient-start instructional content uses `role="status"`.

## Recommended remediation order

1. Associate all labels and name every icon control.
2. Replace hover-only help with an accessible popover component.
3. Add a shared live-region/status pattern and test keyboard focus against fixed layout regions.
4. Add automated axe checks plus 200% zoom and keyboard journeys to the regression suite.

## Limitations

Contrast ratios, interaction with assistive technologies, focus order across all dynamically rendered states, and exported-file behavior require dedicated runtime and manual testing. The report does not evaluate all WCAG 2.2 criteria.
