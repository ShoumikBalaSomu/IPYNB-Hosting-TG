---
name: ai-check
description: Audits text, documentation, and user-facing copy for AI writing markers, syntactic clichés, artificial symmetry, and semantic fluff. Use before finalizing documentation, UI strings, or reports.
---

# AI Writing Inspection Protocol (`ai-check`)

## 1. Marker Detection Checklist

Inspect the target text against these known automated generation patterns:

### 1.1 Structural Symmetry Traps
- **Triad Obsession**: Exactly 3 bullet points under every subhead. Real systems have 1, 2, 4, or 7 constraints. Break the artificial symmetry.
- **Uniform Paragraph Length**: Every paragraph spanning exactly 3-4 sentences. Introduce natural variance: one-line punchy directives alongside detailed technical paragraphs.
- **Echo Conclusions**: A final paragraph starting with "In conclusion", "In summary", or "Overall", which merely repeats the previous sections without new synthesis. Delete it.

### 1.2 Vocabulary and Phrasing Artifacts
- **Hedge Stacking**: "It may arguably be said that", "could potentially offer benefits", "serves as a testament to". Replace with direct active verbs.
- **Grandiosity**: Words like "groundbreaking", "revolutionary", "pivotal", "holistic", "seamlessly integrated". Name the concrete metric or design choice instead.
- **Formulaic Transitions**: Overuse of "Furthermore", "Moreover", "Additionally", "On the other hand", "Delving deeper into".

### 1.3 Rhetorical Clichés
- **False Dichotomy**: "It is not just about X, it is about Y". State Y directly.
- **Rhetorical Questions**: "Why does this matter?", "How do we achieve this?". State the problem and answer without theatrical setup.

## 2. Automated Inspection Steps
1. **Grep Scan**: Search for high-frequency AI tokens (`delve`, `leverage`, `seamless`, `tapestry`, `testament`, `game-changer`, `unlock`).
2. **Syllable & Cadence Check**: Read aloud. If the tone sounds like a corporate marketing brochure rather than a Staff Infrastructure Engineer explaining architecture to a peer, revise.
3. **Information Density Ratio**: Calculate $\frac{\text{Unique Technical Facts}}{\text{Total Word Count}}$. If ratio is below 0.3, strip filler adjectives and restate facts cleanly.
4. **Actionable Deliverable**: Output a severity-ranked list of AI markers found with suggested replacements, or confirm the text is clean and high-craft.
