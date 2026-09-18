import { ApiError, verifyManual } from './api.js'
import { readProjectConfig, type ProjectConfig } from './project-config.js'
import { changedPathsSince, headSha, originSlug, runGit, type GitRunner } from './git.js'
import {
  ManualVerifyRequestSchema,
  ManualVerifyResponseSchema,
  type ManualVerifyRequest,
  type ManualVerifyResponse,
  type VerifyChapterResult,
} from './manual-verify-schema.js'

export const FAIL_ON_VALUES = ['none', 'drift', 'any'] as const

export type FailOn = (typeof FAIL_ON_VALUES)[number]

/**
 * `drift`, not the Action's `none`: the Action's first run must not break a
 * build nobody asked it to gate, but a terminal run is a person asking, and a
 * person asking gets the answer as an exit code.
 */
export const DEFAULT_FAIL_ON: FailOn = 'drift'

/**
 * Exit 1 is drift found; exit 2 is "could not vouch". Never the same code.
 *
 * Exit 2 reaches a run at `--fail-on any`, and — since issue 126 — at the
 * default `drift` too when the run vouched for nothing at all. `EXIT_DRIFT`
 * wins when both hold: drift is the finding with somewhere to go.
 */
export const EXIT_DRIFT = 1
export const EXIT_UNVERIFIABLE = 2

export function isFailOn(value: string): value is FailOn {
  return (FAIL_ON_VALUES as readonly string[]).includes(value)
}

export interface ManualVerifyOptions {
  project?: string
  /** `owner/repo`; derived from `git remote get-url origin` when unset. */
  repository?: string
  /** Full commit sha; `git rev-parse HEAD` when unset. */
  ref?: string
  /** Scope the check to files changed since this base; a full sweep when unset. */
  changedFrom?: string
  failOn?: FailOn
  /** Print the validated report and nothing else on stdout. */
  json?: boolean
}

export interface Verdict {
  /** Claims whose cited value moved. The only drift signal. */
  drift: number
  /** Claims read and stood behind. Negative means the report contradicts itself. */
  vouched: number
  /** Every claim this run evaluated was unreadable. The floor, and not `vouched === 0`. */
  readNothing: boolean
  /** Why this run cannot be called clean. Never folded into `drift`. */
  reasons: string[]
  exitCode: number
  /** The failure line, or null when the check passes under this `failOn`. */
  failure: string | null
}

/**
 * Outcome of a run. `verified` carries the report and the verdict; every other
 * kind is a typed refusal the adapter prints to stderr with exit 1. Each git
 * derivation failure is its own kind so the message can name the flag that
 * bypasses it. A 401 is not caught here: it propagates as an ApiError so the
 * adapter's login nudge handles it the same way as every other command.
 */
export type ManualVerifyResult =
  | { kind: 'verified'; report: ManualVerifyResponse; verdict: Verdict; exitCode: number }
  | { kind: 'missing-fields'; message: string }
  | { kind: 'no-remote'; message: string }
  | { kind: 'non-github-remote'; message: string }
  | { kind: 'no-head'; message: string }
  | { kind: 'bad-base'; message: string }
  | { kind: 'invalid-request'; message: string }
  | { kind: 'not-found'; message: string }
  | { kind: 'invalid-payload'; message: string }

export interface ManualVerifyDeps {
  api: { verifyManual(body: ManualVerifyRequest): Promise<unknown> }
  readProjectConfig(): ProjectConfig | null
  git: GitRunner
  /** The human report, or under `--json` the payload and nothing else. */
  stdout(text: string): void
  /** Notes about the run (full-sweep fallback, "verified nothing"), never the payload. */
  stderr(text: string): void
}

/**
 * `deploylog manual verify`: send one verify request and turn the report into
 * lines and an exit code. No checking happens here; the verdict on every claim
 * comes from the route. What this module owns is the three derivations
 * (repository, ref, changed files), the two guards that stop a false clean
 * (an empty diff is not a scope; a slug no claim cites verified nothing), and
 * the mapping from counts to exit status.
 */
