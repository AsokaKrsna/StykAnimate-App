/** The UI owns cancellation even when a busy worker must be terminated. */
export function codecJob(baseURL, token = '') {
  const id = crypto.randomUUID().replaceAll('-', '');
  let settled = false;
  return {id,
    finish() { settled = true; },
    cancel() {
      if (settled) return;
      settled = true;
      const headers = token ? {Authorization: `Bearer ${token}`} : {};
      // No document data crosses this control request. It has an independent
      // lifetime from the worker/fetch being cancelled and a bounded timeout.
      void fetch(new URL(`/api/cancel?id=${id}`, baseURL), {method: 'POST', body: '', headers,
        signal: AbortSignal.timeout(2000), keepalive: true}).catch(() => {});
    },
  };
}
