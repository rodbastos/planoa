import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { Button } from "../components/ui/Button";
import { Spinner } from "../components/ui/StatCard";

export function LoginPage() {
  const { user, loading, signIn } = useAuth();
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading)
    return (
      <div className="flex h-screen items-center justify-center bg-sidebar">
        <Spinner className="h-8 w-8" />
      </div>
    );
  if (user) return <Navigate to="/" replace />;

  return (
    <div className="flex min-h-screen items-center justify-center bg-sidebar p-4">
      <div className="w-full max-w-sm rounded-2xl bg-card p-8 shadow-2xl">
        <div className="mb-8 flex flex-col items-center">
          <img
            src="/logo.png"
            alt="Plano A"
            className="mb-3 h-14 object-contain"
          />
          <p className="text-center text-sm text-muted-foreground">
            Gestão de investimentos com estratégia de asset allocation
          </p>
        </div>

        <Button
          size="lg"
          className="w-full"
          disabled={signingIn}
          onClick={async () => {
            setSigningIn(true);
            setError(null);
            try {
              await signIn();
            } catch (e) {
              setError(
                e instanceof Error ? e.message : "Falha ao entrar com Google",
              );
              setSigningIn(false);
            }
          }}
        >
          {signingIn ? (
            <Spinner />
          ) : (
            <svg className="h-5 w-5" viewBox="0 0 24 24">
              <path
                fill="currentColor"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
              />
              <path
                fill="currentColor"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                opacity=".7"
              />
              <path
                fill="currentColor"
                d="M5.84 14.09a7.19 7.19 0 0 1 0-4.18V7.07H2.18a11 11 0 0 0 0 9.86l3.66-2.84z"
                opacity=".5"
              />
              <path
                fill="currentColor"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                opacity=".9"
              />
            </svg>
          )}
          Entrar com Google
        </Button>

        {error && (
          <p className="mt-4 text-center text-xs text-destructive">{error}</p>
        )}
      </div>
    </div>
  );
}
