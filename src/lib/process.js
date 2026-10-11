import { spawn } from 'node:child_process';

export function runCommand(executable, argumentsList, { env, onLine, maxOutputBytes = 5_000_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, argumentsList, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';

    const consume = (stream, target) => {
      let pending = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => {
        pending += chunk;
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() || '';
        for (const line of lines) onLine?.(line, target);

        if (target === 'stdout' && stdout.length < maxOutputBytes) stdout += chunk;
        if (target === 'stderr' && stderr.length < maxOutputBytes) stderr += chunk;
      });
      stream.on('end', () => {
        if (pending) onLine?.(pending, target);
      });
    };

    consume(child.stdout, 'stdout');
    consume(child.stderr, 'stderr');

    child.once('error', reject);
    child.once('close', (code, signal) => {
      resolve({ code: code ?? -1, signal, stdout, stderr });
    });
  });
}
