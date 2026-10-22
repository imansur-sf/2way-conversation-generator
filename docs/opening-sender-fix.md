# Opening sender inference and visible control

TaskCreate/TaskUpdate tools are unavailable; this file records task state.

- [x] Reproduce the Priority Waste sender mismatch and trace its cause.
- [x] Correct follow-up inference, expose the existing sender control, and update guidance and regressions.
- [x] Pass local code-level tests and syntax/diff checks.
- [ ] Run browser verification and the normal staging release gates before deployment.

The exact reported brief inferred `customer`: the opening verb `follows up` was unrecognized, and the later conditional sentence's `customer (Lauren) provides it` was mistaken for an opening action. The correction recognizes follow-ups/check-ins and skips actors within sentences beginning with conditional or temporal introducers. Unknown opening actions still yield an unspecified sender rather than a forced customer requirement.

The existing sender select now appears above the description with a native label, explanatory text, and Follow the prompt / Company opens / Customer opens options. It retains the same request schema and session-storage key; explicit selection overrides inferred narrative sender, while existing supplied-dialogue conflict validation remains. Guidance focuses the visible control and describes its current label. Other generation controls remain in the disclosure.

The exact prompt passes a mocked full backend generation with a company-first RCS survey and one provider attempt, without repair or fallback. All 243 local code-level tests pass, including unknown/conditional inference and both explicit sender choices. Browser regressions cover visibility, order, labeling, persistence, and focus, but have not run: the sandbox initially blocked the loopback server; an approved escalated run reached browser launch and found the dedicated Playwright Chromium executable missing. Managed Chrome configuration was not changed. Syntax and diff checks pass. No live AI requests or deployments were made.

This removes unnecessary retries from the reproduced inference mistake. Existing provider attempts, timeouts, concurrency admission, and transient job storage are unchanged; this is not a load test or a multi-dyno storage redesign.
