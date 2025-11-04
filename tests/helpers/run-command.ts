import { execa } from 'execa';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

// A helper to run a command and capture its output, saving logs to the artifacts directory.
export async function runCommand(
  command: string,
  args: string[],
  options: { testName: string; workspaceDir?: string }
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const { testName, workspaceDir } = options;

  // Correctly resolve paths in an ESM context
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(__dirname, '../../'); // Go up from tests/helpers
  const artifactsDir = path.join(projectRoot, 'artifacts');
  const logFilePath = path.join(artifactsDir, `${testName}.log`);

  // Ensure the artifacts directory exists
  await fs.mkdir(artifactsDir, { recursive: true });

  // Use a test workspace inside the project directory if not specified
  const testWorkspace = workspaceDir || path.join(projectRoot, '.tmp-test-workspaces', testName);
  
  // Ensure test workspace exists
  await fs.mkdir(testWorkspace, { recursive: true });

  const childProcess = execa(command, args, {
    cwd: projectRoot,
    env: { 
      FORCE_COLOR: '0', 
      ...process.env, 
      E2E_WORKSPACE: testWorkspace,
      // Disable non-interactive timeout for most tests (except e2e-automation which needs it)
      ...(testName !== 'e2e-automation' && { E2E_DISABLE_TIMEOUT: '1' })
    },
    reject: false, // Don't throw on non-zero exit codes
  });

  // Pipe output to a log file for debugging
  const logStream = (await fs.open(logFilePath, 'w')).createWriteStream();
  childProcess.stdout?.pipe(logStream);
  childProcess.stderr?.pipe(logStream);

  // Also mirror output to the current process so CI logs show the UI/errors live
  childProcess.stdout?.pipe(process.stdout);
  childProcess.stderr?.pipe(process.stderr);

  // Await the process to get the complete result
  const result = await childProcess;

  // Explicitly close the log stream after the child finishes
  await new Promise(resolve => logStream.end(resolve));

  if (result.exitCode !== 0) {
    console.error(`\n[${testName}] command failed (exit ${result.exitCode})`);
    if (result.stdout) {
      console.error(`[${testName}] stdout:\n${result.stdout}`);
    }
    if (result.stderr) {
      console.error(`[${testName}] stderr:\n${result.stderr}`);
    }
  }

  // Return stdout/stderr from the final result object for reliable assertions
  return {
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}
