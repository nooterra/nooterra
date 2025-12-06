import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";

// Public Stealth Pages
import Home from "./views/Home";
import Manifesto from "./views/Manifesto";
import Careers from "./views/Careers";

// Company & Legal (Still accessible but hidden)
import { Privacy, Terms, About, Contact, NotFound } from "./views/StaticPages";

// Auth pages
import Login from "./views/auth/Login";
import Signup from "./views/auth/Signup";

// User (consumer) pages
import UserLayout from "./views/user/UserLayout";
import Chat from "./views/user/Chat";
import Conversations from "./views/user/Conversations";
import Usage from "./views/user/Usage";
import Billing from "./views/user/Billing";
import Settings from "./views/user/Settings";

// Developer pages
import DevLayout from "./views/dev/DevLayout";
import DevDashboard from "./views/dev/Dashboard";
import MyAgents from "./views/dev/MyAgents";
import NewAgent from "./views/dev/NewAgent";
import DeployAgent from "./views/dev/DeployAgent";
import DevAnalytics from "./views/dev/Analytics";
import Integrations from "./views/dev/Integrations";

// Organization pages
import OrgLayout from "./views/org/OrgLayout";
import OrgDashboard from "./views/org/OrgDashboard";
import Workflows from "./views/org/Workflows";
import WorkflowBuilder from "./views/org/WorkflowBuilder";
import Team from "./views/org/Team";

// Internal App Routes (Marketplace moved here for now)
import Marketplace from "./views/Marketplace";
import NetworkDashboard from "./views/NetworkDashboard";

export const AppRoutes = () => (
  <>
    <div className="noise-overlay" />
    <Routes>
      {/* Stealth Public Routes */}
      <Route path="/" element={<Home />} />
      <Route path="/manifesto" element={<Manifesto />} />
      <Route path="/careers" element={<Careers />} />

      {/* Footer / Legal */}
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/about" element={<About />} />
      <Route path="/contact" element={<Contact />} />

      {/* Auth */}
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />

      {/* Protected App Routes */}
      <Route path="/app" element={<UserLayout />}>
        <Route index element={<Chat />} />
        <Route path="ecosystem" element={<Marketplace />} /> {/* Moved here */}
        <Route path="network" element={<NetworkDashboard />} /> {/* Moved here */}
        <Route path="conversations" element={<Conversations />} />
        <Route path="conversations/:id" element={<Chat />} />
        <Route path="usage" element={<Usage />} />
        <Route path="billing" element={<Billing />} />
        <Route path="settings" element={<Settings />} />
      </Route>

      {/* Developer Console */}
      <Route path="/dev" element={<DevLayout />}>
        <Route index element={<DevDashboard />} />
        <Route path="agents" element={<MyAgents />} />
        <Route path="agents/new" element={<NewAgent />} />
        <Route path="agents/:id" element={<NewAgent />} />
        <Route path="deploy" element={<DeployAgent />} />
        <Route path="integrations" element={<Integrations />} />
        <Route path="analytics" element={<DevAnalytics />} />
        <Route path="keys" element={<Settings />} />
        <Route path="settings" element={<Settings />} />
      </Route>

      {/* Organization */}
      <Route path="/org" element={<OrgLayout />}>
        <Route index element={<OrgDashboard />} />
        <Route path="workflows" element={<Workflows />} />
        <Route path="workflows/new" element={<WorkflowBuilder />} />
        <Route path="workflows/:id" element={<WorkflowBuilder />} />
        <Route path="team" element={<Team />} />
        <Route path="billing" element={<Billing />} />
        <Route path="settings" element={<Settings />} />
      </Route>

      {/* Fallback */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  </>
);
