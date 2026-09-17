// One budget for adapter discovery, device creation and shader compilation.
// WebGPU promises cannot be cancelled; late devices must still be released.
export function gpuStartupBudget(timeoutMs = 8000) {
  const deadline = performance.now() + timeoutMs;
  let expired = false;
  const timeout = () => new Error('Graphics initialization timed out; using compatibility rendering.');
  return {
    async wait(promise, releaseLate = () => {}) {
      let timer, settled = false;
      try {
        return await Promise.race([
          Promise.resolve(promise).then(value => {
            if (settled || expired || performance.now() >= deadline) {
              expired = true; releaseLate(value); throw timeout();
            }
            return value;
          }),
          new Promise((_, reject) => {
            timer = setTimeout(() => { expired = true; reject(timeout()); }, Math.max(0, deadline - performance.now()));
          }),
        ]);
      } finally { settled = true; clearTimeout(timer); }
    },
  };
}
