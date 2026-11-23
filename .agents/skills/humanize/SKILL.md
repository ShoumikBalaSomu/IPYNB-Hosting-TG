---
name: humanize
description: Removes AI-sounding patterns from any text and makes it read like a sharp human wrote it: reports, docs, marketing, emails, essays. Use when the user asks to humanize, de-slop, or make text sound natural, or before delivering any prose.
---

# Humanize Writing

## Kill list (search and destroy)
- Filler openers: "In today's fast-paced world", "In the realm of", "It's important to note", "Let's dive in", "Moreover/Furthermore" chains, "At the end of the day".
- AI vocabulary: delve, leverage, utilize (use "use"), seamless, robust, game-changer, unlock, empower, elevate, tapestry, testament, beacon, navigate the landscape, pivotal, "not just X, but Y" antithesis spam.
- Structure tics: every section the exact same length; rule-of-three bullet points everywhere; summary paragraphs restating what was just said; emoji headers; bold scattered randomly on adjectives; "In conclusion" on short technical texts.
- Hedging mush: "can potentially help improve" -> "improves" or cut; "it is worth considering" -> consider.

## Rewrite protocol
1. Read aloud test: any sentence you'd never say to a senior engineering colleague gets rewritten.
2. Vary rhythm: mix short punchy sentences with compound technical observations. One-line paragraphs are fine for emphasis.
3. Be specific: replace abstractions with concrete nouns, real numbers, named architectural components. "Saves significant time" -> "cuts sync latency from 1.2s to 80ms".
4. Have an engineering stance: commit to recommendations; cut both-sides padding.
5. Keep the author's voice: match register (technical/architectural) and preserve all facts, specifications, and meaning — humanizing never alters technical truth.
6. Final pass: cut 15-25% of words without losing information. If you cannot cut words without losing meaning, the draft was already tight — stop.

## Rules
- Never fabricate anecdotes, opinions-as-facts, or fake imperfections.
- Technical/cryptographic text: precision outranks colloquialism; humanize only the surrounding prose and framing.
