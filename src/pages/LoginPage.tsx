import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { buildApiUrl } from "@/api/client";
import { useAuth } from "@/contexts/AuthContext";
import { INACTIVE_LOGOUT_SESSION_KEY } from "@/constants/inactivity";
import { oauthErrorMessage } from "@/lib/oauthErrors";
import { AppLogoMark } from "@/components/layout/AppLogoMark";

function readInactiveLogoutFlag(): boolean {
  try {
    if (globalThis.sessionStorage?.getItem(INACTIVE_LOGOUT_SESSION_KEY) === "1") {
      globalThis.sessionStorage?.removeItem(INACTIVE_LOGOUT_SESSION_KEY);
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

const GOOGLE_AUTH_ENABLED = import.meta.env.VITE_GOOGLE_AUTH_ENABLED === "true";

export default function LoginPage() {
  const navigate = useNavigate();
  const { loginWithToken, user, initializing } = useAuth();
  const [inactiveLogout] = useState(readInactiveLogoutFlag);
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
    const token = sp.get("token");
    if (!token) {
      return;
    }
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    void (async () => {
      setSubmitting(true);
      setError(null);
      try {
        await loginWithToken(token);
        navigate("/", { replace: true });
      } catch {
        setError("No se pudo completar el inicio de sesión con Google.");
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

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30">
      <Card className="w-full max-w-md shadow-card-hover">
        <CardContent className="p-8 flex flex-col items-center space-y-6">
          <div className="flex items-center gap-3">
            <AppLogoMark size="md" />
            <div>
              <h1 className="text-xl font-bold">EnviaMas RRHH</h1>
              <p className="text-xs text-muted-foreground">Plataforma de Recursos Humanos</p>
            </div>
          </div>

          <p className="text-center text-sm text-muted-foreground w-full">
            Inicia sesión con tu cuenta Google del dominio autorizado.
          </p>
          {inactiveLogout ? (
            <p className="text-center text-sm text-muted-foreground w-full" role="status">
              Sesión cerrada por inactividad. Vuelve a iniciar sesión.
            </p>
          ) : null}
          {error ? (
            <p className="text-sm text-destructive text-center w-full" role="alert">
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
                window.location.href = buildApiUrl("/auth/google/redirect");
              }}
            >
              {submitting ? "Procesando…" : "Continuar con Google"}
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground text-center">
              El acceso con Google no está habilitado en este entorno.
            </p>
          )}

          <p className="text-xs text-muted-foreground text-center">
            © 2026 EnviaMas S.A.C. — Tecnología de Comunicaciones
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
