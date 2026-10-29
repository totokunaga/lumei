// The fetch function every generated API call goes through (orval mutator).

const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:18080';

export const apiFetch = async <T>(url: string, options: RequestInit): Promise<T> => {
  const res = await fetch(`${baseUrl}${url}`, options);
  const body = [204, 205, 304].includes(res.status) ? '' : await res.text();
  const data = body ? JSON.parse(body) : {};

  return { data, status: res.status, headers: res.headers } as T;
};