export async function runManualVerify(
  opts: ManualVerifyOptions,
  deps: ManualVerifyDeps = defaultManualVerifyDeps,
): Promise<ManualVerifyResult> {
  const failOn = opts.failOn ?? DEFAULT_FAIL_ON

  const project = opts.project ?? deps.readProjectConfig()?.project
  if (!project) {
    return {
      kind: 'missing-fields',
      message:
        'No project specified. Use --project <slug> or create a .deploylog.yml with:\n  project: my-app',
    }
  }

  let repository = opts.repository
  if (!repository) {
    const origin = originSlug(deps.git)
    if (origin.kind === 'no-remote') {
      return {
        kind: 'no-remote',
        message:
          'No `origin` remote to derive the repository from. ' +
          'Pass --repository <owner/repo> (a repository the manual\'s commit map covers).',
      }
    }
    if (origin.kind === 'not-github') {
      return {
        kind: 'non-github-remote',
        message:
          `The \`origin\` remote (${origin.url}) is not a github.com repository, so no owner/repo ` +
          'can be derived from it. Pass --repository <owner/repo> ' +
          '(a repository the manual\'s commit map covers).',
      }
    }
    repository = origin.slug
  }

  let ref = opts.ref
  if (!ref) {
    const sha = headSha(deps.git)
    if (!sha) {
      return {
        kind: 'no-head',
        message:
          'No HEAD commit to verify at (`git rev-parse HEAD` failed; an empty repository, or not ' +
          'a git repository). Commit first, or pass --ref <full-sha>.',
      }
    }
    ref = sha
  }

  let changedFiles: string[] | null = null
  if (opts.changedFrom !== undefined) {
    const paths = changedPathsSince(opts.changedFrom, deps.git)
    if (paths === null) {
      return {
        kind: 'bad-base',
        message:
          `Could not diff against '${opts.changedFrom}' ` +
          `(\`git diff --name-only ${opts.changedFrom}...HEAD\` failed). ` +
          'Pass --changed-from a ref that exists here and shares history with HEAD, ' +
          'or omit it to verify the whole manual.',
      }
    }
    // An empty diff is not a scope. The route passes the array through and the
    // service skips every claim outside it, so `[]` verifies nothing and reports
    // a clean sweep byte-identical to a real one. Zero is not a scope.
    if (paths.length === 0) {
      deps.stderr(
        `No files changed since '${opts.changedFrom}', so there is nothing to scope the check to. ` +
          'Verifying the whole manual instead.\n',
      )
    } else {
      changedFiles = paths
    }
  }

  const body = { project, repository, ref, changedFiles }
  const request = ManualVerifyRequestSchema.safeParse(body)
  if (!request.success) {
    const first = request.error.issues[0]
    const path = first && first.path.length > 0 ? first.path.join('.') : '(root)'
    return {
      kind: 'invalid-request',
      message:
        `The verify request this CLI derived does not match the schema it mirrors ` +
        `(first failing path: ${path}: ${first?.message ?? 'invalid'}). Nothing was sent.\n` +
        flagFor(path),
    }
  }

  let raw: unknown
  try {
    raw = await deps.api.verifyManual(request.data)
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return {
        kind: 'not-found',
        message: `No manual for project '${project}' under this key (${err.message}).`,
      }
    }
    throw err
  }

  const parsed = ManualVerifyResponseSchema.safeParse(raw)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    const path = first && first.path.length > 0 ? first.path.join('.') : '(root)'
    return {
      kind: 'invalid-payload',
      message:
        `The verify report for '${project}' does not match the schema this CLI mirrors ` +
        `(first failing path: ${path}: ${first?.message ?? 'invalid'}). No verdict was decided.\n` +
        'Update the CLI, or report this if you are already on the latest version.',
    }
  }

  const report = parsed.data
  const verdict = decideVerdict(report, failOn)

  // A fork or a mirror is a GitHub remote with the wrong slug. The route re-pins
  // only the slug it is sent; claims citing another repository keep their stored
  // pin and go untriggered, so under `drift` a run can report green having
  // verified nothing at this ref. Said loudly, whatever `--fail-on` is.
  if (verifiedNothing(report)) {
    deps.stderr(
      `verified nothing at ${ref}: no claim cites ${repository}. ` +
        'Pass --repository <owner/repo> naming a repository the manual\'s commit map covers.\n',
    )
  }

  if (opts.json) {
    deps.stdout(`${JSON.stringify(report, null, 2)}\n`)
  } else {
    deps.stdout(renderReport(report, verdict, failOn))
  }

  return { kind: 'verified', report, verdict, exitCode: verdict.exitCode }
}

