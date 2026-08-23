import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const PROFILE_DIR = join(ROOT, '.browser-profile');

// Real Chrome + a persistent profile is what gets past eBay's bot wall.
// Headless is fingerprinted and 403s, so these runs are always headed.
export function launchArgs(quiet = true) {
  return {
    headless: false,
    channel: 'chrome',
    viewport: { width: 1440, height: 950 },
    locale: 'en-US',
    args: ['--disable-blink-features=AutomationControlled'],
    ...(quiet ? {} : {}),
  };
}
