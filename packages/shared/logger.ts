import fs from 'fs';
import path from 'path';

const LOG_DIR = 'logs';
const LOG_FILE = path.join(LOG_DIR, 'debug.log');

const ensureLogDir = () => {
    try {
        fs.mkdirSync(LOG_DIR, { recursive: true });
    } catch {}
};

ensureLogDir();

export const addLog = (message: string) => {
    const now = new Date();
    const timestamp = now.toLocaleTimeString();
    const milliseconds = now.getMilliseconds().toString().padStart(3, '0');
    fs.appendFileSync(LOG_FILE, `[${timestamp}.${milliseconds}] ${message}\n`);
};

// Initialize log file on startup with rollover
try {
    if (fs.existsSync(LOG_FILE)) {
        const stat = fs.statSync(LOG_FILE);
        const d = stat.mtime;
        const y = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const hh = String(d.getHours()).padStart(2, '0');
        const mi = String(d.getMinutes()).padStart(2, '0');
        const ss = String(d.getSeconds()).padStart(2, '0');
        const backup = path.join(LOG_DIR, `debug.${y}${mm}${dd}_${hh}${mi}${ss}.log`);
        try { fs.copyFileSync(LOG_FILE, backup); } catch {}
    }
} catch {}

fs.writeFileSync(LOG_FILE, '');
addLog('--- Application Started ---');
