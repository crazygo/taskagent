import fs from 'fs';

const LOG_FILE = 'debug.log';

export const addLog = (message: string) => {
    const now = new Date();
    const timestamp = now.toLocaleTimeString();
    const milliseconds = now.getMilliseconds().toString().padStart(3, '0');
    fs.appendFileSync(LOG_FILE, `[${timestamp}.${milliseconds}] ${message}\n`);
};

// Initialize log file on startup
fs.writeFileSync(LOG_FILE, '');
addLog('--- Application Started ---');
