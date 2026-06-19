"use client";

import { FormEvent, useEffect, useState } from "react";

import { getStoredOperatorToken, setStoredOperatorToken } from "./operator-api";

export function OperatorTokenPanel() {
  const [token, setToken] = useState("");
  const [hasToken, setHasToken] = useState(false);

  useEffect(() => {
    const stored = getStoredOperatorToken();
    setHasToken(Boolean(stored));
  }, []);

  function saveToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStoredOperatorToken(token);
    setHasToken(Boolean(token.trim()));
    setToken("");
  }

  function clearToken() {
    setStoredOperatorToken("");
    setHasToken(false);
    setToken("");
  }

  return (
    <form className="operatorTokenPanel" onSubmit={saveToken}>
      <label>
        <span>Operator Token</span>
        <input
          autoComplete="off"
          placeholder={hasToken ? "token stored" : "paste token"}
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
        />
      </label>
      <button className="primaryButton" type="submit">
        Save
      </button>
      <button className="primaryButton" type="button" onClick={clearToken}>
        Clear
      </button>
      <small>{hasToken ? "write APIs armed" : "write APIs require token when enabled"}</small>
    </form>
  );
}
