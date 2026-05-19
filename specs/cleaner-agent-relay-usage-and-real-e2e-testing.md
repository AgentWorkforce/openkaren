# OpenKaren spec: cleaner agent-relay usage, tighter execution flow, and real end-to-end testing

## Goal

Make OpenKaren's agent-relay usage feel native, disciplined, and production-honest.

This spec is intentionally narrower than a broad runtime redesign. It is about tightening the real relay-backed coding-turn path inside OpenKaren itself.

Today, OpenKaren does use agent-relay for real work, but the integration still feels looser and noisier than it should. This spec is about tightening that integration so that:

- the relay path is clearly the primary execution path
- the relay lifecycle is cleaner
- the runtime behavior is easier to reason about
- the user-facing experience is tighter
- validation emphasizes real end-to-end usage, not just mocked local tests

## Problem

OpenKaren already has real agent-relay usage, but several things still feel unfinished.

Current rough edges include:

1. **Execution path feels real but not yet elegant**
   - relay is clearly doing real work
   - but the way Karen frames, invokes, monitors, and summarizes it still feels product-local and somewhat improvised

2. **Too much app-local orchestration leakage**
   - role sequencing, progress shaping, and result packaging still feel hand-wired in Karen
   - the integration should become more intentional and more declarative where possible

3. **Queue / command / relay modes are operationally useful but conceptually uneven**
   - fallback modes are fine, but the primary path should feel unmistakably first-class

4. **Testing currently over-relies on local mock confidence**
   - mocked relay tests are useful
   - but they cannot prove the full product loop:
     - real Telegram inbound
     - real Karen runtime routing
     - real agent-relay session startup
     - real coding-agent execution
     - real result handoff back to the user

5. **User-facing behavior is not yet tightly shaped around relay semantics**
   - acknowledgements, progress, and completion messages should reflect clean relay-driven execution rather than generic local task queuing metaphors

## Product principle

If Karen says she is using agent-relay, the product should prove it in real life, not just in architecture prose or unit tests.

That means:

- real turns should traverse the relay path end to end
- progress and completion should feel grounded in actual relay lifecycle
- validation should include actual real executions against the repo

## Desired behavior

### 1. Relay is the obvious primary execution path

For actionable development work, Karen should behave as if relay is the default serious path, not an optional bolt-on.

That means the relay path should be:

- explicit in configuration
- explicit in runtime logs
- explicit in execution-state transitions
- explicit in user-visible progress messages when relevant

Fallback modes remain allowed, but they should feel clearly secondary:

- `relay` = preferred real execution mode
- `command` = narrower fallback for machines without relay
- `queue` = ingestion/deferred mode, not the ideal main path

### 2. Tighten the relay lifecycle model

Karen should have a cleaner internal execution lifecycle for coding turns.

Target conceptual stages:

1. inbound request accepted
2. turn classified as coding work
3. relay session acquired or reused
4. workflow/roles started
5. progress observed
6. result collected
7. result summarized for the user
8. cleanup/idle handling completed

This lifecycle should be explicit in code and logs.

### 3. Make result reporting relay-native

Karen's replies around coding work should be more tightly coupled to actual relay state.

Examples:

- acknowledgement should indicate real work was dispatched through relay
- progress should reflect actual relay activity when available
- completion should distinguish:
  - completed with result
  - timed out
  - failed during startup
  - failed during execution
  - broker reuse path

Karen should avoid vague task-queue language when the real underlying action is relay execution.

### 4. Reduce duplicated orchestration logic where possible

If relay/workforce already has a cleaner abstraction for something Karen is hand-rolling, prefer the reusable abstraction.

Areas to review:

- role sequencing
- session naming / worker naming
- progress capture / idle detection
- result summarization boundaries
- persona assignment
- broker reuse semantics

This does not mean "blindly move everything into relay." It means Karen should stop carrying app-local orchestration code that really belongs at a lower layer if the lower layer can honestly own it.

### 5. Make relay usage easier to inspect and reason about

A developer looking at Karen should be able to answer:

- when does Karen choose relay vs command vs queue?
- what exact workflow is used?
- how are planner / implementer / reviewer / verifier roles invoked?
- how does Karen know a turn is done?
- what gets sent back to the user?
- what happens when a broker already exists?
- what happens when relay startup fails?

That understanding should come from code structure and docs, not only from scattered logs.

## In-scope source boundary

The intended implementation surface for this spec is:

- `src/agent-runner.ts`
- `src/assistant.ts`
- `src/types.ts`
- relay-related tests such as:
  - `tests/agent-runner.ts`
  - `tests/telegram-e2e.ts`
  - a new focused relay execution evidence test if needed
- targeted docs that explain the real relay path, if updated:
  - `DEVELOPMENT.md`
  - a narrowly scoped relay-path doc under `specs/` or existing docs

`state/recent-activity/context` and other runtime state files are read dependencies only, not edit targets.

## Out of scope

- redesigning the entire OpenKaren product architecture
- replacing agent-relay with a different execution layer
- broad rewrites of unrelated token, dashboard, or direct-answer systems
- fake local demos that do not traverse the real relay-backed coding path
- claiming hosted or cloud proof when only local proof was run

## Desired design

### A. Define a first-class relay execution contract

Create or tighten an internal contract for relay-backed execution.

Example concepts:

- `RelayExecutionRequest`
- `RelayExecutionState`
- `RelayExecutionResult`
- `RelayExecutionSummary`

Whether those exact names are used is not important. The important thing is that Karen's relay behavior should feel modeled, not improvised.

### B. Separate relay invocation from user messaging

Keep these concerns distinct:

