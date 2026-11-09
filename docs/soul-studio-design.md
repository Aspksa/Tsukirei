# Tsukirei Soul Studio — UI/UX specification

## Product
Local-first control centre for Tsukirei's goals, accepted commitments, evidence-linked priorities, proposed plan changes and reminders. Primary user: owner of the local AI companion. Primary job: understand what matters and approve or dismiss proposed changes without mistaking plans for completed work.

## Information architecture
1. **Priority**: one explained top recommendation, evidence and next safe step.
2. **Progress**: accepted goals and open commitments.
3. **Decisions**: plan-review approvals/rejections and dismissible reminders.
4. **Context**: local-data provenance, privacy and explicit human control.

## Visual direction
Selected **Obsidian & Gold** over a dense developer dashboard and a heavily illustrated fantasy interface. Ink #090A0E, panels #12141A / #191B22, antique gold #D6AE68, ivory #F4F0E9, muted #AAA8AA, green #94C6AC. Editorial Georgia headings + system sans UI, 8px-derived spacing, rounded 12–17px surfaces, subtle gold gradients, restrained fox kanji illustration. No external fonts or image services.

## Responsive behavior
Desktop 246px persistent navigation; tablet 75px icon navigation; mobile sticky compact header, single-column cards. All actions are semantic buttons; keyboard focus ring, status copy, accessible progress bars and reduced-motion support.

## Interaction states
Loading placeholders and 'Обновление…'; empty states for no plans/commitments/proposals; partial API failure stays visible without pretending success; button disabled during mutation; failure modal; confirm/decline actions directly call existing local API and refresh data.

## Data mapping
- GET /api/soul/unified-decision
- GET /api/soul/planned-goals
- GET /api/soul/commitments
- GET /api/soul/plan-reviews
- GET /api/soul/commitment-watch
- PATCH /api/soul/plan-reviews/:id {decision:'accepted'|'dismissed'}
- POST /api/soul/commitment-watch/:id/dismiss {}

No background Cloud.ru requests. UI makes no unsupported consciousness or verified-completion claims. Manual evidence is labelled as user-asserted.

## Follow-up development
Add a guided goal-creation flow, task-linked evidence review, stronger automated accessibility checks, and screenshot-based cross-browser regression testing. This version is an implemented functional interface, not a Figma design-system library.
