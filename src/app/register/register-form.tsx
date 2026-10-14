"use client";

import { useActionState } from "react";
import { register, type RegisterState } from "@/app/actions/auth";

const initialState: RegisterState = {};

export default function RegisterForm({ claim }: { claim?: string }) {
  const [state, formAction, pending] = useActionState(register, initialState);

  return (
    <form action={formAction} className="login-form register-form">
      <div className="register-name-row">
        <div>
          <label htmlFor="reg-name">First name</label>
          <input
            autoComplete="given-name"
            id="reg-name"
            name="name"
            placeholder="First name"
            required
            type="text"
          />
        </div>
        <div>
          <label htmlFor="reg-surname">Last name</label>
          <input
            autoComplete="family-name"
            id="reg-surname"
            name="surname"
            placeholder="Last name"
            type="text"
          />
        </div>
      </div>
      <label htmlFor="reg-email">Email address</label>
      <input
        autoComplete="email"
        id="reg-email"
        name="email"
        placeholder="you@example.com"
        required
        type="email"
      />
      <label htmlFor="reg-password">Password</label>
      <input
        autoComplete="new-password"
        id="reg-password"
        name="password"
        placeholder="At least 8 characters"
        required
        type="password"
      />
      {claim ? <input name="claim" type="hidden" value={claim} /> : null}
      {state.error ? (
        <p aria-live="polite" className="form-error" role="alert">
          {state.error}
        </p>
      ) : null}
      <button className="button button-primary login-submit" disabled={pending} type="submit">
        {pending ? "Creating account…" : "Create account"}
      </button>
    </form>
  );
}
