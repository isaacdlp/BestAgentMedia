"use client";

import { useActionState } from "react";
import {
  resetPassword,
  type PasswordResetState,
} from "@/app/actions/password-reset";

const initialState: PasswordResetState = {};

export default function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(resetPassword, initialState);

  return (
    <form action={formAction} className="login-form">
      <input name="token" type="hidden" value={token} />
      <label htmlFor="password">New password</label>
      <input
        autoComplete="new-password"
        id="password"
        maxLength={72}
        minLength={12}
        name="password"
        required
        type="password"
      />
      <label htmlFor="confirmPassword">Confirm new password</label>
      <input
        autoComplete="new-password"
        id="confirmPassword"
        maxLength={72}
        minLength={12}
        name="confirmPassword"
        required
        type="password"
      />
      {state.error ? (
        <p aria-live="polite" className="form-error" role="alert">{state.error}</p>
      ) : null}
      <button className="button button-primary login-submit" disabled={pending} type="submit">
        {pending ? "Updating…" : "Update password"}
      </button>
    </form>
  );
}
