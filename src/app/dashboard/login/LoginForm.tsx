"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "../actions";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, {});
  return (
    <form action={action} className="stack">
      {state.error && (
        <div className="banner banner--error" role="alert">
          {state.error}
        </div>
      )}
      <label className="field">
        Email
        <input className="input" name="email" type="email" autoComplete="username" required />
      </label>
      <label className="field">
        Password
        <input className="input" name="password" type="password" autoComplete="current-password" required />
      </label>
      <button className="btn btn--primary" type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