1. choosing the execution mode
2. invoking relay
3. tracking relay lifecycle
4. summarizing the result for Karen's user-facing voice

This makes testing cleaner and reduces accidental coupling.

### C. Clarify broker reuse semantics

The current broker reuse behavior is valuable, but it should be intentionally documented and tested.

Karen should explicitly support:

- start fresh broker when needed
- reuse existing broker when appropriate
- explain in logs which path was taken
- recover gracefully when startup collides with an already-running broker

### D. Make workflow choice explicit

If Karen uses an orchestrated workflow, that should be explicit in the runtime contract.

Questions to answer in code/docs:

- what roles exist?
- what order do they run in?
- what persona/model rules apply?
- what outputs are captured from each role?
- when is a turn considered successful?

### E. Keep mocks, but require real-path proof

Mocked tests are still useful for:

- deterministic edge cases
- fast feedback
- failure injection

But they are not enough to claim the relay integration is tight.

This spec requires real-path testing.

## Constraints

- Do not regress Telegram-first development.
- Do not remove fallback modes entirely.
- Do not pretend a mock proves real relay behavior.
- Do not claim full integration quality unless a real relay-backed turn has been run end to end.
- Keep the code honest about what was truly exercised.
- Avoid turning Karen into a wrapper around raw relay logs; user-facing output should still be shaped.

## Implementation expectations

- Refactor the relay path toward a cleaner execution contract.
- Improve naming and structure around relay lifecycle transitions.
- Make success/failure/timeout states easier to inspect.
- Tighten user-facing messages for coding work so they map to real relay execution.
- Add or improve docs describing the primary relay path.
- Preserve existing tests, but add stronger execution-path tests where useful.

## Validation

Add or update tests that prove:

1. actionable work still routes to relay in relay mode
2. queue mode still behaves correctly as a fallback
3. command mode still behaves correctly as a fallback
4. broker reuse path is explicit and covered
5. relay startup failure is surfaced clearly
6. result summarization remains coherent

## Required end-to-end real usage testing

This spec must require real usage testing, not just mocked test harnesses.

For this spec, "real" means:

- the actual OpenKaren runtime is started
- `OPENKAREN_AGENT_MODE=relay` is active
- a real coding turn traverses the relay path
- the relay lifecycle is observed through actual OpenKaren logs and behavior
- the result returned to the user is produced by the relay-backed path, not by a fake local fallback

For this spec, the following do **not** count as sufficient proof on their own:

- a pure unit test of helper functions
- a mock-only relay session object
- a queued inbox file without relay execution
- a synthetic artifact report that does not include the real run command, prompts, logs, and user-visible replies

### Minimum required real tests

Run a real OpenKaren session locally with:

- actual OpenKaren runtime
- actual Telegram inbound path
- actual relay mode enabled
- actual agent-relay-backed execution
- actual coding agent invocation against the real OpenKaren repo

### Required real scenarios

At minimum, test these through the real live path:

1. **real coding request**
   - Example: "Review the current question router and tell me what is still weak."
   - Must traverse Telegram -> Karen -> relay -> worker(s) -> result -> Telegram reply

2. **real implementation request**
   - Example: "Inspect the OpenKaren relay integration and propose one concrete cleanup."
   - Must produce a real relay-backed result, not just local fallback behavior

3. **real broker reuse case**
   - Start or preserve an existing broker, then run another turn and verify the reuse path is genuine

4. **real failure-path observation**
   - Trigger or simulate a meaningful relay startup/execution failure in a way that exercises Karen's real handling path
   - Karen's user-visible response should remain coherent

### Required evidence

The implementation is not done without evidence including:

- exact local startup command for OpenKaren
- exact relay-related env/config used
- exact evidence of `OPENKAREN_AGENT_MODE=relay`
- exact user prompt(s)
- exact user-visible reply/replies
- relevant OpenKaren logs showing relay session start, role execution or worker execution, progress/reuse if applicable, and completion/failure
- short written assessment of whether the experience actually felt tighter

The evidence should be persisted in a single explicit artifact file, for example:

- `.workflow-artifacts/generated/<spec-slug>/relay-e2e-evidence.md`

That artifact must be treated as a required gate, not optional commentary.

- exact command used to start OpenKaren
- relevant env/config for relay mode
- exact Telegram prompts sent
- exact replies Karen returned
- logs showing relay session start / reuse / execution / completion
- short assessment of whether the experience felt tighter and more honest than before

### Quality bar for acceptance

Do not mark this complete unless the real path demonstrates all of the following:

- Karen clearly used relay for the work
- the user-facing acknowledgements and results felt clean
- the lifecycle was understandable from logs/evidence
- the result did not feel like a mocked or simulated happy-path demo

## Ricky generation guardrails

This spec is intended to be used with Ricky, so the implementation request should remain narrow and machine-checkable.

The generated workflow should be considered wrong if it does any of the following:

- treats a runtime state file like `state/recent-activity/context` as the primary edit target
- declares success from artifact prose alone without source/test changes
- claims end-to-end proof without including concrete run commands, prompts, logs, and replies
- broadens into unrelated OpenKaren cleanup outside the relay execution path

The generated acceptance contract should explicitly gate on:

- real source/test target files
- non-empty diff on those files
- focused test pass results
- presence of the relay E2E evidence artifact
- explicit result summary

## Documentation expectations

Update or add docs covering:

- the primary relay execution path
- the meaning of relay vs command vs queue mode
- broker reuse behavior
- how to run a real end-to-end relay-backed local test
- what counts as real proof versus mock confidence

## Deliverable

Implement the relay-path cleanup in this repo, leave the code and docs coherent, and prove the improvement with real end-to-end usage through the actual OpenKaren + Telegram + agent-relay loop.
