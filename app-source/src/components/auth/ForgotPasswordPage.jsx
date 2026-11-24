import { ArrowLeft, Mail } from "lucide-react";
import { useState } from "react";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { AuthError, AuthLink, SubmitButton } from "@/components/auth/parts";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/native-auth-client";
import { safeReturnTo } from "@/lib/authReturnTo";

export function ForgotPasswordPage() {
  const returnTo = safeReturnTo();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await authClient.forgetPassword({
        email: email.trim(),
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (result?.error) throw new Error(result.error.message || "Could not send the reset email.");
      setSent(true);
    } catch (cause) {
      setError(cause.message || "Password reset email could not be sent. Please try again later.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout icon={Mail} title="Reset password" subtitle="We'll send you a link to reset it">
      {sent ? (
        <p className="text-center text-sm text-foreground">If an account exists with that email, a password reset link will be sent shortly.</p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <AuthError>{error}</AuthError>
          <div className="space-y-2">
            <Label htmlFor="forgot-email">Email address</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input id="forgot-email" type="email" autoComplete="email" autoFocus placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} className="h-12 pl-10" required />
            </div>
          </div>
          <SubmitButton busy={busy} busyLabel="Sending...">Send reset link</SubmitButton>
        </form>
      )}
      <p className="mt-6 text-center text-sm text-muted-foreground">
        <AuthLink to="/login" returnTo={returnTo}>
          <ArrowLeft className="mr-1 inline h-3 w-3" aria-hidden="true" /> Back to log in
        </AuthLink>
      </p>
    </AuthLayout>
  );
}
