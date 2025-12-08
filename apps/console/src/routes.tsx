import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import Home from "./views/Home";

export const AppRoutes = () => (
  <Routes>
    <Route path="/" element={<Home />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
);
