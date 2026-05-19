# OpenKaren spec: answer quality, advisory behavior, and integration-depth responses

## Goal

Make OpenKaren answer normal user questions like a sharp product builder, not like a diagnostics panel.

This spec is specifically about improving the quality of direct answers for:

- architecture questions
- integration-depth questions
- advice / improvement questions
- comparative / judgment questions
- vague but recoverable product questions

The end state should feel like this:

- Karen gives a real answer first
- Karen uses judgment, not just extraction
- Karen only exposes internal implementation detail when it helps the answer
- Karen sounds like a smart teammate, not a local status report

## Problem

The current routing work improved classification, but the answer composer still fails in important ways.

Observed failure modes:

1. **Facet dump instead of answer**
   - Karen often responds with lists of internal facts instead of actually answering the question.
   - Example: "How fully integrated is agent assistant?" should produce a judgment, not just bullets about runtime shell and state layer.

2. **Bad handling of advice questions**
   - Questions like "How can we improve the integration?" should trigger design/advice behavior.
   - Today they fall through to general fallback or local-context summaries.

3. **Too much internal wiring in the foreground**
   - Internal details are useful as support, but they should not lead the answer unless the user explicitly asks for implementation detail.

4. **Not enough synthesized judgment**
   - Karen should be able to say things like:
     - "this is real but not clean yet"
     - "this is substantial but still app-local"
     - "the integration is deep in runtime ownership, but shallow in reusable abstraction"
   - Those are higher-value than raw system facts.

5. **Fallback prose is too generic**
   - "Here is the best quick read I can give from local context" is acceptable as a last resort, but it should not appear for questions that clearly ask for analysis or advice.

## Product principle

For non-coding questions, Karen should behave like:

- a teammate with opinions
- a product/architecture reviewer
- a developer who has seen the code
- a system that can explain confidence and limitations honestly

She should **not** behave like:

- a structured logging surface
- an integration registry dump
- a template engine that swaps in bullets

## Desired behavior

### 1. Answer-first composition

For direct answers, Karen should use this order:

1. **judgment / conclusion first**
2. **short explanation second**
3. **supporting detail third, only if useful**
4. **optional bullets last, only when they improve readability**

Example target shape:

> Agent-assistant is deeply integrated, but not elegantly enough yet.
> It owns Karen's runtime shell, sessions, traits, and surfaces, so this is real integration, not just naming. But some of Karen's higher-level behavior still lives in app-local logic instead of reusable SDK primitives.
> The practical result is: substantial integration, uneven abstraction.

Not this:

> Here is the honest read on that integration.
> - runtime shell: ...
> - execution path: ...
> - state layer: ...

### 2. Add an explicit advisory / improvement intent

Karen needs a first-class semantic path for questions like:

- how can we improve the integration?
- what should we change here?
- how do we make this cleaner?
- what is the next step to tighten this up?
- what would make this feel more real / more native / less hacked together?

This should not fall into `general`.

Introduce a semantic intent such as:

- `improvement_advice`

or a similarly named intent that clearly means:

- the user is asking for recommendations, design improvements, cleanup strategy, or next steps

### 3. Add judgment-oriented answer modes

For direct answers, Karen should be able to produce one of a few modes depending on the question:

- **explain**: what is this / how does it work
- **assess**: how good / how real / how integrated / how mature
- **advise**: how should we improve it
- **compare**: what is stronger vs weaker / what is native vs app-local
- **clarify**: ask for shape when genuinely ambiguous

This does not necessarily require exposing these exact labels to the router, but the implementation should support them cleanly.

### 4. Integration-depth answers should synthesize, not dump

For questions about integration depth, Karen should produce:

- a rating or qualitative judgment
- a short explanation of why
- the main boundary where the integration still feels incomplete
- optionally, 2-4 concrete details supporting that judgment

Required answer dimensions for integration-depth questions:

- what parts are genuinely owned by the dependency
- what parts are still app-local
- whether the integration is operationally real or mostly cosmetic
- whether the abstraction boundary feels clean

### 5. Improvement answers should be concrete and ranked

For advice questions, Karen should return:

- a short diagnosis
- 2-5 concrete improvements
- a sense of priority or ordering
- why those changes matter

Target style:

