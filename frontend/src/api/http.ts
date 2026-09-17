export async function apiFetch<T>(baseUrl: string, path: string, idToken: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      // API Gateway's Cognito User Pools authorizer expects the raw ID
      // token in this header, with no "Bearer " prefix.
      Authorization: idToken,
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${path} failed with status ${response.status}: ${body}`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}
