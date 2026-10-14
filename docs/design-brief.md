# Food Rescue HQ: redesign brief

Status: draft for review. Written 2026-10-14 from Naya's own skills (`~/.claude/skills/`) and the current code in `public/rescue-chat.js` and `public/styles.css`.
Visual direction: **Pocket HQ** (peach page, plum ink, purple accent, chat thread, pinned countdown bar, pull-up status sheet). Naya chose it for this app, so it wins every color and signature-element conflict below.
Journey source of truth: `../food-rescue-docs/docs/17-user-journey.md`.

## 1. Which skills apply

| Skill | Applies? | Why |
|---|---|---|
| `design-rules` | Yes, main rulebook | No borders, shadows or gradients; one primary CTA; icon-only utility buttons; no dead nav items; sidebar, account drawer and hotkeys on laptop. Its color rules lose to Pocket HQ (see conflicts) |
| `ui-density` | Yes, laptop only | Compact type and height caps (13 to 14px body, 32 to 36px controls, titles at most 20px). On phones, 44px touch targets win |
| `complaints-and-frustrations` (and `00-namoslabs-os/03-standards/complaints-and-frustrations.md`) | Yes | Label demo data honestly, no dead buttons, no duplicate controls, one name per thing, test the tablet width, sheets must fill their content, no extras she did not ask for |
| `feature-user-journey` | Yes | Every screen change has to keep the master journey (doc 17) reachable end to end through the UI, and QA follows that doc |
| `app-shell-audit` | Yes, after the build | The check to run on the laptop shell (one nav trigger, header holds only the title, account drawer, hotkeys) |
| `mobile-app-onboarding` | Partly | Use its "first meaningful action in under 60 seconds" goal and ask for camera and mic access only when needed. Skip the native sign-up and analytics parts |
| `frontend-design` (plugin) | Partly | The direction is already fixed, so follow it exactly. Use its copy rules: an action keeps one name, errors say what to do next, empty screens invite the next action |
| `dashboard-redesign-v2` | Voice FAB only | Its three voice states (idle, recording, processing) suit the mic. The rest is superseded by `design-rules` (it still allows 1px borders) |
| `design-variations` | No | The direction is already chosen. Use it only to explore one component, such as the photo result card |
| `ui-prototype`, `imori-ui-prototype` | No | Terracotta, serif and parchment conflict with Pocket HQ |
| `elevenlabs-voice-agent` | No, for now | Calls go through Twilio (`artifacts/api-server/lib/voice.js`) and speech in the browser uses the Web Speech API. Use this skill only if ElevenLabs is added |

### Conflicts and which rule wins

| Standing rule | Pocket HQ / mobile reality | Winner |
|---|---|---|
| No purple or warm tones; grayscale with one accent (`design-rules`) | Peach page, plum ink, purple accent, chili orange for urgency, mint green for done | **Pocket HQ.** Naya chose it on purpose. Orange and green are status signals only, never large fills |
| Light, collapsible floating sidebar the color of the cards | No sidebar on a phone | **Both.** Bottom tab bar on phones. On laptops, a white (card-colored) collapsible sidebar on the peach page |
| No `position: fixed` slide-over panels | Pull-up status sheet | **Pocket HQ on phones** (standard mobile pattern and a signature of this direction). From 1024px the status is an inline right column, as it is today. The sheet fits its content, closes with Esc, swipe-down or the scrim, and never hides the primary action |
| Radius 13px or less; status shown as a dot plus text, never a pill | Pill status chip in the countdown bar; pill quick replies | **Pocket HQ for those two only.** Every other status (each nonprofit or volunteer row) becomes a 7px dot plus text |
| 32 to 36px controls (`ui-density`) | Thumbs, standing up, in a hurry | **44px minimum on phones**, 56px for the single primary action. Laptop uses the compact sizes |
| One flat tone for all avatars (`design-rules`) | Not part of Pocket HQ. The current code rotates 4 colors, including a brown | **design-rules.** Use one plum-on-peach tone for everyone |
| Two color sources | `styles.css` (`#FBE8D6` / `#2A1838` / `#6E4AE8`) differs from `replit.md` (`#FFE7D3` / `#2B1B3D` / `#6A4BEA`) | **`styles.css`** (what ships). Update `replit.md` to match |

