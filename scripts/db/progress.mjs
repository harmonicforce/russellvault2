// Turns a pgTAP runner's output stream into unambiguous progress records.
//
// The problem
// -----------
// When the Supabase lane stalled, the CI log's last line was a NOTICE emitted
// from inside 15_acquisition_digest_parity.sql. That is suggestive but it is
// NOT proof of which file was executing: a NOTICE is incidental output, a file
// that emits none would leave the previous file's name as the last thing
// printed, and pg_prove announces a file only when it FINISHES.
//
// So this tracker does not guess from the last name it saw. pg_prove executes
// the inventory in sorted order and reports each completion, so after N
// completions the file being executed is exactly `inventory[N]`. That is a
// derivation, not an inference. The last path mentioned by any line is tracked
// separately as corroboration, and when the two disagree the report says so
// rather than silently picking one.
//
// Everything here is pure: feed it lines, read the state. The runner owns the
// printing and the clock.

const TEST_FILE = String.raw`\d+_[A-Za-z0-9_]+\.sql`;

// pg_prove: "<path> ....... ok" / "Failed 2/4 subtests" / "Dubious, test returned 1"
const PROVE_RESULT = new RegExp(String.raw`^(?<path>\S*${TEST_FILE})\s+\.*\s*(?<verdict>ok|Failed\b.*|Dubious\b.*)\s*$`);
// psql diagnostics carry the file they came from: "psql:/abs/15_x.sql:11: NOTICE: ..."
const PSQL_PREFIX = new RegExp(String.raw`^psql:(?<path>\S*${TEST_FILE}):\d+:`);
// Any other mention of a test path, e.g. our own runner's echo lines.
const ANY_MENTION = new RegExp(String.raw`(?<path>\S*${TEST_FILE})`);
// pg_prove's closing inventory: "Files=70, Tests=2673, 23 wallclock secs (...)"
const PROVE_SUMMARY = /^Files=(?<files>\d+),\s*Tests=(?<tests>\d+)/;
const PROVE_VERDICT = /^Result:\s*(?<result>PASS|FAIL|NOTESTS)\s*$/;

const basename = (path) => path.slice(path.lastIndexOf('/') + 1);

/**
 * @param {string[]} inventory sorted test filenames (basenames), the exact set
 *        the runner is expected to execute, in execution order.
 */
export function createProgressTracker(inventory) {
  if (!Array.isArray(inventory) || inventory.length === 0) {
    throw new Error('createProgressTracker requires a non-empty inventory');
  }

  const completed = [];          // { file, verdict }
  const seen = new Set();        // every file the stream has named
  let lastMentioned = null;
  let summary = null;            // { files, tests } from pg_prove
  let verdict = null;            // PASS | FAIL | NOTESTS

  const currentFile = () => (completed.length < inventory.length ? inventory[completed.length] : null);

  return {
    /** Feed one output line. Returns the completion record if the line was one. */
    observe(line) {
      const summaryMatch = PROVE_SUMMARY.exec(line);
      if (summaryMatch) {
        summary = { files: Number(summaryMatch.groups.files), tests: Number(summaryMatch.groups.tests) };
        return null;
      }
      const verdictMatch = PROVE_VERDICT.exec(line);
      if (verdictMatch) {
        verdict = verdictMatch.groups.result;
        return null;
      }

      const result = PROVE_RESULT.exec(line);
      if (result) {
        const file = basename(result.groups.path);
        seen.add(file);
        lastMentioned = file;
        const record = { file, verdict: result.groups.verdict === 'ok' ? 'ok' : result.groups.verdict };
        completed.push(record);
        return record;
      }

      const mention = PSQL_PREFIX.exec(line) ?? ANY_MENTION.exec(line);
      if (mention) {
        const file = basename(mention.groups.path);
        seen.add(file);
        lastMentioned = file;
      }
      return null;
    },

    /** A snapshot suitable for printing in a stall or failure report. */
    state() {
      const current = currentFile();
      const mentionAgrees = lastMentioned === null || lastMentioned === current;
      return {
        totalFiles: inventory.length,
        completedCount: completed.length,
        completed: completed.map((entry) => entry.file),
        lastCompleted: completed.length > 0 ? completed[completed.length - 1].file : null,
        // Derived from completion ORDER, which is exact — not from whichever
        // filename happened to be printed most recently.
        currentFile: current,
        lastMentionedFile: lastMentioned,
        mentionAgrees,
        notStarted: inventory.slice(Math.min(completed.length + 1, inventory.length)),
        failures: completed.filter((entry) => entry.verdict !== 'ok'),
        summary,
        verdict,
      };
    },

    /** One line naming exactly where the suite is. Used for stall reports. */
    describePosition() {
      const state = this.state();
      if (state.currentFile === null) {
        return `all ${state.totalFiles} files reported; waiting on the runner to exit`;
      }
      const position = `file ${state.completedCount + 1}/${state.totalFiles} ${state.currentFile}`;
      const after = state.lastCompleted ? `, last completed ${state.lastCompleted}` : ', nothing completed yet';
      // Never hide a disagreement between the two independent indicators.
      const corroboration = state.mentionAgrees
        ? ''
        : ` (WARNING: the most recent output named ${state.lastMentionedFile}, not ${state.currentFile};`
          + ' treat the executing file as unconfirmed)';
      return `${position}${after}${corroboration}`;
    },
  };
}
