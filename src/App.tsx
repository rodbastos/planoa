import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { ImportProvider } from "./hooks/useImports";
import { AppLayout } from "./components/layout/AppLayout";
import { PageLoader } from "./components/ui/StatCard";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { CarteiraPage } from "./pages/CarteiraPage";
import { ImportarPage } from "./pages/ImportarPage";
import { CarteiraIdealPage } from "./pages/CarteiraIdealPage";
import { SimulacaoPage } from "./pages/SimulacaoPage";
import { HistoricoPage } from "./pages/HistoricoPage";
import { ConfiguracoesPage } from "./pages/ConfiguracoesPage";

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            element={
              <Protected>
                <ImportProvider>
                  <AppLayout />
                </ImportProvider>
              </Protected>
            }
          >
            <Route path="/" element={<DashboardPage />} />
            <Route path="/carteira" element={<CarteiraPage />} />
            <Route path="/importar" element={<ImportarPage />} />
            <Route path="/carteira-ideal" element={<CarteiraIdealPage />} />
            <Route path="/simulacao" element={<SimulacaoPage />} />
            <Route path="/historico" element={<HistoricoPage />} />
            <Route path="/configuracoes" element={<ConfiguracoesPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster richColors position="top-right" />
    </AuthProvider>
  );
}
