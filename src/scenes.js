// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
// - start_cleaning: the "Start cleaning" button of the device, from a scene
//   (when everyone leaves, at night...). Refused while a cat is detected.
// - dispense_snack: one portion from a Feeder-Robot, within the anti-loop
//   limit of the configuration (portions per 24 hours, a minute apart). The
//   limit is not an error: the action answers `dispensed: false`, so a scene
//   can go on and tell someone.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'litter-robot-scenes' });

export const SCENE_ACTIONS = {
  async start_cleaning(hub, { fields = {} }) {
    await hub.clean(fields.device || null);
    return undefined;
  },

  async dispense_snack(hub, { fields = {} }) {
    const result = await hub.dispenseSnack(fields.device || null);
    if (!result.dispensed) {
      logger.debug(`dispense_snack: not dispensed (${result.reason?.en})`);
    }
    return { dispensed: result.dispensed, remaining_today: result.remaining };
  },
};
