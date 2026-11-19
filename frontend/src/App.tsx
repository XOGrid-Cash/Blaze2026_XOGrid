
import { useEffect, useState } from "react";
import { Routes, Route } from "react-router-dom";

import LandingPage from "./pages/Landing";
import Dashboard from "./pages/Dashboard";
import Explore from "./pages/Explore";
import Publish from "./pages/Publish";
import TemplateDetail from "./pages/TemplateDetail";
import Policy from "./pages/Policy";
import Admin from "./pages/Admin";
import Documentation from "./pages/Documentation";
import Demo from "./pages/Demo";

import DashboardLayout from "./layout/DashboardLayout";
import RequireWallet from "./components/RequireWallet";
import NotFoundPage from "./components/NotFoundPage";
import { useHasAdminToken } from "./hub/admin";

import TopBanner from "./components/TopBanner";
import ConnectWalletModal from "./components/ConnectWalletModal";
import SigningPrompt from "./components/SigningPrompt";
import { WalletProvider, useWallet } from "./hub/WalletContext";

import xogridlogo from "./assets/images/xogridlogo.png";

interface LoadingScreenProps {
  exiting: boolean;
}

function LoadingScreen({ exiting }: LoadingScreenProps) {
  return (
    <div
      className={`xogrid-loader ${exiting ? "xogrid-loader-exit" : ""}`}
      role="status"
      aria-label="Loading XOGrid"
    >
      <div className="loader-glow loader-glow-one" />
      <div className="loader-glow loader-glow-two" />

      <div className="loader-content">
        <div className="loader-logo-wrap">
          <div className="loader-orbit loader-orbit-one" />
          <div className="loader-orbit loader-orbit-two" />

          <img
            src={xogridlogo}
            alt="XOGrid"
            className="loader-logo"
          />
        </div>

        <p className="loader-tagline">
          THE TEMPLATE REGISTRY
        </p>

        <div className="loader-grid">
          {Array.from({ length: 9 }).map((_, index) => (
            <span
              key={index}
              style={{ animationDelay: `${index * 0.09}s` }}
            />
          ))}
        </div>

        <p className="loader-message">
          Preparing your experience
          <span className="loader-dots">...</span>
        </p>

        <div className="loader-progress">
          <span />
        </div>

        <span className="loader-version">
          EXPLORE. PUBLISH. BUILD TRUST.
        </span>
      </div>
    </div>
  );
}

/** The one wallet modal for the whole site. Any page opens it with useWallet().openModal(). */
function WalletModalHost() {
  const { modalOpen, closeModal } = useWallet();

  return <ConnectWalletModal isOpen={modalOpen} onClose={closeModal} />;
}

/** /admin looks like any unknown address to someone with no wallet connected and no moderator session. */
function AdminGate() {
  const { connected, restoring } = useWallet();
  const hasToken = useHasAdminToken();

  return connected || restoring || hasToken ? <Admin /> : <NotFoundPage />;
}

function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    const exitTimer = setTimeout(() => {
      setIsExiting(true);
    }, 1600);

    const removeTimer = setTimeout(() => {
      setIsLoading(false);
    }, 2050);

    return () => {
      clearTimeout(exitTimer);
      clearTimeout(removeTimer);
    };
  }, []);

  return (
    <WalletProvider>
      <TopBanner />

      <Routes>
        {/* Public landing page */}
        <Route path="/" element={<LandingPage />} />

        {/* Shared dashboard layout */}
        <Route element={<DashboardLayout />}>
          <Route path="/dashboard" element={<RequireWallet title="Connect your wallet to open the dashboard"><Dashboard /></RequireWallet>} />
          <Route path="/explore" element={<Explore />} />
          <Route path="/publish" element={<RequireWallet title="Connect your wallet to publish a template"><Publish /></RequireWallet>} />
          <Route path="/policy" element={<Policy />} />
          <Route path="/admin" element={<AdminGate />} />
        </Route>

        {/* Standalone pages */}
        <Route path="/t/:identifier" element={<TemplateDetail />} />
        <Route path="/demo" element={<Demo />} />
        <Route path="/docs" element={<Documentation />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>

      <WalletModalHost />
      <SigningPrompt />

      {isLoading && <LoadingScreen exiting={isExiting} />}
    </WalletProvider>
  );
}

export default App;
