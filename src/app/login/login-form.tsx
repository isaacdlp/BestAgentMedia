"use client";

import { useActionState } from "react";
import Link from "next/link";
import { login, type LoginState } from "@/app/actions/auth";

const initialState: LoginState = {};

export default function LoginForm({ claim }: { claim?: string }) {
  const [state, formAction, pending] = useActionState(login, initialState);

  return (
    <form action={formAction} className="login-form">
      <label htmlFor="email">Email address</label>
      <input
        autoComplete="email"
        id="email"
        name="email"
        placeholder="you@example.com"
        required
        type="email"
      />
      <label htmlFor="password">Password</label>
      <input
        autoComplete="current-password"
        id="password"
        name="password"
        placeholder="Enter your password"
        required
        type="password"
      />
      {claim ? <input name="claim" type="hidden" value={claim} /> : null}
      <Link className="forgot-link" href="/forgot-password">
        Forgot password?
      </Link>
      {state.error ? (
        <p aria-live="polite" className="form-error" role="alert">
          {state.error}
        </p>
      ) : null}
      <button className="button button-primary login-submit" disabled={pending} type="submit">
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