/**
 * No claim was evaluated at this ref: either the service evaluated nothing, or
 * every claim in the manual sits in a repository this run does not trigger.
 * Each claim is either evaluated or skipped, so their sum is the claim total.
 */
function verifiedNothing(report: ManualVerifyResponse): boolean {
  const total = report.evaluatedCount + report.skippedCount
  return (
    report.evaluatedCount === 0 ||
    (report.untriggeredCount > 0 && report.untriggeredCount >= total)
  )
}

function flagFor(path: string): string {
  if (path === 'ref') return 'Pass --ref <full-40-character-sha>.'
  if (path === 'repository') return 'Pass --repository <owner/repo>.'
  if (path.startsWith('changedFiles')) return 'Omit --changed-from to verify the whole manual.'
  return 'Pass --project <slug>.'
}

/**
 * Claims this run read and stood behind.
 *
 * Derived, because the wire has no count for it: `confirmedCount` is *drift*, so
 * "read it and it holds" and "could not read it at all" both report
 * `confirmed 0`, and the report's other counts are all about what went wrong.
 * Every evaluated claim yields exactly one of ok, drift or error
 * (`manual-verification.ts`'s `verifyChapter`), so the remainder is exact.
 *
 * Not added as a field on the response instead: both copies of
 * `ManualVerifyResponseSchema` are `.strict()`, and this file's own test asserts
 * that an extra top-level key is refused. A server that started sending one
 * would break every installed CLI and the Action on parse, which is a worse
 * failure than the one being fixed.
 */
function vouchedFor(report: ManualVerifyResponse): number {
  return report.evaluatedCount - report.confirmedCount - report.errorCount
}

/**
 * A run that read claims and learned nothing from any of them: every claim it
 * evaluated was unreadable.
 *
 * Deliberately NOT `vouched <= 0`, which was the first spelling and was wrong.
 * That is also true of a run where everything it read DRIFTED — a fully
 * informative run — and it made an ordinary scoped pull request with one drifted
 * claim print "could not vouch for the rest of the manual" over a report whose
 * own `unverifiable` flag was false. "Found drift" and "could not check" must
 * never collapse into each other; a predicate true of both causes is that
 * collapse, wearing the floor's name.
 *
 * `evaluatedCount > 0` keeps this a floor rather than a nuisance: a scoped run
 * whose diff touched no cited file evaluates nothing, on most pull requests, and
 * there is nothing to vouch for. The `verifiedNothing` stderr line covers that.
 */
function readNothing(report: ManualVerifyResponse): boolean {
  return report.evaluatedCount > 0 && report.errorCount >= report.evaluatedCount
}

/**
 * The report contradicts itself: more claims drifted or errored than were
 * evaluated. Defence in depth, not a live guard — the service cannot emit it,
 * since every drifted and unreadable claim is one evaluated claim — but the
 * response schema does not cross-validate the counts, so such a report parses.
 * Reading it as "nothing held" would be a guess; reading it as clean would be
 * this ticket's own defect.
 */
function countsContradict(report: ManualVerifyResponse): boolean {
  return vouchedFor(report) < 0
}

/**
 * Counts to exit status. `drift` is `confirmedCount` and nothing else; every
 * other non-zero count is a reason the run cannot be called clean, and the two
 * never collapse into each other, because collapsing them is how a broken
 * checker reads as a clean one (the Action's `verdict.ts`, same rule).
 *
 * Plus a floor under `--fail-on`, added by issue 126: a run that vouched for
 * nothing is not a pass. Measured on production before the fix — 459 claims
 * evaluated, none readable, exit 0 on the default `drift` for a month, because
 * the default covers drift and "I could not read any of it" produces no drift.
 * Silence from a probe is not compliance.
 *
 * The floor is deliberately NOT `anything went wrong`: one unreadable claim
 * among readable ones still exits 0 under `drift`, because that is what
 * `--fail-on any` is for, and widening the floor would swallow the distinction.
 */
