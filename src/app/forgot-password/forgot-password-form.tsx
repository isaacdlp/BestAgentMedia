"use client";

import { useActionState } from "react";
import {
  requestPasswordReset,
  type PasswordResetState,
} from "@/app/actions/password-reset";

const initialState: PasswordResetState = {};

export default function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(
    requestPasswordReset,
    initialState,
  );

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
      {state.error ? (
        <p aria-live="polite" className="form-error" role="alert">{state.error}</p>
      ) : null}
      {state.message ? (
        <p aria-live="polite" className="form-success" role="status">{state.message}</p>
      ) : null}
      <button className="button button-primary login-submit" disabled={pending} type="submit">
        {pending ? "Sending…" : "Send reset link"}
      </button>
    </form>
  );
}
