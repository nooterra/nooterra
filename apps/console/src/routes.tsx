import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";

// Public pages
import Home from "./views/Home";
import Explore from "./views/Explore";
import Marketplace from "./views/Marketplace";
import NetworkDashboard from "./views/NetworkDashboard";

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
import ImportFromGitHub from "./views/dev/ImportFromGitHub";
import ImportHuggingFace from "./views/dev/ImportHuggingFace";
import SpecializedAgents from "./views/dev/SpecializedAgents";
import Playground from "./views/Playground";

// Organization pages
import OrgLayout from "./views/org/OrgLayout";
import OrgDashboard from "./views/org/OrgDashboard";
import Workflows from "./views/org/Workflows";
import WorkflowBuilder from "./views/org/WorkflowBuilder";
import Team from "./views/org/Team";

// Legacy console (keeping for backwards compatibility)
import ConsoleLayout from "./views/ConsoleLayout";
import Agents from "./views/Agents";
import AgentDetail from "./views/AgentDetail";
import Tasks from "./views/Tasks";
import Credits from "./views/Credits";
import WorkflowDetail from "./views/WorkflowDetail";
import Account from "./views/Account";
import LegacyWorkflows from "./views/Workflows";

export const AppRoutes = () => (
  <Routes>
    {/* Public routes */}
    <Route path="/" element={<Home />} />
    <Route path="/explore" element={<Explore />} />
    <Route path="/marketplace" element={<Marketplace />} />
    <Route path="/playground" element={<Playground />} />
    <Route path="/try" element={<Playground />} />
    <Route path="/network" element={<NetworkDashboard />} />
    
    {/* Auth routes */}
    <Route path="/login" element={<Login />} />
    <Route path="/signup" element={<Signup />} />
    
    {/* User (consumer) routes */}
    <Route path="/app" element={<UserLayout />}>
      <Route index element={<Chat />} />
      <Route path="conversations" element={<Conversations />} />
      <Route path="conversations/:id" element={<Chat />} />
      <Route path="usage" element={<Usage />} />
      <Route path="billing" element={<Billing />} />
      <Route path="settings" element={<Settings />} />
    </Route>
    
    {/* Developer routes */}
    <Route path="/dev" element={<DevLayout />}>
      <Route index element={<DevDashboard />} />
      <Route path="agents" element={<MyAgents />} />
      <Route path="agents/new" element={<NewAgent />} />
      <Route path="agents/:id" element={<NewAgent />} />
      <Route path="deploy" element={<DeployAgent />} />
      <Route path="integrations" element={<Integrations />} />
      <Route path="import-github" element={<ImportFromGitHub />} />
      <Route path="import-huggingface" element={<ImportHuggingFace />} />
      <Route path="specialized-agents" element={<SpecializedAgents />} />
      <Route path="analytics" element={<DevAnalytics />} />
      <Route path="keys" element={<Settings />} />
      <Route path="earnings" element={<Usage />} />
      <Route path="docs" element={<Navigate to="https://docs.nooterra.ai" />} />
      <Route path="settings" element={<Settings />} />
    </Route>
    
    {/* Organization routes */}
    <Route path="/org" element={<OrgLayout />}>
      <Route index element={<OrgDashboard />} />
      <Route path="workflows" element={<Workflows />} />
      <Route path="workflows/new" element={<WorkflowBuilder />} />
      <Route path="workflows/:id" element={<WorkflowBuilder />} />
      <Route path="team" element={<Team />} />
      <Route path="fleet" element={<MyAgents />} />
      <Route path="analytics" element={<Usage />} />
      <Route path="billing" element={<Billing />} />
      <Route path="settings" element={<Settings />} />
    </Route>
    
    {/* Legacy console routes (for backwards compatibility) */}
    <Route path="/console" element={<ConsoleLayout />}>
      <Route index element={<Navigate to="/console/agents" replace />} />
      <Route path="agents" element={<Agents />} />
      <Route path="agents/:did" element={<AgentDetail />} />
      <Route path="tasks" element={<Tasks />} />
      <Route path="workflows" element={<LegacyWorkflows />} />
      <Route path="workflows/:id" element={<WorkflowDetail />} />
      <Route path="credits" element={<Credits />} />
      <Route path="account" element={<Account />} />
    </Route>
  </Routes>
);
