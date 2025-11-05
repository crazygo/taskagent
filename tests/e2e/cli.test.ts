import { describe, test, expect } from 'vitest';
import { runCommand } from '../helpers/run-command';

describe('CLI tab entrypoints', () => {
  const cases = [
    { slug: 'story', expectation: /\[Story\] view is active/ },
    { slug: 'glossary', expectation: /\[Glossary\] view is active/ },
  ];

  test.each(cases)('$slug tab bootstraps via CLI flag', async ({ slug, expectation }) => {
    const { exitCode, stdout } = await runCommand('yarn', ['test:' + slug, '--newsession'], {testName: slug});
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(expectation);
  });

  test('application bootstraps with a prompt via -p flag', async () => {
    const prompt = 'Hello, world!';
    const { exitCode, stdout } = await runCommand('yarn', ['start', '--', '-p', prompt, '--newsession'], { testName: 'p-flag' });
    expect(exitCode).toBe(0);
    expect(stdout).toContain(prompt);
  });
});