## 2. Rules checklist for this app

**Navigation**
- [ ] Phones (under 768px): fixed bottom tab bar with 4 tabs, each with an icon and a label, 56px tall plus the safe area. No hamburger menu. No `Team` or `Demo` buttons in the top bar.
- [ ] Tablets (768 to 1023px): the same bottom tab bar, and the thread width is capped. Test this width on its own.
- [ ] Laptops (1024px and up): white collapsible sidebar (`PanelLeft` toggle next to the logo, state saved in localStorage) | thread | status column (`PanelRight` toggle, same white fill).
- [ ] One name per thing in the nav, headers and copy. Pick **Nonprofits** (the current code says "Places") and **Volunteers** (the code says "Team").
- [ ] Every tab opens a real screen. No dead clicks.

**Sizing and density**
- [ ] Phones: body text 15 to 16px, inputs 16px (stops iOS zoom), card titles 17 to 18px, page titles 20px at most. Tap targets at least 44px.
- [ ] Laptops: follow `ui-density` (13 to 14px body, 32 to 36px buttons, 26 to 30px icon buttons, 12 to 16px card padding).
- [ ] Shrink the 112px mic illustration in the quick-start card to a 64px button.

**Buttons**
- [ ] **One primary action per screen and per thread step**, plum fill with white text and 56px tall on phones. Everything else is secondary (white or neutral) or a text link.
- [ ] Secondary utility controls are icon-only with an `aria-label`.
- [ ] No borders, shadows or gradients, and no blue.
- [ ] Destructive actions ask for confirmation inline (as `Remove` already does), never in a modal stack.

**Inputs**
- [ ] Default to voice and the camera. Typing is a fallback.
- [ ] Use + and - steppers for counts (tap to adjust "100 tacos") instead of number fields.
- [ ] No borders on fields; fill contrast only, as today.
- [ ] No native `<input type="date">` or native `<select>` (the event form and the place-type picker use them now). Use a custom date picker and a segmented control.

**Status display**
- [ ] Keep the pinned countdown bar: ring, time left, one-line state ("100 tacos · calling 3 nonprofits"), status chip.
- [ ] Status sheet and laptop column: the ring, one sentence, the 3-part bar (rescued, on the way, unclaimed), then a list of nonprofits and volunteers, each with a dot plus text.
- [ ] Colors must match the meaning: green only for done or accepted, orange for urgent or unclaimed, purple for in progress.
- [ ] Never hide a failure. "Twilio could not reach Shelter A. Trying the next one." shows in the thread.

**Empty states**
- [ ] Rescue with no event: "Pick today's event to start" plus the event list, with one tap per event.
- [ ] Events, Nonprofits or Volunteers with no entries: one sentence plus the add button. Nothing else.
- [ ] Any sample or demo data is labeled "Sample data" in the pin bar while it is active.

**Voice-first**
- [ ] The mic is the main control in the composer (a 56px mic, with the send arrow only while text is typed). Use the idle, recording and processing states from `dashboard-redesign-v2`.
- [ ] Speech covers every decision: "yes", "send it", "make it 90 tacos", "who's free?", "what's left?". After each one, show what was heard as a "You" bubble before acting.
- [ ] Ask for mic and camera permission on first use, with one line of explanation first (`mobile-app-onboarding`).
- [ ] If the Web Speech API is missing, hide the mic and keep the chips. Never show a dead mic.

