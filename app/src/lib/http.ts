import { ApiError, isApiError } from './errors';

/** The deadline includes headers and the entire body, even on a half-open link. */
export async function fetchText(
  fetchImpl: typeof fetch, url: string, init: RequestInit, timeoutMs: number,
  onResponse?: (response: Response) => void,
): Promise<{ response: Response; text: string }> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new ApiError(0, 'timeout', '请求超时'));
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetchImpl(url, { ...init, signal: controller.signal });
        onResponse?.(response);
        return { response, text: await response.text() };
      })(),
      deadline,
    ]);
  } catch (error) {
    controller.abort();
    if (isApiError(error)) throw error;
    throw new ApiError(0, 'network', '网络请求失败', error);
  } finally {
    clearTimeout(timer);
  }
}
