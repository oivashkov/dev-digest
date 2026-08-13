# PR Quality Rubric

Apply this baseline to every PR before anything agent-specific: judge the
change against what it claims to do, not just whether it compiles.

- The diff should do ONE thing. If it mixes an unrelated refactor with the
  stated change, call that out as a review-ability problem, not a defect.
- Every new branch, error path, or edge case introduced by the diff needs
  either a test or an explicit, defensible reason it doesn't.
- Prefer the smallest correct change. Flag speculative abstraction (a new
  interface/config knob with exactly one caller) as unnecessary complexity.
- A PR description that doesn't match the diff (claims a fix, diff shows a
  workaround; claims "no behavior change", diff changes behavior) is itself
  a finding — call out the mismatch directively, don't silently trust the
  title.
- Naming and structure should match the surrounding code's existing
  conventions, not introduce a new personal style mid-file.

This is a baseline, not a replacement for a specialized skill's rules —
apply it alongside whatever else this agent is configured to check.
