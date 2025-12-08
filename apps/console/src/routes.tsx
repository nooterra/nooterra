import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import Home from "./views/Home";
import ConsoleLayout from "./views/ConsoleLayout";
import Agents from "./views/Agents";
import AgentDetail from "./views/AgentDetail";
import Workflows from "./views/Workflows";
import WorkflowDetail from "./views/WorkflowDetail";
import Tasks from "./views/Tasks";
import NetworkDashboard from "./views/NetworkDashboard";
import Health from "./views/Health";
import Credits from "./views/Credits";
import Account from "./views/Account";
import TraceExplorer from "./views/TraceExplorer";

export const AppRoutes = () => (
  <Routes>
    <Route path="/" element={<Home />} />

    <Route path="/console" element={<ConsoleLayout />}>
      <Route index element={<Agents />} />
      <Route path="agents" element={<Agents />} />
      <Route path="agents/:did" element={<AgentDetail />} />
      <Route path="tasks" element={<Tasks />} />
      <Route path="workflows" element={<Workflows />} />
      <Route path="workflows/:id" element={<WorkflowDetail />} />
      <Route path="network" element={<NetworkDashboard />} />
      <Route path="health" element={<Health />} />
      <Route path="credits" element={<Credits />} />
      <Route path="account" element={<Account />} />
      {/* Operator trace explorer */}
      <Route path="ops/traces" element={<TraceExplorer />} />
    </Route>

    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
);
