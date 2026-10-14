// -----------------------------------------------------------------------------
// Small persistence under /data (the only writable path of the container):
//   - the Cognito tokens of the account, so that a restart refreshes them
//     instead of signing in with the password again; tied to a hash of the
//     e-mail, forgotten when the account changes;
//   - per robot: the last cat visit and the visits of the day (the "Last
//     visit" feature, the widget, the trigger variables);
//   - per feeder: the portions Gladys dispensed over 24 hours (the anti-loop
//     limit must survive a restart).
// The file is written with mode 600. Losing it is harmless: one sign-in with
// the password, visits counted again from the next one.
// (Adapted from guim31/gladys-pihole.)
// -----------------------------------------------------------------------------

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'litter-robot-store' });
const FILE_NAME = 'litter-robot.json';

export class Store {
  constructor(directory = process.env.LITTER_ROBOT_DATA_DIR || '/data') {
    this.directory = directory;
    this.path = join(directory, FILE_NAME);
    this.pending = null;
    this.writing = null;
    this.warned = false;
  }

  async load() {
    try {
      const data = JSON.parse(await readFile(this.path, 'utf8'));
      return data && typeof data === 'object' ? data : {};
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.warn(`Cannot read ${this.path}: ${err.message}`);
      }
      return {};
    }
  }

  // Writes are coalesced and atomic (temporary file + rename): a crash never
  // leaves half a JSON file behind.
  save(data) {
    this.latest = data;
    if (!this.pending) {
      this.pending = (this.writing ?? Promise.resolve()).then(async () => {
        const snapshot = this.latest;
        this.pending = null;
        try {
          await mkdir(this.directory, { recursive: true });
          const temporary = `${this.path}.tmp`;
          await writeFile(temporary, JSON.stringify(snapshot), { mode: 0o600 });
          await rename(temporary, this.path);
          this.warned = false;
        } catch (err) {
          // Said once: the next writes fail the same way (read-only volume).
          if (!this.warned) {
            this.warned = true;
            logger.warn(`Cannot write ${this.path}: ${err.message}`);
          }
        }
      });
      this.writing = this.pending;
    }
    return this.pending;
  }

  /** Resolves once every write requested so far is on disk. */
  flush() {
    return this.writing ?? Promise.resolve();
  }
}
