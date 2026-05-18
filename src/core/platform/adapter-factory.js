/**
 * core/platform/adapter-factory.js
 *
 * Detects the current host platform and returns the correct adapter.
 * The rest of the codebase ONLY imports from here — never directly from
 * adapter-macos.js, adapter-windows.js, etc.
 *
 * Adding a new platform:
 *  1. Create src/core/platform/adapter-{name}.js extending PlatformAdapterBase
 *  2. Add a case here
 *  Done. Nothing else changes.
 */

'use strict';

const { createLogger } = require('../utils/logger');

const log = createLogger('PlatformFactory');

let _adapter = null;

/**
 * Get the platform adapter for the host OS.
 * Singleton — instantiated once on first call.
 * @returns {PlatformAdapterBase}
 */
function getPlatformAdapter() {
    if (_adapter) return _adapter;

    const platform = process.platform;

    switch (platform) {
        case 'darwin': {
            const { MacOSAdapter } = require('./adapter-macos');
            _adapter = new MacOSAdapter();
            log.info('Platform adapter: macOS');
            break;
        }
        case 'win32': {
            // Future: const { WindowsAdapter } = require('./adapter-windows');
            // For now, fall through to base (returns unsupported for everything)
            const { PlatformAdapterBase } = require('./adapter-base');
            _adapter = new PlatformAdapterBase('windows');
            log.warn('Windows adapter not yet implemented — OS tools will return unsupported.');
            break;
        }
        case 'linux': {
            // Future: const { LinuxAdapter } = require('./adapter-linux');
            const { PlatformAdapterBase } = require('./adapter-base');
            _adapter = new PlatformAdapterBase('linux');
            log.warn('Linux adapter not yet implemented — OS tools will return unsupported.');
            break;
        }
        default: {
            const { PlatformAdapterBase } = require('./adapter-base');
            _adapter = new PlatformAdapterBase('unknown');
            log.warn(`Unknown platform "${platform}" — OS tools disabled.`);
        }
    }

    return _adapter;
}

/**
 * Override the adapter (used in tests or when running inside a mobile client context).
 * @param {'ios'|'android'} platformId
 */
function setMobileAdapter(platformId) {
    const { MobileAdapter } = require('./adapter-mobile');
    _adapter = new MobileAdapter(platformId);
    log.info(`Platform adapter overridden: ${platformId}`);
}

/**
 * Reset the adapter singleton (for testing).
 */
function resetAdapter() {
    _adapter = null;
}

module.exports = { getPlatformAdapter, setMobileAdapter, resetAdapter };