> The biggest gap is that the integration is real in runtime ownership but not yet clean in behavioral abstraction.
> I would tighten it in this order:
> 1. move direct-answer behavior into reusable assistant primitives
> 2. make non-coding question handling first-class instead of fallback-shaped
> 3. unify state/recent-activity/context summaries behind a cleaner SDK surface
> 4. make cross-surface user/session behavior feel native by default
>
> That would turn the integration from "works" into "belongs here."

### 6. General fallback should become a true last resort

Karen may still use a general local-context answer, but only when:

- the message is genuinely broad
- the user did not ask for analysis, improvement, or comparison
- there is not enough signal for any better direct-answer path

Even then, it should sound better than a local debug summary.

## Desired design

### A. Expand the semantic intent layer

The current intent set is not rich enough for advice and assessment quality.

Add or refactor toward a semantic set that can support the real behavior, such as:

- `architecture`
- `integration_status`
- `integration_assessment`
- `improvement_advice`
- `runtime_status`
- `recent_activity`
- `capabilities`
- `skills_tools`
- `model_setup`
- `general`

If you want to keep the public router contract smaller, then internal composition logic may derive `assessment` / `advice` submodes from the question plus routed intent.

### B. Separate routing from answer composition

Keep these as distinct steps:

1. route the question
2. build a context packet
3. derive answer mode
4. compose a natural answer
5. optionally attach structured support details

Do not let answer quality depend on raw fallback templates.

### C. Introduce opinionated answer composers

Instead of one generic direct-answer composer, create narrower answer composers for:

- architecture explanation
- integration assessment
- improvement advice
- runtime status
- recent activity
- capabilities / tools

Each should have a different voice shape and content priority.

### D. Confidence and honesty

Karen should be able to say:

- what she knows from code/runtime truth
- what she is inferring
- what is still not proven

But this should be natural, not bureaucratic.

Example:

> This looks deeply integrated in runtime ownership, but still somewhat app-local in behavior. I am confident about the first part from the code shape; the second part is a judgment based on where the answer logic still lives.

## Constraints

- Do not break `/do` or slash-command determinism.
- Do not route advice/explanation questions into coding work unless the user clearly asks for implementation.
- Keep the LLM router optional.
- Preserve deterministic fallback, but improve its composition quality.
- Do not regress Telegram-first behavior.
- Keep answers grounded in local truth, not invented system claims.
- Do not overfit to specific wording like "how fully integrated".

## Implementation expectations

- Refactor the direct-answer layer so prose quality improves materially, not cosmetically.
- Reduce template-heavy lead-ins like:
  - "Here is the honest read..."
  - "Here is the best quick read I can give from local context"
  when a stronger answer is possible.
- Add support for improvement/advice questions as a first-class path.
- Make answer composers testable without booting the full Telegram runtime.
- Prefer reusable helpers for:
  - judgment line
  - explanation body
  - concrete recommendations
  - supporting details

## Validation

Add or update tests that prove:

1. **integration-depth question** returns a judgment-first answer, not just a detail dump
2. **improvement question** returns concrete advice, not the general fallback summary
3. **architecture question** still returns a grounded direct answer
4. **vague broad chat** can still use fallback, but with better wording and without hijacking greeting/small-talk behavior
5. **coding-task questions** still route to coding
6. **router-disabled mode** still gives strong deterministic answers for important product questions

## End-to-end testing requirements

This spec should not be considered done from unit tests alone.

Required real usage testing:

1. Run Karen locally through the actual Telegram path.
2. Ask a real sequence of questions such as:
   - "How fully integrated is agent assistant?"
   - "How real is the relay integration?"
   - "How can we improve the integration?"
   - "What exactly feels too app-local right now?"
   - "What should we do next to tighten this up?"
3. Capture the actual replies.
4. Verify the replies are:
   - conversational
   - judgment-first
   - grounded in reality
   - materially more useful than the prior template-heavy replies
5. If the live replies still sound like internal status output, the work is not done.

Required evidence:

- command(s) used to run OpenKaren locally
- exact live prompts used in Telegram
- exact actual replies received
- short assessment of whether the behavior genuinely improved

## Deliverable

Implement the direct-answer quality upgrade in this repo, keep the repo coherent, and prove it with real end-to-end usage, not just isolated local tests.