**Hotkeys** (laptop and tablets with keyboards only; phones have no hotkeys)
- [ ] Baseline from `design-rules`: `Cmd/Ctrl+/` sidebar, `Cmd/Ctrl+\` status column, `Cmd/Ctrl+K` palette (searches events, nonprofits and volunteers; quick-create with `event:`, `nonprofit:`, `volunteer:`), `Cmd/Ctrl+1..4` tabs, `Esc` closes overlays, `?` opens the shortcut sheet.
- [ ] App-specific: `M` toggles the mic, `P` opens the photo picker, `Enter` runs the current step's primary action when focus is not in a field.

## 3. Proposed navigation

**Phone (bottom tab bar)**

| Tab | Icon | What it holds |
|---|---|---|
| **Rescue** (default) | lightning or timer | The live thread: countdown bar, steps, composer with mic, pull-up status sheet. Shows the active rescue, or the empty state that picks an event |
| **Events** | calendar | A list of events (today first). Tapping one opens its detail page with a `Start rescue` button. Creating and editing events happens here, not in the thread |
| **Nonprofits** | building | List and detail pages. Add or edit with name, distance, capacity, and what they accept |
| **Volunteers** | people | List and detail pages. Add or edit with name, phone (only the last 4 digits shown), and whether they can be asked |

- Top bar: logo mark, the "Live" dot, and a round **account button** on the right. It opens a sheet with: **Demo tools** (sample event, fast-forward 1 minute, reset, each labeled as demo), **Settings** (only once a real setting exists, such as the default safe window or the organiser's contact), **Keyboard shortcuts** (laptop only). Demo tools leave the top bar for good.
- While a rescue is live, a small orange dot appears on the Rescue tab, so you can leave the thread and come back.

**Laptop (1024px and up)**
```
| Sidebar 200px (white)  | Thread (Rescue) or list/detail (other tabs) | Status 340px (white, collapsible) |
| Logo + PanelLeft       | Countdown bar pinned at top                  | Ring, sentence, 3-part bar         |
| Rescue / Events /      | Thread, then chips, then composer with mic   | Nonprofits with dot + text         |
| Nonprofits / Volunteers|                                              | Volunteers with dot + text         |
| Account row (bottom):  |                                              |                                    |
| Demo tools, Settings,  |                                              |                                    |
| Shortcuts              |                                              |                                    |
```
- Same 4 destinations as the phone, in the same order, with the same names.
- No section groups (only 4 items), so the collapsible-section rule does not apply.
- On other tabs, the status column stays visible while a rescue is live and collapses otherwise.

## 4. Top 10 changes, most impactful first

1. **Add real navigation.** Bottom tab bar (Rescue, Events, Nonprofits, Volunteers) on phones and tablets, sidebar on laptops. Remove the `Team` and `Demo` buttons from the top bar (`rescue-chat.js` TEMPLATE, `.rc-top`).
2. **Start a rescue from an existing event, in one tap.** The Rescue empty state lists today's events. One tap starts the rescue and opens the camera. Move the event form (`eventCard`) and the step-by-step agent Q&A (`detailsBlock`) out of the thread and into Events.
3. **Photo first, no extra taps.** Opening the camera is the primary action. Estimate as soon as a photo is taken (drop the separate `Estimate what is left` button). Show the result as one sentence, "About 100 tacos and 6 sandwiches", with one primary **Yes, alert nonprofits** button and a secondary **Fix** button that opens steppers.
4. **Voice for every decision.** Make the mic the main control in the composer, accept spoken yes, fix and ask commands, echo each command as a "You" bubble, and fall back quietly when speech is not supported.
5. **Rebuild outreach to match the real flow.** Step A: "Calling 3 nonprofits nearby", with one line per nonprofit (dot plus text: calling, said no, **said yes**). "First yes gets it" is stated in the thread. Step B: "Alerting volunteers", with a pickup and drop-off line per volunteer. The agent calls automatically; remove the per-row `Call X now` button.
6. **Remove the manual status buttons from the main view.** `Accept`, `Decline`, `Mark picked up` and `Mark dropped off` (in `outreachCard`) move into Demo tools as "Simulate reply", labeled as demo. The live view only shows status.
7. **Make the countdown bar and status sheet one clear story.** The bar line says what is happening now. The sheet shows the ring, one sentence, the 3-part bar, then Nonprofits and Volunteers lists. Row status uses a dot plus text instead of pills (`.rc-stt`).
8. **Make demo mode honest and out of the way.** Demo tools live in the account sheet (phone) and account drawer (laptop). While sample data is active, the bar shows a "Sample data" label.
9. **Cut typing and options everywhere.** Steppers for counts, at most 3 quick-reply chips per step, custom pickers instead of a native date field and select, and the same action name from button to result ("Alert nonprofits" leads to "Nonprofits alerted").
10. **Sizing, avatars and shortcuts pass.** Card titles 17 to 18px, a 64px mic, 44px touch targets on phones and compact sizes on laptops. One flat avatar tone (drop the 4-color `AVATARS` with brown). Laptop hotkeys plus the `?` sheet. Then run `app-shell-audit`, and walk doc 17 in a real browser at 375px, 768px and 1280px.
