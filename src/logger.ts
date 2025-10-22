import fs from 'fs';

const LOG_FILE = 'debug.log';

export const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    fs.appendFileSync(LOG_FILE, `[${timestamp}] ${message}\n`);
};

// Initialize log file on startup
fs.writeFileSync(LOG_FILE, '');
addLog('--- Application Started ---');
