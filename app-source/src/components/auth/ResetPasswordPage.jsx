import { Link } from "@tanstack/react-router";
import { AlertTriangle, Lock } from "lucide-react";
import { useState } from "react";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { AuthError, SubmitButton } from "@/components/auth/parts";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/native-auth-client";

export function ResetPasswordPage() {
  const token = new URLSearchParams(window.location.search).get("token");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (password.length < 8) return setError("Use a password with at least 8 characters.");
    if (password !== confirm) return setError("Passwords do not match.");
    setBusy(true);
    try {
      const result = await authClient.resetPassword({ newPassword: password, token });
      if (result?.error) throw new Error(result.error.message || "Failed to reset password");
      window.location.assign("/login");
    } catch (cause) {
      setError(cause.message || "Failed to reset password");
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <AuthLayout
        icon={AlertTriangle}
        title="Invalid reset link"
        subtitle="This password reset link is missing or invalid"
        footer={<Link to="/forgot-password" className="font-medium text-primary hover:underline">Request a new link</Link>}
      >
        <p className="text-center text-sm text-foreground">The link you used appears to be incomplete. Please request a new password reset email.</p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout icon={Lock} title="New password" subtitle="Enter your new password below">
      <AuthError>{error}</AuthError>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="reset-password">New password</Label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input id="reset-password" type="password" autoComplete="new-password" autoFocus placeholder="At least 8 characters" value={password} onChange={(event) => setPassword(event.target.value)} className="h-12 pl-10" minLength={8} required />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="reset-confirm">Confirm password</Label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input id="reset-confirm" type="password" autoComplete="new-password" placeholder="Enter password again" value={confirm} onChange={(event) => setConfirm(event.target.value)} className="h-12 pl-10" required />
          </div>
        </div>
        <SubmitButton busy={busy} busyLabel="Resetting...">Reset password</SubmitButton>
      </form>
    </AuthLayout>
  );
}