export function decideVerdict(report: ManualVerifyResponse, failOn: FailOn): Verdict {
  const drift = report.confirmedCount
  const vouched = vouchedFor(report)
  const reasons = notCleanReasons(report)

  const failsOnDrift = drift > 0 && (failOn === 'drift' || failOn === 'any')
  // `unverifiable || errorCount > 0`, the Action's `drift > 0 || notCleanReasons`
  // in the route's own vocabulary: the service sets `unverifiable` from every
  // not-clean count, and errorCount is named beside it so a report whose flag
  // and counts disagree still fails on the count.
  const failsOnUnverifiable = (report.unverifiable || report.errorCount > 0) && failOn === 'any'
  // Exempt only at `none`, which is a caller saying "report, do not fail". The
  // floor closes a gap in a default; it does not overrule an explicit opt-out.
  // (It cannot reach the GitHub Action either way: that is a separate package
  // which does not import this one, so the green `manual` badge on a pull
  // request — the Action running `fail-on: none` — is untouched by this change.
  // Issue 126 item 4 is where that lives.) The reason line still prints under
  // `none`, so a run says what it declined to fail on.
  const failsOnNothingVouched =
    (readNothing(report) || countsContradict(report)) && failOn !== 'none'

  const exitCode = failsOnDrift
    ? EXIT_DRIFT
    : failsOnUnverifiable || failsOnNothingVouched
      ? EXIT_UNVERIFIABLE
      : 0
  const failure =
    exitCode === 0
      ? null
      : failsOnNothingVouched && !failsOnDrift
        ? vouchedNothingLine(report)
        : failureLine(drift, reasons)
  return { drift, vouched, readNothing: readNothing(report), reasons, exitCode, failure }
}

function notCleanReasons(report: ManualVerifyResponse): string[] {
  const reasons: string[] = []
  if (countsContradict(report)) {
    reasons.push(
      `the report's own counts do not add up (evaluated ${report.evaluatedCount}, ` +
        `drifted ${report.confirmedCount}, unreadable ${report.errorCount}), ` +
        'so nothing in it can be trusted.',
    )
  }
  // The floor's own line REPLACES the plain error count rather than sitting
  // above it: "not one of them could be read" already says "N could not be
  // read", and two bullets for one fact is how a reader learns to skim.
  if (readNothing(report)) {
    reasons.push(
      `not one of the ${plural(report.evaluatedCount, 'claim')} it evaluated could be read, ` +
        'so this run vouched for nothing.',
    )
  } else if (report.errorCount > 0) {
    reasons.push(`${plural(report.errorCount, 'claim')} could not be read at all.`)
  }
  if (report.unanchoredCount > 0) {
    reasons.push(
      `${plural(report.unanchoredCount, 'chapter')} declare no claims, so nothing about them can ever drift.`,
    )
  }
  if (report.lowCoverageChapters.length > 0) {
    reasons.push(
      `${plural(report.lowCoverageChapters.length, 'chapter')} carry claims over too little of their own prose (${report.lowCoverageChapters.join(', ')}).`,
    )
  }
  if (report.untriggeredCount > 0) {
    reasons.push(
      `${plural(report.untriggeredCount, 'claim')} sit in a repository no push and no sweep visits, so future drift in them is invisible.`,
    )
  }
  // Last, and only when nothing above fired. `unverifiable` is the service's
  // disjunction over the four counts, so normally one of them has already said
  // why. But the field's own contract calls it "deliberately coarse" and it has
  // been widened once already, so a flag set for a reason with no count behind
  // it must still reach the reader instead of being silently dropped.
  if (report.unverifiable && reasons.length === 0) {
    reasons.push('the service reports this run as unverifiable, without saying which count.')
  }
  return reasons
}

function failureLine(drift: number, reasons: string[]): string {
  if (drift > 0 && reasons.length > 0) {
    return `Manual check failed: ${plural(drift, 'claim')} drifted, and this run could not vouch for the rest of the manual.`
  }
  if (drift > 0) {
    return `Manual check failed: ${plural(drift, 'claim')} no longer match the code they cite.`
  }
  return 'Manual check failed: no drift was found, but this run could not vouch for the manual.'
}

/**
 * The floor's own headline. Item 3 asks for a message that says "vouched for
 * nothing" rather than "green", and the reason bullet alone does not do that:
 * a CI log reader sees the last line, and the generic
 * "could not vouch for the manual" is also what plain `--fail-on any` prints.
 */
