import React from "react";

// Hugging Face integration for connecting external models

type HFModel = {
  id: string;
  name: string;
  pipeline: string;
  downloads: number;
  likes: number;
};

type HFModelDetails = HFModel & {
  description: string;
  tags: string[];
  library: string;
};

export function useHuggingFace() {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [connected, setConnected] = React.useState(false);

  const coordUrl = (import.meta as any).env?.VITE_COORD_URL || "https://coord.nooterra.ai";

  // Check if HF is connected
  React.useEffect(() => {
    const token = localStorage.getItem("hf_token");
    setConnected(!!token);
  }, []);

  // Connect Hugging Face account
  const connect = async (apiToken: string): Promise<boolean> => {
    setLoading(true);
    setError(null);

    try {
      // Validate token by fetching user info
      const res = await fetch("https://huggingface.co/api/whoami-v2", {
        headers: {
          Authorization: `Bearer ${apiToken}`,
        },
      });

      if (!res.ok) {
        throw new Error("Invalid Hugging Face token");
      }

      const user = await res.json();
      
      // Store token and user info
      localStorage.setItem("hf_token", apiToken);
      localStorage.setItem("hf_user", JSON.stringify(user));
      
      // Register with Nooterra backend
      const token = localStorage.getItem("token");
      await fetch(`${coordUrl}/v1/integrations/huggingface`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ hfToken: apiToken }),
      });

      setConnected(true);
      return true;
    } catch (err: any) {
      setError(err.message);
      return false;
    } finally {
      setLoading(false);
    }
  };

  // Disconnect Hugging Face
  const disconnect = () => {
    localStorage.removeItem("hf_token");
    localStorage.removeItem("hf_user");
    setConnected(false);
  };

  // Search models
  const searchModels = async (query: string, limit: number = 10): Promise<HFModel[]> => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(
        `https://huggingface.co/api/models?search=${encodeURIComponent(query)}&limit=${limit}&sort=downloads&direction=-1`
      );

      if (!res.ok) {
        throw new Error("Failed to search models");
      }

      const models = await res.json();
      return models.map((m: any) => ({
        id: m.id,
        name: m.id.split("/").pop(),
        pipeline: m.pipeline_tag || "unknown",
        downloads: m.downloads || 0,
        likes: m.likes || 0,
      }));
    } catch (err: any) {
      setError(err.message);
      return [];
    } finally {
      setLoading(false);
    }
  };

  // Get model details
  const getModelDetails = async (modelId: string): Promise<HFModelDetails | null> => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`https://huggingface.co/api/models/${modelId}`);

      if (!res.ok) {
        throw new Error("Failed to get model details");
      }

      const model = await res.json();
      return {
        id: model.id,
        name: model.id.split("/").pop(),
        description: model.description || "",
        pipeline: model.pipeline_tag || "unknown",
        tags: model.tags || [],
        library: model.library_name || "unknown",
        downloads: model.downloads || 0,
        likes: model.likes || 0,
      };
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  };

  // Deploy HF model as Nooterra agent
  const deployAsAgent = async (
    modelId: string,
    config: {
      name: string;
      description: string;
      pricePerCall: number;
      capabilities: string[];
    }
  ): Promise<string | null> => {
    setLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem("token");
      const hfToken = localStorage.getItem("hf_token");

      if (!hfToken) {
        throw new Error("Hugging Face not connected");
      }

      const res = await fetch(`${coordUrl}/v1/agents/deploy-hf`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          hfModelId: modelId,
          hfToken,
          ...config,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Failed to deploy agent");
      }

      const data = await res.json();
      return data.agentDid;
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  };

  // List user's models
  const getUserModels = async (): Promise<HFModel[]> => {
    const hfToken = localStorage.getItem("hf_token");
    if (!hfToken) return [];

    try {
      const userRes = await fetch("https://huggingface.co/api/whoami-v2", {
        headers: { Authorization: `Bearer ${hfToken}` },
      });
      
      if (!userRes.ok) return [];
      
      const user = await userRes.json();
      const username = user.name;

      const modelsRes = await fetch(
        `https://huggingface.co/api/models?author=${username}&limit=50`
      );

      if (!modelsRes.ok) return [];

      const models = await modelsRes.json();
      return models.map((m: any) => ({
        id: m.id,
        name: m.id.split("/").pop(),
        pipeline: m.pipeline_tag || "unknown",
        downloads: m.downloads || 0,
        likes: m.likes || 0,
      }));
    } catch {
      return [];
    }
  };

  return {
    loading,
    error,
    connected,
    connect,
    disconnect,
    searchModels,
    getModelDetails,
    deployAsAgent,
    getUserModels,
  };
}

export default useHuggingFace;

