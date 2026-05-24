import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { buildApiUrl } from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import { oauthErrorMessage } from "@/lib/oauthErrors";
import { AppLogoMark } from "@/components/layout/AppLogoMark";

const GOOGLE_AUTH_ENABLED = import.meta.env.VITE_GOOGLE_AUTH_ENABLED === "true";

export default function InviteAcceptPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { loginWithToken, user, initializing } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!initializing && user) {
      navigate("/", { replace: true });
    }
  }, [initializing, user, navigate]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get("error");
    if (err) {
      setError(oauthErrorMessage(err));
      window.history.replaceState(null, "", window.location.pathname);
    }
    const h = window.location.hash;
    if (!h || !h.includes("token=")) {
      return;
    }
    const sp = new URLSearchParams(h.startsWith("#") ? h.slice(1) : h);
    const t = sp.get("token");
    if (!t) {
      return;
    }
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    void (async () => {
      setSubmitting(true);
      setError(null);
      try {
        await loginWithToken(t);
        navigate("/", { replace: true });
      } catch {
        setError("No se pudo completar el registro con Google.");
      } finally {
        setSubmitting(false);
      }
    })();
  }, [loginWithToken, navigate]);

  if (initializing) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 text-muted-foreground text-sm">
        Cargando…
      </div>
    );
  }

  if (!token?.trim()) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
        <Card className="w-full max-w-md shadow-card-hover">
          <CardContent className="p-8">
            <p className="text-sm text-destructive text-center" role="alert">
              Enlace de invitación no válido.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md shadow-card-hover">
        <CardContent className="p-8 flex flex-col items-center space-y-6">
          <div className="flex items-center gap-3">
            <AppLogoMark size="md" />
            <div>
              <h1 className="text-xl font-bold">Invitación</h1>
              <p className="text-xs text-muted-foreground">EnviaMas RRHH</p>
            </div>
          </div>
          <p className="text-center text-sm text-muted-foreground">
            Completa tu registro con la cuenta de Google asociada al correo invitado. No podrás usar otra cuenta.
          </p>
          {error ? (
            <p className="text-sm text-destructive text-center" role="alert">
              {error}
            </p>
          ) : null}
          {GOOGLE_AUTH_ENABLED ? (
            <Button
              type="button"
              className="w-full"
              size="lg"
              disabled={submitting}
              onClick={() => {
                const q = new URLSearchParams({ invite_token: token.trim() });
                window.location.href = buildApiUrl(`/auth/google/redirect?${q.toString()}`);
              }}
            >
              {submitting ? "Procesando…" : "Continuar con Google"}
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground text-center">
              El acceso con Google no está habilitado en este entorno.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
