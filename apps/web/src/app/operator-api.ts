"use client";

const operatorTokenStorageKey = "agent-control-plane.operator-token";

export function getStoredOperatorToken(): string {
  if (typeof window === "undefined") {
    return "";
  }
  return window.localStorage.getItem(operatorTokenStorageKey) ?? "";
}

export function setStoredOperatorToken(token: string) {
  if (typeof window === "undefined") {
    return;
  }
  const trimmed = token.trim();
  if (trimmed) {
    window.localStorage.setItem(operatorTokenStorageKey, trimmed);
  } else {
    window.localStorage.removeItem(operatorTokenStorageKey);
  }
}

export function operatorHeaders(headers?: HeadersInit): Headers {
  const merged = new Headers(headers);
  const token = getStoredOperatorToken();
  if (token && !merged.has("authorization")) {
    merged.set("authorization", `Bearer ${token}`);
  }
  return merged;
}

export function operatorFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  return fetch(input, {
    ...init,
    headers: operatorHeaders(init.headers),
  });
}