function vouchedNothingLine(report: ManualVerifyResponse): string {
  if (countsContradict(report)) {
    return 'Manual check failed: the report contradicts itself, so nothing in it can be trusted.'
  }
  return (
    `Manual check failed: this run vouched for none of the ${plural(report.evaluatedCount, 'claim')} ` +
    'it read, because not one of them could be read at all.'
  )
}

/**
 * One line per chapter with its verdict counts, then one per confirmed finding
 * and one per error finding, then the summary counts, the low-coverage chapters
 * by name, and `unverifiable` in words.
 */
export function renderReport(
  report: ManualVerifyResponse,
  verdict: Verdict,
  failOn: FailOn,
): string {
  const lines: string[] = []

  for (const chapter of report.chapters) {
    lines.push(chapterLine(chapter))
    for (const finding of chapter.confirmed) {
      const where = finding.line === null ? finding.source : `${finding.source}:${finding.line}`
      lines.push(`  drift  ${where}  "${finding.text}"  ${finding.detail}`)
    }
    for (const finding of chapter.errors) {
      lines.push(`  error  ${finding.source}  ${finding.reason}  "${finding.text}"  ${errorDetail(finding)}`)
    }
  }

  lines.push(
    // `vouched` is printed beside the counts it is derived from, because it is
    // the number the exit code now rests on and a number a reader cannot
    // reproduce from the line it sits in is a number they have to trust.
    `Summary: confirmed ${report.confirmedCount} / errors ${report.errorCount} / ` +
      `unanchored ${report.unanchoredCount} / evaluated ${report.evaluatedCount} / ` +
      `skipped ${report.skippedCount} / vouched ${verdict.vouched}`,
  )
  if (report.lowCoverageChapters.length > 0) {
    lines.push(`Low coverage: ${report.lowCoverageChapters.join(', ')}`)
  }
  // Gated on the reasons, not on `report.unverifiable`. The flag is the service's
  // summary of its own four not-clean counts; a run that vouched for nothing is a
  // fact about the arithmetic across them, and a report can carry it with the flag
  // unset (every evaluated claim drifted, or counts that contradict each other).
  // Printing the reasons is how the run says what it could not stand behind.
  if (verdict.reasons.length > 0) {
    // The parenthetical names the wire field, so it is only printed when the
    // field is actually set: the floor can hold with `unverifiable` false (every
    // evaluated claim drifted and nothing else went wrong), and a header
    // asserting the opposite of the payload is worse than no header.
    lines.push(
      report.unverifiable
        ? 'This run could not vouch for the manual (unverifiable):'
        : 'This run could not vouch for the manual:',
    )
    for (const reason of verdict.reasons) lines.push(`  - ${reason}`)
  }

  lines.push(verdict.failure ?? escalationNote(verdict, failOn))
  return `${lines.join('\n')}\n`
}

function chapterLine(chapter: VerifyChapterResult): string {
  return (
    `${chapter.number} ${chapter.title}  ${chapter.state}  ` +
    `confirmed ${chapter.confirmed.length} / errors ${chapter.errors.length} / ` +
    `untriggered ${chapter.untriggered.length} / touched ${chapter.touched.length}`
  )
}

function errorDetail(finding: VerifyChapterResult['errors'][number]): string {
  if (finding.reason === 'unmapped_repository') {
    return (
      `${finding.repository} is not in this project's commit map, so nothing in it can be read. ` +
      finding.detail
    )
  }
  return finding.detail
}

function escalationNote(verdict: Verdict, failOn: FailOn): string {
  if (verdict.drift === 0 && verdict.reasons.length === 0) return 'Manual check passed: no drift found.'
  const why =
    verdict.drift > 0
      ? 'This check is green because escalation is off'
      : // "no claim drifted" is the exact false reassurance issue 126 quotes
        // from the production run, and it is at its most misleading in the one
        // case where nothing was vouched for at all.
        verdict.readNothing
        ? 'This check is green because you asked for no failures, not because anything was verified'
        : 'This check is green because no claim drifted'
  const hint =
    failOn === 'none'
      ? 'Pass --fail-on drift to fail on drift, or --fail-on any to fail on anything this run could not vouch for.'
      : 'Pass --fail-on any to fail on anything this run could not vouch for.'
  return `${why}. ${hint}`
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

export const defaultManualVerifyDeps: ManualVerifyDeps = {
  api: { verifyManual },
  readProjectConfig: () => readProjectConfig(),
  git: runGit,
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
}
